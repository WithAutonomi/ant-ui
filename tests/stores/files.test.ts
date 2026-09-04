import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockInvoke, mockListen, resetTauriMocks, setMockInvokeHandler } from '../mocks/tauri'
import { useFilesStore } from '~/stores/files'

// The store imports the on-chain payment helpers at module scope; mock them so
// upload-flow tests can drive the merkle path without a wallet. Formatters are
// identity functions — tests assert flow, not display formatting.
const mockPayForMerkleTree = vi.fn(async () => ({
  winnerPoolHash: `0x${'ab'.repeat(32)}`,
  totalPaid: BigInt(1000),
  gasSpent: BigInt(21),
}))
// Distinct hash per position so alignment mistakes can't cancel out.
const mockPayForMerkleTrees = vi.fn(async (_config: unknown, group: unknown[]) => ({
  winnerPoolHashes: group.map((_, i) => `0x${(0x10 + i).toString(16).repeat(32)}`),
  totalPaid: BigInt(1000) * BigInt(group.length),
  gasSpent: BigInt(21),
}))
// Legacy vault by default: existing tests drive the per-tree loop.
const mockBatchedMerkleTreesPerTx = vi.fn(async () => 0)
const mockPayForQuotes = vi.fn(async () => ({
  txHashMap: { '0xquote1': '0xtxhash1' },
  totalPaid: BigInt(500),
  gasSpent: BigInt(21),
}))
vi.mock('~/utils/payment', () => ({
  payForQuotes: (...args: unknown[]) => mockPayForQuotes(...(args as [])),
  payForMerkleTree: (...args: unknown[]) => mockPayForMerkleTree(...(args as [])),
  payForMerkleTrees: (...args: unknown[]) => mockPayForMerkleTrees(...(args as [unknown, unknown[]])),
  batchedMerkleTreesPerTx: (...args: unknown[]) => mockBatchedMerkleTreesPerTx(...(args as [])),
  // Real grouping semantics: the loop's index math is what the store tests
  // are exercising.
  merklePaymentGroups: <T,>(batches: T[], perTx: number): T[][] => {
    const size = Math.max(1, Math.floor(perTx))
    const groups: T[][] = []
    for (let i = 0; i < batches.length; i += size) groups.push(batches.slice(i, i + size))
    return groups
  },
  ensureAllowanceForMerkleBatches: vi.fn(async () => BigInt(0)),
  formatNanoTokens: (v: string) => v,
  formatGasCost: (v: string) => v,
}))

