import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockInvoke, mockListen, resetTauriMocks, setMockInvokeHandler } from '../mocks/tauri'
import { useFilesStore } from '~/stores/files'

// The store imports the on-chain payment helpers at module scope; mock them so
// upload-flow tests can drive the merkle path without a wallet. Formatters are
// identity functions — tests assert flow, not display formatting.
vi.mock('~/utils/payment', () => ({
  payForQuotes: vi.fn(),
  payForMerkleTree: vi.fn(async () => ({
    winnerPoolHash: `0x${'ab'.repeat(32)}`,
    totalPaid: BigInt(1000),
    gasSpent: BigInt(21),
  })),
  formatNanoTokens: (v: string) => v,
  formatGasCost: (v: string) => v,
}))

describe('files store — upload history persistence', () => {
  let store: ReturnType<typeof useFilesStore>

  beforeEach(() => {
    resetTauriMocks()
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

  describe('merkle storage failure after successful payment', () => {
    it('marks the row failed with the storage error, not as a payment failure', async () => {
      store.files.push({
        id: 1,
        kind: 'upload',
        name: 'big.bin',
        size_bytes: 300 * 1024 * 1024,
        path: 'C:/tmp/big.bin',
        status: 'queued_for_upload',
        date: '2026-08-11T00:00:00Z',
      } as any)

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
          quoteCb?.({
            payload: {
              upload_id: args.request.upload_id,
              payment_mode: 'merkle',
              payments: [],
              total_cost: '0',
              payment_required: true,
              merkle_depth: 7,
              merkle_pool_commitments: [],
              merkle_timestamp: 1754870400,
            },
          })
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
})
