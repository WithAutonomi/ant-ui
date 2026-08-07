import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getAccount,
  getPublicClient,
  readContract,
  writeContract,
  waitForTransactionReceipt,
} from '@wagmi/core'
import {
  STANDING_ALLOWANCE,
  GAS_LIMIT_CAP,
  approvalAmountFor,
  boundedGasLimit,
  payForQuotes,
  type RawPayment,
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
})
