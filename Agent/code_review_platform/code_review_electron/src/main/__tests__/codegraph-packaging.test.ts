import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()

describe('CodeGraph Windows x64 打包清单', () => {
  it('固定官方 1.4.1 资产、校验值和完整资源树摘要', async () => {
    const metadata = JSON.parse(
      await readFile(join(projectRoot, 'resources', 'codegraph', 'metadata.json'), 'utf8')
    )

    expect(metadata).toMatchObject({
      version: '1.4.1',
      platform: 'win32',
      arch: 'x64',
      publishedAt: '2026-07-10T22:40:02Z',
      asset: {
        name: 'codegraph-win32-x64.zip',
        url: 'https://github.com/colbymchenry/codegraph/releases/download/v1.4.1/codegraph-win32-x64.zip',
        size: 46_005_713,
        sha256: '559cb1010b7899b5137f0801d35698f722a33370e907a84968852d3d68f6458d'
      },
      runtime: {
        fileCount: 853,
        unpackedBytes: 203_338_322,
        treeSha256: '6e04c8570e795ff31c8c3afe14b3cb7649edc2985f0a71fac4ac5b9b594a9549'
      },
      license: 'MIT',
      licenseSha256: 'e6d98f98c666bebe065ac2492a0a19232cc318d4d67bac3ca42ffb77bacc8809'
    })
  })

  it('仅把 Windows x64 运行时、元数据和许可证放入 app.asar 外', async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))

    expect(packageJson.build.files).not.toContain('build/codegraph-runtime/**/*')
    expect(packageJson.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(packageJson.build.win.extraResources).toEqual(
      expect.arrayContaining([
        {
          from: 'build/codegraph-runtime/win32-x64',
          to: 'codegraph/win32-x64'
        },
        {
          from: 'resources/codegraph/legal',
          to: 'codegraph/legal'
        },
        {
          from: 'resources/codegraph/metadata.json',
          to: 'codegraph/metadata.json'
        }
      ])
    )
    expect(packageJson.build.beforePack).toBe('scripts/prepare-codegraph-before-pack.cjs')
  })

  it('保留 CodeGraph MIT 许可证和第三方依赖声明', async () => {
    const [license, notices] = await Promise.all([
      readFile(
        join(projectRoot, 'resources', 'codegraph', 'legal', 'LICENSE-CodeGraph.txt'),
        'utf8'
      ),
      readFile(
        join(projectRoot, 'resources', 'codegraph', 'legal', 'THIRD-PARTY-NOTICES.md'),
        'utf8'
      )
    ])

    expect(license).toContain('MIT License')
    expect(license).toContain('Copyright (c) 2026 Colby Mchenry')
    expect(createHash('sha256').update(license).digest('hex')).toBe(
      'e6d98f98c666bebe065ac2492a0a19232cc318d4d67bac3ca42ffb77bacc8809'
    )
    expect(notices).toContain('CodeGraph 1.4.1')
    expect(notices).toContain('lib/node_modules')
  })
})
