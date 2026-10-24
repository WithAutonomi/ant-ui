import { readContract, writeContract, waitForTransactionReceipt, getAccount, switchChain, getPublicClient } from '@wagmi/core'
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

export interface MerkleTreesPaymentResult {
  /** One winner pool hash per input tree, aligned to input order (the
   *  contract emits one MerklePaymentMade per tree, in input order). */
  winnerPoolHashes: string[]
  /** Total amount paid across all trees in the transaction */
  totalPaid: bigint
  /** Total gas cost in wei (ETH) across all transactions (payment + approval) */
  gasSpent: bigint
}

/** One prepared merkle sub-batch as the quote carries it (stores/files.ts
 *  `MerkleBatch`) — everything one tree needs on-chain. */
export interface MerkleBatchPaymentInput {
  depth: number
  pool_commitments: SerializedPoolCommitment[]
  timestamp: number
}

/** Trees per batched `payForMerkleTrees` transaction. Mirrors evmlib's
 *  `MERKLE_TREES_PER_PAYMENT` (src/merkle_batch_payment.rs) — the client-side
 *  cap derived from Arbitrum's ~95 KB `TxMaxDataSize` (a depth-8 tree is
 *  ≈17 KiB of calldata). The on-chain `MAX_TREES_PER_PAYMENT` (16) leaves
 *  headroom; `batchedMerkleTreesPerTx` clamps to whichever is lower. */
export const MERKLE_TREES_PER_PAYMENT = 4

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

// A transaction sent without a `gas` limit makes the wallet run its own
// eth_estimateGas — and when that estimation reverts (a lagging RPC node that
// hasn't seen the approve yet, a drained allowance, an insufficient token
// balance), MetaMask doesn't surface the revert: it falls back to a fraction
// of the block gas limit (metamask-extension#19692), which Arbitrum reports
// as 2^50 (~1.1e15). At our 1 gwei fee cap that renders as a quoted fee of
// hundreds of thousands of ETH. Estimating here and passing an explicit
// limit keeps the wallet's quote at gas × fee cap, and turns a genuine
// would-revert into a readable app error before any wallet prompt opens.
const GAS_HEADROOM_NUM = 3n
const GAS_HEADROOM_DEN = 2n

/** Ceiling on any gas limit we hand the wallet: quoted fee stays ≤ 0.1 ETH
 *  at the 1 gwei cap. Far above real use — a full 256-payment batch
 *  estimates in the low millions even with Arbitrum's L1 data component
 *  folded into the figure. */
export const GAS_LIMIT_CAP = 100_000_000n

/** Estimate + 50% headroom, capped. Headroom because Arbitrum folds the L1
 *  data fee into gas units, so the true need moves with L1 prices between
 *  estimation and inclusion. */
export function boundedGasLimit(estimate: bigint): bigint {
  const withHeadroom = (estimate * GAS_HEADROOM_NUM) / GAS_HEADROOM_DEN
  return withHeadroom > GAS_LIMIT_CAP ? GAS_LIMIT_CAP : withHeadroom
}

const PREFLIGHT_ATTEMPTS = 3
const PREFLIGHT_RETRY_DELAY_MS = 1_000

/** One-line failure reason — same field preference the stores use to render
 *  payment errors (viem's `message` is a multi-line diagnostic dump). viem
 *  puts the payload of a revert — the custom-error selector or reason
 *  string — on a SECOND line of `shortMessage`; flatten so downstream
 *  one-line renderers (status label, toast) can't lose it. */
function shortReason(e: any): string {
  const s = e?.shortMessage ?? String(e?.message ?? e).split('\n')[0]
  return String(s).replace(/\s*\n\s*/g, ' ').trim()
}

/** True when the estimate never reached the chain: the RPC transport failed
 *  (HTTP error, timeout) rather than the node simulating a revert. viem
 *  nests the transport error inside the `cause` chain of the wrapper that
 *  estimateContractGas throws. */
function isTransportError(e: any): boolean {
  for (let err = e, depth = 0; err && depth < 10; err = err.cause, depth++) {
    if (err.name === 'HttpRequestError' || err.name === 'TimeoutError') return true
  }
  return false
}

/**
 * Estimate the gas limit for a contract write on our own transport, with
 * retries: right after an approve receipt, a load-balanced public RPC can
 * serve pre-approve state for a block or two, making a healthy payment
 * simulate as a revert.
 */
