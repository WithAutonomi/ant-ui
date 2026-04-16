import { readContract, writeContract, waitForTransactionReceipt, getGasPrice, getAccount } from '@wagmi/core'
import { getTokenAddress, getVaultAddress, getActiveChainId } from '~/utils/wallet-config'
import paymentVaultAbi from '~/assets/abi/IPaymentVault.json'
import paymentTokenAbi from '~/assets/abi/PaymentToken.json'
import { decodeEventLog, formatEther, encodeFunctionData } from 'viem'

const MAX_PAYMENTS_PER_BATCH = 256

// Typical gas units per operation (conservative estimates)
const GAS_APPROVE = 50_000n
const GAS_PER_QUOTE_PAYMENT = 38_000n
const GAS_QUOTE_BASE = 25_000n
const GAS_MERKLE_BASE = 180_000n
const GAS_MERKLE_PER_POOL = 25_000n

// Arbitrum produces blocks every ~250ms; viem's default 4s polling is tuned
// for L1. Dropping to 2s reduces the window where we might miss a newly-mined
// block and surface TransactionReceiptNotFoundError for txs that have
// actually landed. viem's built-in retry handles RPC propagation lag.
const RECEIPT_POLL_INTERVAL_MS = 2_000

export type RawPayment = [string, string, string] // [quoteHash, rewardsAddress, amount]

export interface PaymentResult {
  /** Map of quoteHash -> txHash for each payment */
  txHashMap: Record<string, string>
  totalPaid: bigint
  /** Total gas cost in wei (ETH) across all transactions (payments + approval) */
  gasSpent: bigint
}

export interface MerklePaymentResult {
  /** Winner pool hash (bytes32 hex) from the MerklePaymentMade event */
  winnerPoolHash: string
  /** Total amount paid */
  totalPaid: bigint
  /** Total gas cost in wei (ETH) across all transactions (payment + approval) */
  gasSpent: bigint
}

/** Serialized pool commitment from Rust backend */
export interface SerializedPoolCommitment {
  pool_hash: string
  candidates: { rewards_address: string; amount: string }[]
}

/** Extract gas cost in wei from a transaction receipt. */
function receiptGasCost(receipt: any): bigint {
  const gasUsed = BigInt(receipt.gasUsed ?? 0)
  const gasPrice = BigInt(receipt.effectiveGasPrice ?? 0)
  return gasUsed * gasPrice
}

/**
 * Get the account for signing transactions.
 */
function getSignerAccount(wagmiConfig: any): `0x${string}` {
  const devnetAccount = getDevnetAccount?.()
  if (devnetAccount) return devnetAccount.address

  const account = getAccount(wagmiConfig)
  if (!account.address) throw new Error('Wallet not connected')
  return account.address
}

/**
 * Build the account option for writeContract.
 */
