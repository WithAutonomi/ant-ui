import { readContract, writeContract, waitForTransactionReceipt, getAccount, switchChain } from '@wagmi/core'
import { getTokenAddress, getVaultAddress, getActiveChainId } from '~/utils/wallet-config'
import paymentVaultAbi from '~/assets/abi/IPaymentVault.json'
import paymentTokenAbi from '~/assets/abi/PaymentToken.json'
import { decodeEventLog, formatEther } from 'viem'

const MAX_PAYMENTS_PER_BATCH = 256

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
 * Make sure the connected wallet is on the chain we're about to write to.
 * If not, request a switch — wagmi turns this into a `wallet_switchEthereumChain`
 * request which prompts the user in the wallet (extension popup or
 * WalletConnect mobile push). For the direct-key (devnet wallet import)
 * path we skip — that wallet always sits on the manifest's chain.
 */
async function ensureActiveChain(wagmiConfig: any): Promise<void> {
  if (getDevnetAccount?.()) return
  const target = getActiveChainId()
  const account = getAccount(wagmiConfig)
  if (account.chainId === target) return
  await switchChain(wagmiConfig, { chainId: target })
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

  await ensureActiveChain(wagmiConfig)

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
      // V2-231: override both EIP-1559 fees explicitly. viem only
      // auto-estimates the side that's missing, so passing only one
      // produces an invalid pair (maxFee=baseFee < maxPriority).
      // Arbitrum base fees are ~0.02 gwei; 1 gwei cap = ~50× headroom;
      // 0.1 gwei tip is performative (Arbitrum sequencer doesn't
      // tip-prioritize). Ceiling cost: ~1 gwei × ~150k gas ≈ 0.00015 ETH.
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
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
  await ensureActiveChain(wagmiConfig)

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
    // V2-231: override BOTH fees so EIP-1559's maxFee >= maxPriority holds.
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
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

/** Standing ERC20 allowance granted to the PaymentVault: 1 ANT (18 decimals).
 *  Approving the exact quote amount would be consumed in full by the payment
 *  that follows, forcing a fresh approve — and a second wallet prompt — on
 *  every upload. A standing amount lets subsequent uploads skip straight to
 *  the payment tx until it drains. Bounded rather than unlimited so wallet
 *  allowance warnings stay reasonable and exposure to the vault is capped. */
export const STANDING_ALLOWANCE = 10n ** 18n

/** Amount to approve when the current allowance can't cover `needed`. */
export function approvalAmountFor(needed: bigint): bigint {
  return needed > STANDING_ALLOWANCE ? needed : STANDING_ALLOWANCE
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
    args: [getVaultAddress(), approvalAmountFor(needed)],
    chainId: getActiveChainId(),
    // V2-231: override BOTH fees so EIP-1559's maxFee >= maxPriority holds.
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
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