async function preflightGasLimit(
  wagmiConfig: any,
  call: { address: `0x${string}`; abi: any; functionName: string; args: any },
  label: string,
): Promise<bigint> {
  const client = getPublicClient(wagmiConfig, { chainId: getActiveChainId() as any })
  const account = getSignerAccount(wagmiConfig)
  let lastError: unknown
  for (let attempt = 1; attempt <= PREFLIGHT_ATTEMPTS; attempt++) {
    try {
      return boundedGasLimit(await client!.estimateContractGas({ ...call, account }))
    } catch (e) {
      lastError = e
      if (attempt < PREFLIGHT_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, PREFLIGHT_RETRY_DELAY_MS))
      }
    }
  }
  if (isTransportError(lastError)) {
    // Not an on-chain verdict — we never got one. Say so instead of
    // implying the payment itself is doomed.
    throw new Error(`Couldn't reach the Arbitrum RPC to estimate gas: ${shortReason(lastError)}`, {
      cause: lastError,
    })
  }
  throw new Error(`${label} would fail on-chain: ${shortReason(lastError)}`, { cause: lastError })
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

    const call = {
      abi: paymentVaultAbi,
      address: getVaultAddress(),
      functionName: 'payForQuotes',
      args: [input],
    }
    const hash = await writeContract(wagmiConfig, {
      ...call,
      chainId: getActiveChainId(),
      gas: await preflightGasLimit(wagmiConfig, call, 'Payment'),
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
/** Upper bound of what PaymentVaultV2.payForMerkleTree will actually pull:
 *  the vault charges `median(winner pool's 16 candidate amounts) × 2^depth`
 *  (median16 = element 8 of the sorted 16), and picks the winner pool
 *  on-chain from sender+timestamp — unknowable here, so take the worst
 *  case across pools. The previous bound — the largest pool's SUM — is
 *  ≈16×median, which UNDERSHOOTS the real charge by 2^depth/16 for
 *  depth ≥ 5 (8× at depth 7). Wallets whose remaining allowance fell in
 *  that gap skipped the approve and then reverted every retry with
 *  ERC20InsufficientAllowance (0xfb8f41b2). */
export function merkleMaxCharge(
  depth: number,
  pools: { candidates: { amount: bigint }[] }[],
): bigint {
  return pools.reduce((max, pool) => {
    const amounts = pool.candidates
      .map(c => c.amount)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    if (amounts.length === 0) return max
    // Contract's median16 selects index 8 of its fixed 16-slot array.
    const median = amounts[Math.min(8, amounts.length - 1)]!
    const charge = median * (1n << BigInt(depth))
    return charge > max ? charge : max
  }, 0n)
}

/** Serialized pool commitments → the tuple shape the vault ABI takes. */
function toContractCommitments(poolCommitments: SerializedPoolCommitment[]) {
  return poolCommitments.map(pc => ({
    poolHash: pc.pool_hash as `0x${string}`,
    candidates: pc.candidates.map(c => ({
      rewardsAddress: c.rewards_address as `0x${string}`,
      amount: BigInt(c.amount),
    })),
  }))
}

/** All MerklePaymentMade events of a receipt, in log order. The contract
 *  emits exactly one per tree, in input order, so index i belongs to tree i —
 *  the property the batched path relies on to align winner hashes. */
export function extractMerklePaymentEvents(
  logs: { data: any; topics: any }[],
): { winnerPoolHash: string; totalAmount: bigint }[] {
  const events: { winnerPoolHash: string; totalAmount: bigint }[] = []
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: paymentVaultAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'MerklePaymentMade') {
        const args = decoded.args as unknown as { winnerPoolHash: string; totalAmount: bigint }
        events.push({ winnerPoolHash: args.winnerPoolHash, totalAmount: args.totalAmount })
      }
    } catch {
      // Not our event, skip
    }
  }
  return events
}

