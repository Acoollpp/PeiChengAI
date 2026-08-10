import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BundledCodeGraphUnavailableError,
  createBundledCodeGraphRuntime
} from '../bundled-codegraph-runtime'

const tempDirectories: string[] = []

const fixtureFiles: Record<string, string> = {
  'bin/codegraph.cmd': '@"%~dp0..\\node.exe" --liftoff-only "%~dp0..\\lib\\dist\\bin\\codegraph.js" %*',
  'node.exe': 'fake windows x64 node executable',
  'lib/package.json': JSON.stringify({ name: '@colbymchenry/codegraph', version: '1.4.1' }),
  'lib/dist/bin/codegraph.js': 'console.log("1.4.1")',
  'lib/node_modules/parser/index.js': 'parser-v1-content'
}

const makeMetadata = () => {
  const treeHash = createHash('sha256')
  let unpackedBytes = 0
  for (const path of Object.keys(fixtureFiles).sort()) {
    const content = Buffer.from(fixtureFiles[path])
    const fileHash = createHash('sha256').update(content).digest('hex')
    unpackedBytes += content.length
    treeHash.update(`${path}\0${content.length}\0${fileHash}\n`)
  }
  const requiredFilePaths = [
    'bin/codegraph.cmd',
    'node.exe',
    'lib/package.json',
    'lib/dist/bin/codegraph.js'
  ]
  return {
    version: '1.4.1',
    runtimeDirectory: 'codegraph/win32-x64',
    runtime: {
      command: 'bin/codegraph.cmd',
      node: 'node.exe',
      entrypoint: 'lib/dist/bin/codegraph.js',
      packageJson: 'lib/package.json',
      requiredFiles: requiredFilePaths.map((path) => ({
        path,
        sha256: createHash('sha256').update(fixtureFiles[path]).digest('hex')
      })),
      fileCount: Object.keys(fixtureFiles).length,
      unpackedBytes,
      treeSha256: treeHash.digest('hex')
    }
  }
}

