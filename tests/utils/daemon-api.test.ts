import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockInvoke, resetTauriMocks, setMockInvokeHandler } from '../mocks/tauri'
import { useSettingsStore } from '~/stores/settings'

// daemonApi calls useSettingsStore() to read the daemon URL — make sure the
// store is fresh per test.
beforeEach(() => {
  resetTauriMocks()
  const store = useSettingsStore()
  store.$reset()
  store.daemonUrl = 'http://127.0.0.1:12500'
})

describe('daemon-api request — error envelope unwrap', () => {
  it('strips the {"error": "..."} envelope from a 5xx body', async () => {
    const { daemonApi } = await import('~/utils/daemon-api')
    setMockInvokeHandler(() => {
      throw '{"error":"I/O error: Access is denied. (os error 5)"}'
    })

    await expect(daemonApi.status()).rejects.toMatchObject({
      name: 'DaemonApiError',
      message: 'I/O error: Access is denied. (os error 5)',
    })
  })

  it('passes through a plain-string error unchanged (Tauri/network errors)', async () => {
    const { daemonApi } = await import('~/utils/daemon-api')
    setMockInvokeHandler(() => {
      throw 'Cannot connect to daemon — is it running?'
    })

    await expect(daemonApi.status()).rejects.toMatchObject({
      message: 'Cannot connect to daemon — is it running?',
    })
  })

  it('falls back to the raw body when JSON parses but has no .error field', async () => {
    const { daemonApi } = await import('~/utils/daemon-api')
    const body = '{"detail":"unexpected shape"}'
    setMockInvokeHandler(() => { throw body })

    await expect(daemonApi.status()).rejects.toMatchObject({ message: body })
  })

  it('falls back to the raw body when the body is malformed JSON', async () => {
    const { daemonApi } = await import('~/utils/daemon-api')
    const body = '{"error": not-json}'
    setMockInvokeHandler(() => { throw body })

    await expect(daemonApi.status()).rejects.toMatchObject({ message: body })
  })

  it('uses .message when invoke rejects with an Error instance', async () => {
    const { daemonApi } = await import('~/utils/daemon-api')
    mockInvoke.mockRejectedValueOnce(new Error('{"error":"validation failed: rewards_address"}'))

    await expect(daemonApi.status()).rejects.toMatchObject({
      message: 'validation failed: rewards_address',
    })
  })
})
