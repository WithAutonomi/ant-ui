import { readContract, writeContract, waitForTransactionReceipt } from '@wagmi/core'
import { arbitrum } from '@reown/appkit/networks'
import { ANT_TOKEN_ADDRESS, PAYMENT_VAULT_ADDRESS } from '~/utils/wallet-config'
import paymentVaultAbi from '~/assets/abi/IPaymentVault.json'
import paymentTokenAbi from '~/assets/abi/PaymentToken.json'

const MAX_PAYMENTS_PER_BATCH = 256

export type RawPayment = [string, string, string] // [quoteHash, rewardsAddress, amount]

export interface PaymentResult {
  /** Map of quoteHash → txHash for each payment */
  txHashMap: Record<string, string>
  totalPaid: bigint
}

/**
 * Pay for store quotes via the PaymentVault contract.
 * Handles ERC20 approval and batching (max 256 per tx).
 *
 * @param wagmiConfig - The wagmi config from the adapter
 * @param payments - Array of [quoteHash, rewardsAddress, amount] from the Rust backend
 * @returns Transaction hashes for all payment batches
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