const createFixture = async () => {
  const root = join(
    tmpdir(),
    `PeiCheng AI Client With Spaces ${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
  tempDirectories.push(root)
  for (const [relativePath, content] of Object.entries(fixtureFiles)) {
    const filePath = join(root, ...relativePath.split('/'))
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
  return root
}

const createFixtureRuntime = async (
  versionCommand: () => Promise<{ ok: boolean; output?: string }> = vi.fn(async () => ({
    ok: true,
    output: '1.4.1'
  }))
) => {
  const root = await createFixture()
  const runtime = createBundledCodeGraphRuntime({
    platform: 'win32',
    arch: 'x64',
    runtimeRoot: root,
    metadata: makeMetadata(),
    adapter: {
      readFile,
      readdir: (path: string) => readdir(path, { withFileTypes: true }),
      stat,
      runVersionCommand: versionCommand
    }
  })
  return { root, runtime, versionCommand }
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('内置 CodeGraph 运行时', () => {
  it('在包含空格的 Windows 资源路径中返回固定版本和真实命令路径', async () => {
    const { root, runtime, versionCommand } = await createFixtureRuntime()

    await expect(runtime.inspect()).resolves.toEqual({
      status: 'ready',
      requiredVersion: '1.4.1',
      version: '1.4.1',
      commandPath: join(root, 'bin', 'codegraph.cmd'),
      commandDirectory: join(root, 'bin')
    })
    expect(versionCommand).toHaveBeenCalledWith(
      join(root, 'node.exe'),
      join(root, 'lib', 'dist', 'bin', 'codegraph.js')
    )
  })

  it('只在 Codex 子进程环境前置内置命令目录并优先于全局版本', async () => {
    const { root, runtime } = await createFixtureRuntime()
    const original = {
      PATH: 'C:\\Users\\reviewer\\global-codegraph;C:\\Windows\\System32',
      CODEX_HOME: 'C:\\Users\\reviewer\\.codex'
    }

    await expect(runtime.buildCodexEnvironment(original)).resolves.toEqual({
      ...original,
      PATH: `${join(root, 'bin')};${original.PATH}`
    })
    expect(original.PATH).toBe(
      'C:\\Users\\reviewer\\global-codegraph;C:\\Windows\\System32'
    )
  })

  it('资源缺失时报告 missing 且不回退全局 CodeGraph', async () => {
    const { root, runtime, versionCommand } = await createFixtureRuntime()
    await rm(join(root, 'node.exe'))

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'missing',
      requiredVersion: '1.4.1',
      error: expect.stringContaining('重新安装客户端')
    })
    await expect(
      runtime.buildCodexEnvironment({ PATH: 'C:\\global-codegraph' })
    ).rejects.toBeInstanceOf(BundledCodeGraphUnavailableError)
    expect(versionCommand).not.toHaveBeenCalled()
  })

  it('关键资源校验值变化时报告 corrupt', async () => {
    const { root, runtime, versionCommand } = await createFixtureRuntime()
    await writeFile(join(root, 'lib', 'dist', 'bin', 'codegraph.js'), 'damaged runtime')

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'corrupt',
      version: '1.4.1',
      error: expect.stringContaining('资源损坏')
    })
    expect(versionCommand).not.toHaveBeenCalled()
  })

  it('完整性缓存存在时仍检测 requiredFiles 之外的文件缺失并阻止构建 Codex 环境', async () => {
    const { root, runtime, versionCommand } = await createFixtureRuntime()
    await expect(runtime.inspect()).resolves.toMatchObject({ status: 'ready' })
    await rm(join(root, 'lib', 'node_modules', 'parser', 'index.js'))

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'missing',
      version: '1.4.1',
      error: expect.stringContaining('缺失')
    })
    await expect(runtime.buildCodexEnvironment({ PATH: 'C:\\global-codegraph' })).rejects.toBeInstanceOf(
      BundledCodeGraphUnavailableError
    )
    expect(versionCommand).toHaveBeenCalledTimes(1)
  })

  it('完整性缓存存在时仍检测 requiredFiles 之外的文件内容损坏', async () => {
    const { root, runtime, versionCommand } = await createFixtureRuntime()
    await expect(runtime.inspect()).resolves.toMatchObject({ status: 'ready' })
    await writeFile(
      join(root, 'lib', 'node_modules', 'parser', 'index.js'),
      'parser-v2-content'
    )

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'corrupt',
      version: '1.4.1',
      error: expect.stringContaining('资源损坏')
    })
    expect(versionCommand).toHaveBeenCalledTimes(1)
  })

  it('检测运行时目录新增的任意文件', async () => {
    const { root, runtime, versionCommand } = await createFixtureRuntime()
    await expect(runtime.inspect()).resolves.toMatchObject({ status: 'ready' })
    await writeFile(join(root, 'unexpected-file.txt'), 'unexpected')

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'corrupt',
      error: expect.stringContaining('资源损坏')
    })
    expect(versionCommand).toHaveBeenCalledTimes(1)
  })

  it('包版本不符时报告 version_mismatch', async () => {
    const { root, runtime, versionCommand } = await createFixtureRuntime()
    await writeFile(
      join(root, 'lib', 'package.json'),
      JSON.stringify({ name: '@colbymchenry/codegraph', version: '1.5.0' })
    )

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'version_mismatch',
      requiredVersion: '1.4.1',
      version: '1.5.0',
      error: expect.stringContaining('版本不符')
    })
    expect(versionCommand).not.toHaveBeenCalled()
  })

  it('假命令不可执行时报告 not_executable', async () => {
    const { runtime } = await createFixtureRuntime(
      vi.fn(async () => ({ ok: false }))
    )

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'not_executable',
      requiredVersion: '1.4.1',
      version: '1.4.1',
      error: expect.stringContaining('无法执行')
    })
  })

  it('假命令返回其他版本时报告 version_mismatch', async () => {
    const { runtime } = await createFixtureRuntime(
      vi.fn(async () => ({ ok: true, output: '1.3.9' }))
    )

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'version_mismatch',
      requiredVersion: '1.4.1',
      version: '1.3.9'
    })
  })
})
