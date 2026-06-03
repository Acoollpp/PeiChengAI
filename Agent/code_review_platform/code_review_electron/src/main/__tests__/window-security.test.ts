import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn()
  }
}))

describe('window security', () => {
  it('only treats http, https and mailto URLs as safe external URLs', async () => {
    const { isSafeExternalUrl } = await import('../window-security')

    expect(isSafeExternalUrl('https://example.com/report')).toBe(true)
    expect(isSafeExternalUrl('http://example.com/report')).toBe(true)
    expect(isSafeExternalUrl('mailto:security@example.com')).toBe(true)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('file:///tmp/report.md')).toBe(false)
    expect(isSafeExternalUrl('/relative/path')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })

  it('opens safe new-window URLs externally and denies Electron window creation', async () => {
    const setWindowOpenHandler = vi.fn()
    const openExternal = vi.fn()
    const { configureExternalLinkHandling } = await import('../window-security')

    configureExternalLinkHandling(
      {
        webContents: {
          setWindowOpenHandler
        }
      } as never,
      openExternal as never
    )

    const handler = setWindowOpenHandler.mock.calls[0]?.[0]

    expect(handler({ url: 'https://example.com/report' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com/report')
  })

  it('denies unsafe new-window URLs without opening them externally', async () => {
    const setWindowOpenHandler = vi.fn()
    const openExternal = vi.fn()
    const { configureExternalLinkHandling } = await import('../window-security')

    configureExternalLinkHandling(
      {
        webContents: {
          setWindowOpenHandler
        }
      } as never,
      openExternal as never
    )

    const handler = setWindowOpenHandler.mock.calls[0]?.[0]

    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })
})