export async function payForMerkleTree(
  wagmiConfig: any,
  depth: number,
  poolCommitments: SerializedPoolCommitment[],
  merkleTimestamp: bigint,
): Promise<MerklePaymentResult> {
  await ensureActiveChain(wagmiConfig)

  const commitments = toContractCommitments(poolCommitments)

  let gasSpent = await ensureAllowance(wagmiConfig, merkleMaxCharge(depth, commitments))

  const call = {
    abi: paymentVaultAbi,
    address: getVaultAddress(),
    functionName: 'payForMerkleTree',
    args: [depth, commitments, merkleTimestamp],
  }
  const hash = await writeContract(wagmiConfig, {
    ...call,
    chainId: getActiveChainId(),
    gas: await preflightGasLimit(wagmiConfig, call, 'Payment'),
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
  const [event] = extractMerklePaymentEvents(receipt.logs)
  if (!event) throw new Error('MerklePaymentMade event not found in transaction receipt')
  return {
    winnerPoolHash: event.winnerPoolHash,
    totalPaid: event.totalAmount,
    gasSpent,
  }
}

/**
 * Pay for several merkle trees in ONE `payForMerkleTrees` transaction — a
 * single wallet confirmation for the whole group (V2-949). The call is
 * atomic: either every tree in the group is paid or none is. Requires a
 * vault deployment carrying the batched entry point (probe with
 * `batchedMerkleTreesPerTx` first).
 */
export async function payForMerkleTrees(
  wagmiConfig: any,
  batches: MerkleBatchPaymentInput[],
): Promise<MerkleTreesPaymentResult> {
  await ensureActiveChain(wagmiConfig)

  // Per-call allowance top-up mirrors payForMerkleTree's self-contained
  // behavior; when the caller already ran ensureAllowanceForMerkleBatches
  // over the whole upload this finds the allowance sufficient and only
  // costs a readContract.
  let gasSpent = await ensureAllowanceForMerkleBatches(wagmiConfig, batches)

  const trees = batches.map(b => ({
    depth: b.depth,
    merklePaymentTimestamp: BigInt(b.timestamp),
    poolCommitments: toContractCommitments(b.pool_commitments),
  }))

  const call = {
    abi: paymentVaultAbi,
    address: getVaultAddress(),
    functionName: 'payForMerkleTrees',
    args: [trees],
  }
  const hash = await writeContract(wagmiConfig, {
    ...call,
    chainId: getActiveChainId(),
    gas: await preflightGasLimit(wagmiConfig, call, 'Payment'),
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

  const events = extractMerklePaymentEvents(receipt.logs)
  if (events.length !== batches.length) {
    throw new Error(
      `Batched merkle payment emitted ${events.length} MerklePaymentMade event(s) for ${batches.length} trees`,
    )
  }
  return {
    winnerPoolHashes: events.map(e => e.winnerPoolHash),
    totalPaid: events.reduce((sum, e) => sum + e.totalAmount, 0n),
    gasSpent,
  }
}

/** Definitive probe answers per chain+vault; transport failures are not
 *  cached so a flaky RPC only degrades the current upload to the legacy
 *  path instead of pinning the vault as legacy for the whole session. */
const batchedVaultSupport = new Map<string, number>()

/** Test seam: forget cached probe answers. */
export function _resetBatchedVaultSupportCache(): void {
  batchedVaultSupport.clear()
}

/**
 * Feature-probe the active vault for the batched entry point: old vault
 * deployments have no `MAX_TREES_PER_PAYMENT()` getter, so the read reverts
 * and the caller keeps the legacy per-tree loop. Returns the trees-per-
 * transaction cap to use — `min(MERKLE_TREES_PER_PAYMENT, on-chain max)` —
 * or 0 when the vault doesn't support batching (or the RPC couldn't say).
 */
export async function batchedMerkleTreesPerTx(wagmiConfig: any): Promise<number> {
  const key = `${getActiveChainId()}:${getVaultAddress()}`
  const cached = batchedVaultSupport.get(key)
  if (cached !== undefined) return cached

  try {
    const onChainMax = (await readContract(wagmiConfig, {
      abi: paymentVaultAbi,
      address: getVaultAddress(),
      functionName: 'MAX_TREES_PER_PAYMENT',
      chainId: getActiveChainId(),
    })) as number | bigint
    const perTx = Math.min(MERKLE_TREES_PER_PAYMENT, Number(onChainMax))
    batchedVaultSupport.set(key, perTx)
    return perTx
  } catch (e) {
    if (isTransportError(e)) return 0
    // On-chain verdict: the getter isn't there. Definitive for this vault.
    batchedVaultSupport.set(key, 0)
    return 0
  }
}

/** Contiguous groups of up to `perTx` sub-batches — one on-chain transaction
 *  (one wallet confirmation) per group. `perTx` ≤ 1 degenerates to the
 *  legacy one-tree-per-transaction shape. */
export function merklePaymentGroups<T>(batches: T[], perTx: number): T[][] {
  const size = Math.max(1, Math.floor(perTx))
  const groups: T[][] = []
  for (let i = 0; i < batches.length; i += size) {
    groups.push(batches.slice(i, i + size))
  }
  return groups
}

/** One up-front allowance covering every sub-batch of a multi-batch merkle
 *  payment (ADR-0003 in ant-client): sums the per-batch worst-case charges
 *  and tops the allowance up once, so the wallet prompts for at most one
 *  approve before the N payment transactions. Each subsequent
 *  `payForMerkleTree` call still checks the allowance, but finds it already
 *  sufficient and skips straight to the payment. Returns approve gas spent
 *  (0 when the standing allowance already covers the total). */
export async function ensureAllowanceForMerkleBatches(
  wagmiConfig: any,
  batches: { depth: number; pool_commitments: SerializedPoolCommitment[] }[],
): Promise<bigint> {
  await ensureActiveChain(wagmiConfig)
  const total = batches.reduce((sum, b) => {
    const commitments = b.pool_commitments.map(pc => ({
      candidates: pc.candidates.map(c => ({ amount: BigInt(c.amount) })),
    }))
    return sum + merkleMaxCharge(b.depth, commitments)
  }, 0n)
  return ensureAllowance(wagmiConfig, total)
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

  const call = {
    abi: paymentTokenAbi,
    address: getTokenAddress(),
    functionName: 'approve',
    args: [getVaultAddress(), approvalAmountFor(needed)],
  }
  const hash = await writeContract(wagmiConfig, {
    ...call,
    chainId: getActiveChainId(),
    gas: await preflightGasLimit(wagmiConfig, call, 'Token approval'),
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
