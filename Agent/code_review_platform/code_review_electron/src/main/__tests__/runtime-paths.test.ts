import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

describe('runtime paths', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('uses a sibling data directory when Electron is packaged', async () => {
    vi.doMock('electron', () => ({
      app: {
        isPackaged: true,
        getPath: vi.fn((name: string) => {
          if (name === 'exe') {
            return 'D:\\SoftWare\\code-review-electron\\AI代码审查客户端.exe'
          }
          throw new Error(`unexpected path request ${name}`)
        })
      }
    }))

    const { getRuntimePaths } = await import('../runtime-paths')
    const paths = await getRuntimePaths()

    expect(paths.runtimeRoot).toBe('D:\\SoftWare\\code-review-electron-data')
    expect(paths.skillPackagesDir).toBe(
      'D:\\SoftWare\\code-review-electron-data\\skill-packages'
    )
    expect(paths.skillManifestPath).toBe(
      'D:\\SoftWare\\code-review-electron-data\\skill-packages\\manifest.json'
    )
    expect(paths.workspacesDir).toBe('D:\\SoftWare\\code-review-electron-data\\workspaces')
    expect(paths.workspaceForTask('task-1')).toBe(
      'D:\\SoftWare\\code-review-electron-data\\workspaces\\task-1'
    )
    expect(paths.reportPathForTask('task-1')).toBe(
      'D:\\SoftWare\\code-review-electron-data\\workspaces\\task-1\\代码审查报告.md'
    )
    expect(paths.imagesDirForTask?.('task-1')).toBe(
      'D:\\SoftWare\\code-review-electron-data\\workspaces\\task-1\\images'
    )
  })

  it('uses a local .runtime-data directory when Electron is not packaged', async () => {
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getAppPath: vi.fn(() => 'D:\\repo\\code_review_electron')
      }
    }))

    const { getRuntimePaths } = await import('../runtime-paths')
    const paths = await getRuntimePaths()

    expect(paths.runtimeRoot).toBe(join('D:\\repo\\code_review_electron', '.runtime-data'))
    expect(paths.workspaceForTask('task-2')).toBe(
      join('D:\\repo\\code_review_electron', '.runtime-data', 'workspaces', 'task-2')
    )
    expect(paths.imagesDirForTask?.('task-2')).toBe(
      join('D:\\repo\\code_review_electron', '.runtime-data', 'workspaces', 'task-2', 'images')
    )
  })
})
