import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const prepareCodeGraphBeforePack = require('../../../scripts/prepare-codegraph-before-pack.cjs') as (
  context: { electronPlatformName: string; arch: number }
) => Promise<void>

describe('CodeGraph beforePack', () => {
  it('非 Windows 打包目标不准备 CodeGraph 资源', async () => {
    await expect(
      prepareCodeGraphBeforePack({ electronPlatformName: 'darwin', arch: 3 })
    ).resolves.toBeUndefined()
  })

  it('明确拒绝 Windows 非 x64 打包目标', async () => {
    await expect(
      prepareCodeGraphBeforePack({ electronPlatformName: 'win32', arch: 3 })
    ).rejects.toThrow('仅支持 Windows x64')
  })
})
