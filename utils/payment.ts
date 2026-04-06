import { readContract, writeContract, waitForTransactionReceipt } from '@wagmi/core'
import { arbitrum } from '@reown/appkit/networks'
import { ANT_TOKEN_ADDRESS, PAYMENT_VAULT_ADDRESS } from '~/utils/wallet-config'
import paymentVaultAbi from '~/assets/abi/IPaymentVault.json'
import paymentTokenAbi from '~/assets/abi/PaymentToken.json'
import { decodeEventLog } from 'viem'

const MAX_PAYMENTS_PER_BATCH = 256

export type RawPayment = [string, string, string] // [quoteHash, rewardsAddress, amount]

export interface PaymentResult {
  /** Map of quoteHash -> txHash for each payment */
  txHashMap: Record<string, string>
  totalPaid: bigint
}

export interface MerklePaymentResult {
  /** Winner pool hash (bytes32 hex) from the MerklePaymentMade event */
  winnerPoolHash: string
  /** Total amount paid */
  totalPaid: bigint
}

/** Serialized pool commitment from Rust backend */
export interface SerializedPoolCommitment {
  pool_hash: string
  candidates: { rewards_address: string; amount: string }[]
}

/**
 * Pay for store quotes via the PaymentVault contract (wave-batch path).
 * Handles ERC20 approval and batching (max 256 per tx).
 */
export async function payForQuotes(
  wagmiConfig: any,
  payments: RawPayment[],
): Promise<PaymentResult> {
  if (payments.length === 0) {
    return { txHashMap: {}, totalPaid: 0n }
  }

  // Calculate total cost
  const totalAmount = payments.reduce(
    (sum, [, , amount]) => sum + BigInt(amount),
    0n,
  )

  // Check and set ERC20 allowance
  await ensureAllowance(wagmiConfig, totalAmount)

  // Batch payments (max 256 per tx) and map each quoteHash to its tx hash
  const txHashMap: Record<string, string> = {}
  for (let i = 0; i < payments.length; i += MAX_PAYMENTS_PER_BATCH) {
    const batch = payments.slice(i, i + MAX_PAYMENTS_PER_BATCH)

    // Reorder from [quoteHash, rewardsAddress, amount] to
    // [rewardsAddress, amount, quoteHash] to match Solidity DataPayment struct
    const input = batch.map(([quoteHash, rewardsAddress, amount]) => [
      rewardsAddress,
      amount,
      quoteHash,
    ])

    const hash = await writeContract(wagmiConfig, {
      abi: paymentVaultAbi,
      address: PAYMENT_VAULT_ADDRESS,
      functionName: 'payForQuotes',
      args: [input],
      chainId: arbitrum.id,
    })

    // Wait for confirmation
    await waitForTransactionReceipt(wagmiConfig, { hash, chainId: arbitrum.id })

    // Map every quoteHash in this batch to the batch's tx hash
    for (const [quoteHash] of batch) {
      txHashMap[quoteHash] = hash
    }
  }

  return { txHashMap, totalPaid: totalAmount }
}

/**
 * Pay for merkle tree via the PaymentVault contract (merkle path).
 * Single transaction for all chunks — lower gas for large uploads.
 */
export async function payForMerkleTree(
  wagmiConfig: any,
  depth: number,
  poolCommitments: SerializedPoolCommitment[],
  merkleTimestamp: bigint,
): Promise<MerklePaymentResult> {
  // Convert serialized commitments to contract-compatible format
  const commitments = poolCommitments.map(pc => ({
    poolHash: pc.pool_hash as `0x${string}`,
    candidates: pc.candidates.map(c => ({
      rewardsAddress: c.rewards_address as `0x${string}`,
      amount: BigInt(c.amount),
    })),
  }))

  // Sum all candidate amounts across all pools to estimate total cost for allowance.
  // The contract picks the winning pool — actual cost will be <= this sum.
  // Use the max pool total as a conservative estimate.
  const maxPoolCost = commitments.reduce((max, pc) => {
    const poolTotal = pc.candidates.reduce((sum, c) => sum + c.amount, 0n)
    return poolTotal > max ? poolTotal : max
  }, 0n)

  await ensureAllowance(wagmiConfig, maxPoolCost)

  const hash = await writeContract(wagmiConfig, {
    abi: paymentVaultAbi,
    address: PAYMENT_VAULT_ADDRESS,
    functionName: 'payForMerkleTree',
    args: [depth, commitments, merkleTimestamp],
    chainId: arbitrum.id,
  })

  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: arbitrum.id })

  // Extract winnerPoolHash from MerklePaymentMade event
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: paymentVaultAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'MerklePaymentMade') {
        const args = decoded.args as unknown as { winnerPoolHash: string; totalAmount: bigint }
        return {
          winnerPoolHash: args.winnerPoolHash,
          totalPaid: args.totalAmount,
        }
      }
    } catch {
      // Not our event, skip
    }
  }

  throw new Error('MerklePaymentMade event not found in transaction receipt')
}

/**
 * Ensure the PaymentVault has sufficient ERC20 allowance.
 * If current allowance is less than needed, sends an approve tx.
 */
async function ensureAllowance(wagmiConfig: any, needed: bigint) {
  // Get connected account address
  const { getAccount } = await import('@wagmi/core')
  const account = getAccount(wagmiConfig)
  if (!account.address) throw new Error('Wallet not connected')

  const currentAllowance = (await readContract(wagmiConfig, {
    abi: paymentTokenAbi,
    address: ANT_TOKEN_ADDRESS,
    functionName: 'allowance',
    args: [account.address, PAYMENT_VAULT_ADDRESS],
    chainId: arbitrum.id,
  })) as bigint

  if (currentAllowance >= needed) return

  // Approve the exact amount needed
  const hash = await writeContract(wagmiConfig, {
    abi: paymentTokenAbi,
    address: ANT_TOKEN_ADDRESS,
    functionName: 'approve',
    args: [PAYMENT_VAULT_ADDRESS, needed],
    chainId: arbitrum.id,
  })

  await waitForTransactionReceipt(wagmiConfig, { hash, chainId: arbitrum.id })
}

/**
 * Format a nano-token amount to a human-readable string.
 */
export function formatNanoTokens(nanoStr: string): string {
  try {
    const nanos = BigInt(nanoStr)
    const whole = nanos / 1_000_000_000_000_000_000n
    const frac = (nanos % 1_000_000_000_000_000_000n) / 1_000_000_000_000_000n
    if (frac > 0n) {
      return `${whole}.${frac.toString().padStart(3, '0')} ANT`
    }
    return `${whole} ANT`
  } catch {
    return `${nanoStr} atto`
  }
}
