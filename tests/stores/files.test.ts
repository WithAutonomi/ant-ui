import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockInvoke, resetTauriMocks, setMockInvokeHandler } from '../mocks/tauri'
import { useFilesStore } from '~/stores/files'

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
})