describe('files store — upload history persistence', () => {
  let store: ReturnType<typeof useFilesStore>

  beforeEach(() => {
    resetTauriMocks()
    mockPayForMerkleTree.mockClear()
    mockPayForMerkleTrees.mockClear()
    mockBatchedMerkleTreesPerTx.mockClear()
    mockPayForQuotes.mockClear()
    store = useFilesStore()
    store.$reset()
  })

  describe('loadHistory + persistHistory', () => {
    it('marks load successful and allows persistHistory to write', async () => {
      const saveCalls: any[] = []
      setMockInvokeHandler((cmd, args) => {
        if (cmd === 'load_upload_history') {
          return [
            {
              name: 'foo.pdf',
              size_bytes: 1024,
              address: '0xabc',
              cost: '0.01',
              uploaded_at: '2026-05-01T00:00:00Z',
              data_map_file: '/cfg/foo.datamap',
              gas_cost: null,
              public_address: null,
            },
          ]
        }
        if (cmd === 'save_upload_history') {
          saveCalls.push(args)
        }
      })

      await store.loadHistory()
      expect(store.historyLoaded).toBe(true)
      expect(store.historyLoadFailed).toBe(false)
      expect(store.files).toHaveLength(1)

      await store.persistHistory()
      expect(saveCalls).toHaveLength(1)
      expect(saveCalls[0].entries).toHaveLength(1)
      expect(saveCalls[0].entries[0].address).toBe('0xabc')
    })

    it('flags failure and refuses to overwrite on-disk file when load throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})

      let saveInvoked = false
      setMockInvokeHandler((cmd) => {
        if (cmd === 'load_upload_history') {
          throw new Error('parse error: unexpected token')
        }
        if (cmd === 'save_upload_history') {
          saveInvoked = true
        }
      })

      await store.loadHistory()
      expect(store.historyLoaded).toBe(true)
      expect(store.historyLoadFailed).toBe(true)
      expect(store.files).toHaveLength(0)

      // Even after a "settled" upload row is appended, persistHistory must be
      // a no-op — writing now would clobber upload_history.json with an array
      // containing only this new entry and orphan every prior datamap.
      store.files.push({
        id: 999,
        kind: 'upload',
        name: 'new.pdf',
        size_bytes: 1,
        address: '0xnew',
        status: 'complete',
        date: '2026-05-12T00:00:00Z',
      } as any)

      await store.persistHistory()
      expect(saveInvoked).toBe(false)
      expect(warnSpy).toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    it('clears the failure flag on a subsequent successful load', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})

      // First call: fail.
      mockInvoke.mockImplementationOnce(() => {
        throw new Error('transient')
      })
      await store.loadHistory()
      expect(store.historyLoadFailed).toBe(true)

      // Second call: succeed.
      mockInvoke.mockImplementationOnce(() => [])
      await store.loadHistory()
      expect(store.historyLoadFailed).toBe(false)
    })
  })

  describe('cancel during the post-approval quote', () => {
    it('aborts before payment when the row is cancelled while the quote is in flight', async () => {
      store.files.push({
        id: 1,
        kind: 'upload',
        name: 'a.bin',
        size_bytes: 10,
        path: 'C:/tmp/a.bin',
        status: 'queued_for_upload',
        date: '2026-07-30T00:00:00Z',
      } as any)

      // Capture the upload-quote listener so the mocked backend can answer.
      let quoteCb: ((event: any) => void) | null = null
      mockListen.mockImplementation(((event: string, cb: any) => {
        if (event === 'upload-quote') quoteCb = cb
        return Promise.resolve(vi.fn())
      }) as any)

      const invoked: string[] = []
      setMockInvokeHandler((cmd, args) => {
        invoked.push(cmd)
        if (cmd === 'start_upload') {
          // The user cancels the row while the quote is being collected…
          store.cancelPendingUpload(1)
          // …and the backend still answers with a (free) quote. With
          // payment_required=false the pre-fix flow would fall straight
          // through to confirm_upload — the sentinel asserted below.
          quoteCb?.({
            payload: {
              upload_id: args.request.upload_id,
              payment_mode: 'regular',
              payments: [],
              total_cost: '0',
              payment_required: false,
            },
          })
        }
      })

      await store.startRealUpload(1, {}, { visibility: 'private', paymentMode: 'regular' })

      expect(store.findById(1)).toBeUndefined()
      expect(invoked).toContain('start_upload')
      expect(invoked).not.toContain('confirm_upload')
    })
  })

  describe('merkle multi-batch payments', () => {
    const pushRow = () => {
      store.files.push({
        id: 1,
        kind: 'upload',
        name: 'big.bin',
        size_bytes: 2200 * 1024 * 1024,
        path: 'C:/tmp/big.bin',
        status: 'queued_for_upload',
        date: '2026-08-11T00:00:00Z',
      } as any)
    }

    const twoBatchQuote = (uploadId: string) => ({
      upload_id: uploadId,
      payment_mode: 'merkle',
      payments: [],
      total_cost: '0',
      payment_required: true,
      merkle_batches: [
        { depth: 8, pool_commitments: [], timestamp: 1754870400 },
        { depth: 6, pool_commitments: [], timestamp: 1754870400 },
      ],
    })

    it('pays one transaction per batch and confirms with all winner hashes', async () => {
      pushRow()
      let quoteCb: ((event: any) => void) | null = null
      mockListen.mockImplementation(((event: string, cb: any) => {
        if (event === 'upload-quote') quoteCb = cb
        return Promise.resolve(vi.fn())
      }) as any)

      let confirmArgs: any = null
      setMockInvokeHandler((cmd, args) => {
        if (cmd === 'start_upload') {
          quoteCb?.({ payload: twoBatchQuote(args.request.upload_id) })
        }
        if (cmd === 'confirm_upload_merkle') {
          confirmArgs = args
          return {
            upload_id: args.uploadId,
            data_map_json: '{}',
            address: '0xdead',
            chunks_stored: 555,
            data_map_file: '/cfg/big.bin.datamap',
            public_address: null,
          }
        }
      })

      await store.startRealUpload(1, {}, { visibility: 'private', paymentMode: 'merkle' })

      expect(mockPayForMerkleTree).toHaveBeenCalledTimes(2)
      expect(confirmArgs.winnerPoolHashes).toEqual([
        `0x${'ab'.repeat(32)}`,
        `0x${'ab'.repeat(32)}`,
      ])
      expect(store.findById(1)?.status).toBe('complete')
    })

    it('settles groups of the probed cap in one batched transaction each (V2-949)', async () => {
      pushRow()
      let quoteCb: ((event: any) => void) | null = null
      mockListen.mockImplementation(((event: string, cb: any) => {
        if (event === 'upload-quote') quoteCb = cb
        return Promise.resolve(vi.fn())
      }) as any)

      // Vault supports batching: 5 trees → a batched group of 4 plus a
      // legacy singleton — two wallet confirmations instead of five.
      mockBatchedMerkleTreesPerTx.mockResolvedValueOnce(4)
      const fiveBatchQuote = (uploadId: string) => ({
        upload_id: uploadId,
        payment_mode: 'merkle',
        payments: [],
        total_cost: '0',
        payment_required: true,
        merkle_batches: Array.from({ length: 5 }, (_, i) => ({
          depth: 8 - (i % 2),
          pool_commitments: [],
          timestamp: 1754870400,
        })),
      })

      let confirmArgs: any = null
      setMockInvokeHandler((cmd, args) => {
        if (cmd === 'start_upload') {
          quoteCb?.({ payload: fiveBatchQuote(args.request.upload_id) })
        }
        if (cmd === 'confirm_upload_merkle') {
          confirmArgs = args
          return {
            upload_id: args.uploadId,
            data_map_json: '{}',
            address: '0xdead',
            chunks_stored: 1280,
            data_map_file: '/cfg/big.bin.datamap',
            public_address: null,
          }
        }
      })

      await store.startRealUpload(1, {}, { visibility: 'private', paymentMode: 'merkle' })

      // One batched call carrying the 4-tree group…
      expect(mockPayForMerkleTrees).toHaveBeenCalledTimes(1)
      expect(mockPayForMerkleTrees.mock.calls[0]![1]).toHaveLength(4)
      // …and the trailing singleton stays on the legacy entry point.
      expect(mockPayForMerkleTree).toHaveBeenCalledTimes(1)
      // Winner hashes land on their tree's position: batched group hashes
      // in order, then the legacy singleton's.
      expect(confirmArgs.winnerPoolHashes).toEqual([
        `0x${(0x10).toString(16).repeat(32)}`,
        `0x${(0x11).toString(16).repeat(32)}`,
        `0x${(0x12).toString(16).repeat(32)}`,
        `0x${(0x13).toString(16).repeat(32)}`,
        `0x${'ab'.repeat(32)}`,
      ])
      expect(store.findById(1)?.status).toBe('complete')
    })

    it('finalizes paid batches when the user abandons a later payment', async () => {
      pushRow()
      let quoteCb: ((event: any) => void) | null = null
      mockListen.mockImplementation(((event: string, cb: any) => {
        if (event === 'upload-quote') quoteCb = cb
        return Promise.resolve(vi.fn())
      }) as any)

      // First payment succeeds, second is rejected in the wallet.
      mockPayForMerkleTree
        .mockResolvedValueOnce({
          winnerPoolHash: `0x${'ab'.repeat(32)}`,
          totalPaid: BigInt(1000),
          gasSpent: BigInt(21),
        })
        .mockRejectedValueOnce(new Error('User rejected the request'))

      const incomplete =
        'Upload incomplete: 256 of 555 chunks reached the network (299 failed after retries), so the file is not retrievable yet.'
      let confirmArgs: any = null
      setMockInvokeHandler((cmd, args) => {
        if (cmd === 'start_upload') {
          quoteCb?.({ payload: twoBatchQuote(args.request.upload_id) })
        }
        if (cmd === 'confirm_upload_merkle') {
          confirmArgs = args
          throw new Error(incomplete)
        }
      })

      await store.startRealUpload(1, {}, { visibility: 'private', paymentMode: 'merkle' })

      // The paid batch is still finalized (its chunks store; a later retry
      // only re-pays the remainder), and the row reports the incomplete
      // upload — not a payment failure and not silent success.
      expect(confirmArgs.winnerPoolHashes).toEqual([`0x${'ab'.repeat(32)}`, null])
      const entry = store.findById(1)
      expect(entry?.status).toBe('failed')
      expect(entry?.error).toContain('Upload incomplete')
      expect(entry?.error).not.toContain('Payment failed')
    })

    it('waits out a slow receipt instead of misclassifying the batch as unpaid', async () => {
      pushRow()
      let quoteCb: ((event: any) => void) | null = null
      mockListen.mockImplementation(((event: string, cb: any) => {
        if (event === 'upload-quote') quoteCb = cb
        return Promise.resolve(vi.fn())
      }) as any)

      vi.useFakeTimers()
      try {
        // First batch: the tx broadcasts but its receipt lands only after
        // 400 s. The old 300 s withTimeout raced this whole span, so a slow
        // receipt discarded the winner hash, reported "Payment failed"
        // (paidCount 0), and a retry could pay the same batch again — the
        // #213 review blocker. No timer may fire in the payment loop.
        mockPayForMerkleTree.mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    winnerPoolHash: `0x${'cd'.repeat(32)}`,
                    totalPaid: BigInt(1000),
                    gasSpent: BigInt(21),
                  }),
                400_000,
              ),
            ),
        )

        let confirmArgs: any = null
        setMockInvokeHandler((cmd, args) => {
          if (cmd === 'start_upload') {
            quoteCb?.({ payload: twoBatchQuote(args.request.upload_id) })
          }
          if (cmd === 'confirm_upload_merkle') {
            confirmArgs = args
            return {
              upload_id: args.uploadId,
              data_map_json: '{}',
              address: '0xdead',
              chunks_stored: 555,
              data_map_file: '/cfg/big.bin.datamap',
              public_address: null,
            }
          }
        })

        const run = store.startRealUpload(1, {}, { visibility: 'private', paymentMode: 'merkle' })

        // At +300 s the removed timeout would have fired: the row must still
        // be waiting on the receipt, not failed, and batch 1 not re-attempted.
        await vi.advanceTimersByTimeAsync(300_000)
        expect(store.findById(1)?.status).toBe('paying')
        expect(mockPayForMerkleTree).toHaveBeenCalledTimes(1)

        // Receipt arrives: the preserved hash is used, batch 2 pays normally,
        // and no batch is ever paid twice.
        await vi.advanceTimersByTimeAsync(100_000)
        await run

        expect(mockPayForMerkleTree).toHaveBeenCalledTimes(2)
        expect(confirmArgs.winnerPoolHashes).toEqual([
          `0x${'cd'.repeat(32)}`,
          `0x${'ab'.repeat(32)}`,
        ])
        expect(store.findById(1)?.status).toBe('complete')
      } finally {
        vi.useRealTimers()
      }
    })

    it('marks the row failed with the storage error, not as a payment failure', async () => {
      pushRow()
      let quoteCb: ((event: any) => void) | null = null
      mockListen.mockImplementation(((event: string, cb: any) => {
        if (event === 'upload-quote') quoteCb = cb
        return Promise.resolve(vi.fn())
      }) as any)

      // Backend guard message for a partial merkle store (ant-client#166):
      // payment succeeded on-chain but chunks fell short of quorum.
      const incomplete =
        'Upload incomplete: 97 of 100 chunks reached the network (3 failed after retries), so the file is not retrievable yet.'
      setMockInvokeHandler((cmd, args) => {
        if (cmd === 'start_upload') {
          quoteCb?.({ payload: twoBatchQuote(args.request.upload_id) })
        }
        if (cmd === 'confirm_upload_merkle') {
          throw new Error(incomplete)
        }
      })

      await store.startRealUpload(1, {}, { visibility: 'private', paymentMode: 'merkle' })

      const entry = store.findById(1)
      expect(entry?.status).toBe('failed')
      expect(entry?.error).toContain('Upload incomplete')
      expect(entry?.error).not.toContain('Payment failed')
    })
  })

  describe('wave-batch payment with a slow receipt', () => {
    it('waits out a slow receipt instead of misclassifying the payment as failed', async () => {
      store.files.push({
        id: 1,
        kind: 'upload',
        name: 'a.bin',
        size_bytes: 10 * 1024 * 1024,
        path: 'C:/tmp/a.bin',
        status: 'queued_for_upload',
        date: '2026-08-12T00:00:00Z',
      } as any)

      let quoteCb: ((event: any) => void) | null = null
      mockListen.mockImplementation(((event: string, cb: any) => {
        if (event === 'upload-quote') quoteCb = cb
        return Promise.resolve(vi.fn())
      }) as any)

      vi.useFakeTimers()
      try {
        // The tx broadcasts but its receipt lands only after 400 s. The old
        // 300 s withTimeout raced the whole payForQuotes span, so a slow
        // receipt discarded the tx hashes, reported "Payment failed", and a
        // retry could pay the same quotes again (V2-964, reproduced in the
        // #212 review). No timer may race the payment.
        mockPayForQuotes.mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    txHashMap: { '0xquote1': '0xtxhash1' },
                    totalPaid: BigInt(500),
                    gasSpent: BigInt(21),
                  }),
                400_000,
              ),
            ),
        )

        let confirmArgs: any = null
        setMockInvokeHandler((cmd, args) => {
          if (cmd === 'start_upload') {
            quoteCb?.({
              payload: {
                upload_id: args.request.upload_id,
                payment_mode: 'regular',
                payments: [],
                total_cost: '0',
                payment_required: true,
              },
            })
          }
          if (cmd === 'confirm_upload') {
            confirmArgs = args
            return {
              upload_id: args.uploadId,
              data_map_json: '{}',
              address: '0xdead',
              chunks_stored: 3,
              data_map_file: '/cfg/a.bin.datamap',
              public_address: null,
            }
          }
        })

        const run = store.startRealUpload(1, {}, { visibility: 'private', paymentMode: 'regular' })

        // At +300 s the removed timeout would have fired: the row must still
        // be waiting on the receipt, not failed.
        await vi.advanceTimersByTimeAsync(300_000)
        expect(store.findById(1)?.status).toBe('paying')
        expect(mockPayForQuotes).toHaveBeenCalledTimes(1)

        // Receipt arrives: the tx hashes are preserved and passed to
        // confirm_upload — nothing is ever paid twice.
        await vi.advanceTimersByTimeAsync(100_000)
        await run

        expect(mockPayForQuotes).toHaveBeenCalledTimes(1)
        expect(confirmArgs.txHashes).toEqual({ '0xquote1': '0xtxhash1' })
        expect(store.findById(1)?.status).toBe('complete')
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
