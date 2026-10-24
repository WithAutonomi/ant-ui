import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getAccount,
  getPublicClient,
  readContract,
  writeContract,
  waitForTransactionReceipt,
} from '@wagmi/core'
// `viem/utils` is unmocked (tests/mocks/appkit.ts shims only `viem`), so the
// event encoders here are real — logs round-trip through the real decoder
// inside utils/payment.ts. This viem version has no encodeEventLog in
// viem/utils, so compose logs from topics + data encoding.
import { encodeAbiParameters, encodeEventTopics } from 'viem/utils'
import paymentVaultAbi from '~/assets/abi/IPaymentVault.json'

/** Real encoded MerklePaymentMade log — what an actual receipt carries. */
function encodeMerklePaymentLog(
  winnerPoolHash: `0x${string}`,
  depth: number,
  totalAmount: bigint,
  merklePaymentTimestamp: bigint,
): { data: `0x${string}`; topics: [`0x${string}`, ...`0x${string}`[]] } {
  const topics = encodeEventTopics({
    abi: paymentVaultAbi as any,
    eventName: 'MerklePaymentMade',
    args: { winnerPoolHash },
  }) as [`0x${string}`, ...`0x${string}`[]]
  const data = encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint64' }],
    [depth, totalAmount, merklePaymentTimestamp],
  )
  return { data, topics }
}
import {
  STANDING_ALLOWANCE,
  GAS_LIMIT_CAP,
  MERKLE_TREES_PER_PAYMENT,
  approvalAmountFor,
  boundedGasLimit,
  merkleMaxCharge,
  merklePaymentGroups,
  extractMerklePaymentEvents,
  payForQuotes,
  payForMerkleTrees,
  batchedMerkleTreesPerTx,
  _resetBatchedVaultSupportCache,
  type RawPayment,
  type MerkleBatchPaymentInput,
} from '~/utils/payment'

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const ARBITRUM_BLOCK_GAS_LIMIT = 1_125_899_906_842_624n // 2^50, as reported live

const PAYMENTS: RawPayment[] = [
  ['0xquotehash', '0x2222222222222222222222222222222222222222', '1000'],
]