function accountOpt(): { account: any } | {} {
  const devnetAccount = getDevnetAccount?.()
  return devnetAccount ? { account: devnetAccount } : {}
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
    return { txHashMap: {}, totalPaid: 0n, gasSpent: 0n }
  }

  const totalAmount = payments.reduce(
    (sum, [, , amount]) => sum + BigInt(amount),
    0n,
  )

  let gasSpent = await ensureAllowance(wagmiConfig, totalAmount)

  const txHashMap: Record<string, string> = {}
  for (let i = 0; i < payments.length; i += MAX_PAYMENTS_PER_BATCH) {
    const batch = payments.slice(i, i + MAX_PAYMENTS_PER_BATCH)

    const input = batch.map(([quoteHash, rewardsAddress, amount]) => [
      rewardsAddress,
      amount,
      quoteHash,
    ])

    const hash = await writeContract(wagmiConfig, {
      abi: paymentVaultAbi,
      address: getVaultAddress(),
      functionName: 'payForQuotes',
      args: [input],
      chainId: getActiveChainId(),
      ...accountOpt(),
    })

    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      hash,
      chainId: getActiveChainId(),
      pollingInterval: RECEIPT_POLL_INTERVAL_MS,
    })
    gasSpent += receiptGasCost(receipt)

    for (const [quoteHash] of batch) {
      txHashMap[quoteHash] = hash
    }
  }

  return { txHashMap, totalPaid: totalAmount, gasSpent }
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
  const commitments = poolCommitments.map(pc => ({
    poolHash: pc.pool_hash as `0x${string}`,
    candidates: pc.candidates.map(c => ({
      rewardsAddress: c.rewards_address as `0x${string}`,
      amount: BigInt(c.amount),
    })),
  }))

  const maxPoolCost = commitments.reduce((max, pc) => {
    const poolTotal = pc.candidates.reduce((sum, c) => sum + c.amount, 0n)
    return poolTotal > max ? poolTotal : max
  }, 0n)

  let gasSpent = await ensureAllowance(wagmiConfig, maxPoolCost)

  const hash = await writeContract(wagmiConfig, {
    abi: paymentVaultAbi,
    address: getVaultAddress(),
    functionName: 'payForMerkleTree',
    args: [depth, commitments, merkleTimestamp],
    chainId: getActiveChainId(),
    ...accountOpt(),
  })

  const receipt = await waitForTransactionReceipt(wagmiConfig, {
    hash,
    chainId: getActiveChainId(),
    pollingInterval: RECEIPT_POLL_INTERVAL_MS,
  })
  gasSpent += receiptGasCost(receipt)

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
          gasSpent,
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
 * Returns gas spent on approval (0 if no approval needed).
 */
async function ensureAllowance(wagmiConfig: any, needed: bigint): Promise<bigint> {
  const ownerAddress = getSignerAccount(wagmiConfig)

  const currentAllowance = (await readContract(wagmiConfig, {
    abi: paymentTokenAbi,
    address: getTokenAddress(),
    functionName: 'allowance',
    args: [ownerAddress, getVaultAddress()],
    chainId: getActiveChainId(),
  })) as bigint

  if (currentAllowance >= needed) return 0n

  const hash = await writeContract(wagmiConfig, {
    abi: paymentTokenAbi,
    address: getTokenAddress(),
    functionName: 'approve',
    args: [getVaultAddress(), needed],
    chainId: getActiveChainId(),
    ...accountOpt(),
  })

  const receipt = await waitForTransactionReceipt(wagmiConfig, {
    hash,
    chainId: getActiveChainId(),
    pollingInterval: RECEIPT_POLL_INTERVAL_MS,
  })
  return receiptGasCost(receipt)
}

/**
 * Estimate gas cost for an upload payment before executing it.
 * Uses current chain gas price and conservative gas unit estimates.
 *
 * @returns Estimated gas cost formatted as ETH string, or null if estimation fails.
 */
export async function estimatePaymentGasCost(
  wagmiConfig: any,
  paymentMode: 'wave-batch' | 'merkle',
  paymentCount: number,
  poolCount?: number,
): Promise<string | null> {
  try {
    const gasPrice = await Promise.race([
      getGasPrice(wagmiConfig, { chainId: getActiveChainId() }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gas price timeout')), 10_000)),
    ])

    let totalGas: bigint
    if (paymentMode === 'merkle') {
      // Merkle: one approve + one payForMerkleTree call
      totalGas = GAS_APPROVE + GAS_MERKLE_BASE + GAS_MERKLE_PER_POOL * BigInt(poolCount ?? 4)
    } else {
      // Wave-batch: one approve + N batches of payForQuotes
      const batches = Math.ceil(paymentCount / MAX_PAYMENTS_PER_BATCH)
      const paymentsGas = GAS_PER_QUOTE_PAYMENT * BigInt(paymentCount)
      const batchOverhead = GAS_QUOTE_BASE * BigInt(batches)
      totalGas = GAS_APPROVE + paymentsGas + batchOverhead
    }

    const costWei = totalGas * gasPrice
    return formatGasCost(costWei.toString())
  } catch {
    return null
  }
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

/**
 * Format gas cost in wei to a human-readable ETH string.
 */
export function formatGasCost(weiStr: string): string {
  try {
    return `${parseFloat(formatEther(BigInt(weiStr))).toFixed(6)} ETH`
  } catch {
    return `${weiStr} wei`
  }
}
