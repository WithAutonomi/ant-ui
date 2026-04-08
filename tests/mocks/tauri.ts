import { vi } from 'vitest'

/**
 * Mock responses for Tauri invoke commands.
 * Tests set up responses via `mockInvoke.mockImplementation()` or
 * `setMockInvokeHandler()` before running store actions.
 */
export const mockInvoke = vi.fn()
export const mockListen = vi.fn(() => vi.fn()) // returns unlisten fn

/** Set a handler that routes invoke calls by command name. */
export function setMockInvokeHandler(handler: (cmd: string, args?: any) => any) {
  mockInvoke.mockImplementation(handler)
}

/** Reset all mocks between tests. */
export function resetTauriMocks() {
  mockInvoke.mockReset()
  mockListen.mockReset()
  mockListen.mockReturnValue(vi.fn())
}

// Module mocks — these intercept the actual imports
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}))