describe('payment', () => {
  describe('approvalAmountFor', () => {
    it('approves the standing amount for quotes below it', () => {
      expect(approvalAmountFor(1n)).toBe(STANDING_ALLOWANCE)
      expect(approvalAmountFor(STANDING_ALLOWANCE / 2n)).toBe(STANDING_ALLOWANCE)
    })

    it('approves the standing amount for a quote exactly at it', () => {
      expect(approvalAmountFor(STANDING_ALLOWANCE)).toBe(STANDING_ALLOWANCE)
    })

    it('approves the full amount for quotes above the standing amount', () => {
      const large = STANDING_ALLOWANCE * 3n + 7n
      expect(approvalAmountFor(large)).toBe(large)
    })
  })

  describe('merkleMaxCharge', () => {
    // 16 candidates like the contract's fixed pool size, amounts 1..16.
    const pool = (amounts: number[]) => ({
      candidates: amounts.map(a => ({ amount: BigInt(a) })),
    })
    const AMOUNTS = Array.from({ length: 16 }, (_, i) => i + 1)

    it('mirrors the contract: median (index 8 of sorted 16) × 2^depth', () => {
      // sorted[8] = 9; depth 7 → 9 × 128 = 1152
      expect(merkleMaxCharge(7, [pool(AMOUNTS)])).toBe(1152n)
    })

    it('exceeds the old max-pool-sum bound for deep trees (the 0xfb8f41b2 regression)', () => {
      // Pool sum is 136 — the allowance the old code verified. The vault
      // actually pulls 1152 at depth 7; anything between reverted on-chain.
      const sum = AMOUNTS.reduce((a, b) => a + b, 0)
      expect(merkleMaxCharge(7, [pool(AMOUNTS)])).toBeGreaterThan(BigInt(sum))
    })

    it('takes the worst case across pools', () => {
      const cheap = pool(AMOUNTS)
      const dear = pool(AMOUNTS.map(a => a * 100))
      expect(merkleMaxCharge(5, [cheap, dear])).toBe(900n * 32n)
    })

    it('handles empty pools without throwing', () => {
      expect(merkleMaxCharge(7, [{ candidates: [] }])).toBe(0n)
    })
  })

  describe('boundedGasLimit', () => {
    it('adds 50% headroom to the estimate', () => {
      expect(boundedGasLimit(2_000_000n)).toBe(3_000_000n)
    })

    it('caps the limit', () => {
      expect(boundedGasLimit(GAS_LIMIT_CAP)).toBe(GAS_LIMIT_CAP)
      expect(boundedGasLimit(GAS_LIMIT_CAP * 10n)).toBe(GAS_LIMIT_CAP)
    })

    it('never lets an Arbitrum-block-gas-limit-sized figure through', () => {
      // Regression for the "millions of ETH quoted" report: even fed the
      // pathological input MetaMask falls back to, the fee visible in the
      // wallet stays ≤ 0.1 ETH at the 1 gwei cap.
      const quotedFeeWei = boundedGasLimit(ARBITRUM_BLOCK_GAS_LIMIT) * 1_000_000_000n
      expect(quotedFeeWei <= 10n ** 17n).toBe(true)
    })
  })

  describe('payForQuotes gas preflight', () => {
    const estimateContractGas = vi.fn()

    beforeEach(() => {
      vi.mocked(getAccount).mockReturnValue({ address: ACCOUNT, chainId: 42161 } as any)
      vi.mocked(getPublicClient).mockReturnValue({ estimateContractGas } as any)
      // Standing allowance already covers the quote — no approve tx.
      vi.mocked(readContract).mockResolvedValue(STANDING_ALLOWANCE)
      vi.mocked(writeContract).mockResolvedValue('0xtxhash' as any)
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({
        gasUsed: 100_000n,
        effectiveGasPrice: 20_000_000n,
        logs: [],
      } as any)
    })

    afterEach(() => {
      vi.clearAllMocks()
      estimateContractGas.mockReset()
      vi.useRealTimers()
    })

    it('passes an explicit gas limit so the wallet never estimates', async () => {
      estimateContractGas.mockResolvedValue(2_000_000n)

      await payForQuotes({} as any, PAYMENTS)

      expect(writeContract).toHaveBeenCalledTimes(1)
      const tx = vi.mocked(writeContract).mock.calls[0][1] as any
      expect(tx.functionName).toBe('payForQuotes')
      expect(tx.gas).toBe(3_000_000n)
      expect(estimateContractGas).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'payForQuotes', account: ACCOUNT }),
      )
    })

    it('retries a failed estimate before giving up', async () => {
      vi.useFakeTimers()
      estimateContractGas
        .mockRejectedValueOnce(new Error('execution reverted'))
        .mockResolvedValue(2_000_000n)

      const result = payForQuotes({} as any, PAYMENTS)
      await vi.advanceTimersByTimeAsync(1_000)
      await result

      expect(estimateContractGas).toHaveBeenCalledTimes(2)
      expect(writeContract).toHaveBeenCalledTimes(1)
    })

    it('fails with a readable error before any wallet prompt when the tx would revert', async () => {
      vi.useFakeTimers()
      const revert = Object.assign(new Error('long\nviem\ndump'), {
        shortMessage: 'ERC20: transfer amount exceeds balance',
      })
      estimateContractGas.mockRejectedValue(revert)

      const assertion = expect(payForQuotes({} as any, PAYMENTS)).rejects.toThrow(
        'Payment would fail on-chain: ERC20: transfer amount exceeds balance',
      )
      await vi.advanceTimersByTimeAsync(3_000)
      await assertion

      expect(estimateContractGas).toHaveBeenCalledTimes(3)
      expect(writeContract).not.toHaveBeenCalled()
    })

    it('keeps the revert selector when viem puts it on a second line', async () => {
      vi.useFakeTimers()
      // viem formats unknown custom errors as "…the following signature:\n0x…"
      // — the selector is the only clue to WHY the contract reverts, and
      // one-line renderers used to truncate at the newline (field report
      // 2026-08-07 arrived as a screenshot ending at the colon).
      const revert = Object.assign(new Error('long\nviem\ndump'), {
        shortMessage:
          'The contract function "payForMerkleTree" reverted with the following signature:\n0x1fb3b5a2',
      })
      estimateContractGas.mockRejectedValue(revert)

      const assertion = expect(payForQuotes({} as any, PAYMENTS)).rejects.toThrow(
        'Payment would fail on-chain: The contract function "payForMerkleTree" reverted with the following signature: 0x1fb3b5a2',
      )
      await vi.advanceTimersByTimeAsync(3_000)
      await assertion
    })

    it('reports a transport failure as an unreachable RPC, not an on-chain verdict', async () => {
      vi.useFakeTimers()
      // Shape of a real failure: viem wraps the transport error, keeping it
      // in the cause chain (e.g. Reown's RPC proxy 403ing a >16KB estimate).
      const httpError = Object.assign(new Error('HTTP request failed.\nURL: …'), {
        name: 'HttpRequestError',
        shortMessage: 'HTTP request failed.',
      })
      const wrapped = Object.assign(new Error('Gas estimation failed'), {
        shortMessage: 'HTTP request failed.',
        cause: httpError,
      })
      estimateContractGas.mockRejectedValue(wrapped)

      const assertion = expect(payForQuotes({} as any, PAYMENTS)).rejects.toThrow(
        "Couldn't reach the Arbitrum RPC to estimate gas: HTTP request failed.",
      )
      await vi.advanceTimersByTimeAsync(3_000)
      await assertion

      expect(writeContract).not.toHaveBeenCalled()
    })

    it('preflights the approve tx too when an approval is needed', async () => {
      vi.mocked(readContract).mockResolvedValue(0n)
      estimateContractGas.mockResolvedValue(60_000n)

      await payForQuotes({} as any, PAYMENTS)

      expect(writeContract).toHaveBeenCalledTimes(2)
      const approveTx = vi.mocked(writeContract).mock.calls[0][1] as any
      expect(approveTx.functionName).toBe('approve')
      expect(approveTx.gas).toBe(90_000n)
      const payTx = vi.mocked(writeContract).mock.calls[1][1] as any
      expect(payTx.functionName).toBe('payForQuotes')
      expect(payTx.gas).toBe(90_000n)
    })
  })

  describe('merklePaymentGroups', () => {
    it('chunks contiguously at the cap with the remainder last', () => {
      const groups = merklePaymentGroups([1, 2, 3, 4, 5], 4)
      expect(groups).toEqual([[1, 2, 3, 4], [5]])
    })

    it('degenerates to singleton groups at cap ≤ 1 (legacy loop shape)', () => {
      expect(merklePaymentGroups([1, 2, 3], 1)).toEqual([[1], [2], [3]])
      expect(merklePaymentGroups([1, 2, 3], 0)).toEqual([[1], [2], [3]])
    })

    it('handles an empty batch list', () => {
      expect(merklePaymentGroups([], 4)).toEqual([])
    })
  })

  describe('extractMerklePaymentEvents', () => {
    const HASH_A = `0x${'aa'.repeat(32)}` as const
    const HASH_B = `0x${'bb'.repeat(32)}` as const
    const merkleLog = (winnerPoolHash: `0x${string}`, totalAmount: bigint) =>
      encodeMerklePaymentLog(winnerPoolHash, 8, totalAmount, 1_754_870_400n)

    it('returns every MerklePaymentMade in log order, skipping foreign logs', () => {
      const logs = [
        { data: '0x' as const, topics: [] as any }, // not decodable — skipped
        merkleLog(HASH_B, 2n),
        merkleLog(HASH_A, 1n),
      ]
      const events = extractMerklePaymentEvents(logs)
      // Log order, NOT sorted: index i must belong to tree i.
      expect(events.map(e => e.winnerPoolHash)).toEqual([HASH_B, HASH_A])
      expect(events.map(e => e.totalAmount)).toEqual([2n, 1n])
    })
  })

  describe('payForMerkleTrees', () => {
    const estimateContractGas = vi.fn()
    const HASH_A = `0x${'aa'.repeat(32)}` as const
    const HASH_B = `0x${'bb'.repeat(32)}` as const
    const merkleLog = (winnerPoolHash: `0x${string}`, totalAmount: bigint) =>
      encodeMerklePaymentLog(winnerPoolHash, 3, totalAmount, 1_754_870_400n)

    const BATCHES: MerkleBatchPaymentInput[] = [
      {
        depth: 3,
        pool_commitments: [
          {
            pool_hash: `0x${'11'.repeat(32)}`,
            candidates: [{ rewards_address: `0x${'22'.repeat(20)}`, amount: '5' }],
          },
        ],
        timestamp: 1_754_870_400,
      },
      {
        depth: 3,
        pool_commitments: [
          {
            pool_hash: `0x${'33'.repeat(32)}`,
            candidates: [{ rewards_address: `0x${'44'.repeat(20)}`, amount: '7' }],
          },
        ],
        timestamp: 1_754_870_401,
      },
    ]

    beforeEach(() => {
      vi.mocked(getAccount).mockReturnValue({ address: ACCOUNT, chainId: 42161 } as any)
      vi.mocked(getPublicClient).mockReturnValue({ estimateContractGas } as any)
      // Standing allowance already covers the group — no approve tx.
      vi.mocked(readContract).mockResolvedValue(STANDING_ALLOWANCE)
      vi.mocked(writeContract).mockResolvedValue('0xtxhash' as any)
      estimateContractGas.mockResolvedValue(2_000_000n)
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({
        gasUsed: 100_000n,
        effectiveGasPrice: 20_000_000n,
        logs: [merkleLog(HASH_A, 111n), merkleLog(HASH_B, 222n)],
      } as any)
    })

    afterEach(() => {
      vi.clearAllMocks()
      estimateContractGas.mockReset()
    })

    it('pays the whole group in one transaction and aligns hashes to input order', async () => {
      const result = await payForMerkleTrees({} as any, BATCHES)

      expect(writeContract).toHaveBeenCalledTimes(1)
      const tx = vi.mocked(writeContract).mock.calls[0][1] as any
      expect(tx.functionName).toBe('payForMerkleTrees')
      const trees = tx.args[0]
      expect(trees).toHaveLength(2)
      expect(trees[0].merklePaymentTimestamp).toBe(1_754_870_400n)
      expect(trees[1].merklePaymentTimestamp).toBe(1_754_870_401n)

      expect(result.winnerPoolHashes).toEqual([HASH_A, HASH_B])
      expect(result.totalPaid).toBe(333n)
      expect(result.gasSpent).toBe(100_000n * 20_000_000n)
    })

    it('throws when the event count does not match the tree count', async () => {
      vi.mocked(waitForTransactionReceipt).mockResolvedValue({
        gasUsed: 100_000n,
        effectiveGasPrice: 20_000_000n,
        logs: [merkleLog(HASH_A, 111n)],
      } as any)

      await expect(payForMerkleTrees({} as any, BATCHES)).rejects.toThrow(
        'emitted 1 MerklePaymentMade event(s) for 2 trees',
      )
    })
  })

  describe('batchedMerkleTreesPerTx', () => {
    beforeEach(() => {
      _resetBatchedVaultSupportCache()
      vi.mocked(getAccount).mockReturnValue({ address: ACCOUNT, chainId: 42161 } as any)
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('clamps the on-chain max to the client cap and caches the answer', async () => {
      vi.mocked(readContract).mockResolvedValue(16n)

      expect(await batchedMerkleTreesPerTx({} as any)).toBe(MERKLE_TREES_PER_PAYMENT)
      expect(await batchedMerkleTreesPerTx({} as any)).toBe(MERKLE_TREES_PER_PAYMENT)
      expect(readContract).toHaveBeenCalledTimes(1)
    })

    it('honors a lower on-chain cap', async () => {
      vi.mocked(readContract).mockResolvedValue(2n)
      expect(await batchedMerkleTreesPerTx({} as any)).toBe(2)
    })

    it('reads a revert as a legacy vault and caches that verdict', async () => {
      vi.mocked(readContract).mockRejectedValue(
        Object.assign(new Error('function does not exist'), {
          shortMessage: 'The contract function "MAX_TREES_PER_PAYMENT" reverted.',
        }),
      )

      expect(await batchedMerkleTreesPerTx({} as any)).toBe(0)
      expect(await batchedMerkleTreesPerTx({} as any)).toBe(0)
      expect(readContract).toHaveBeenCalledTimes(1)
    })

    it('does not cache a transport failure — the next upload re-probes', async () => {
      vi.mocked(readContract).mockRejectedValue(
        Object.assign(new Error('fetch failed'), { name: 'HttpRequestError' }),
      )

      expect(await batchedMerkleTreesPerTx({} as any)).toBe(0)
      expect(await batchedMerkleTreesPerTx({} as any)).toBe(0)
      expect(readContract).toHaveBeenCalledTimes(2)
    })
  })
})
