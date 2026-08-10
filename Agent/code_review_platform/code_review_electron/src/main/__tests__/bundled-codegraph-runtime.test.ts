import { createHash } from 'node:crypto'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
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
  return {
    version: '1.4.1',
    runtimeDirectory: 'codegraph/win32-x64',
    runtime: {
      command: 'bin/codegraph.cmd',
      node: 'node.exe',
      entrypoint: 'lib/dist/bin/codegraph.js',
      packageJson: 'lib/package.json',
      requiredFiles: ['bin/codegraph.cmd', 'node.exe', 'lib/package.json', 'lib/dist/bin/codegraph.js'].map(
        (path) => ({
          path,
          sha256: createHash('sha256').update(fixtureFiles[path]).digest('hex')
        })
      ),
      fileCount: Object.keys(fixtureFiles).length,
      unpackedBytes,
      treeSha256: treeHash.digest('hex')
    }
  }
}

const createFixture = async (): Promise<string> => {
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
  versionCommand: () => Promise<{
    ok: boolean
    output?: string
    failureReason?: 'timeout' | 'spawn_error' | 'exit_code'
    exitCode?: number
  }> = vi.fn(async () => ({
    ok: true,
    output: '1.4.1'
  })),
  statFile: (path: string) => ReturnType<typeof stat> = stat,
  diagnosticLogger = { warn: vi.fn() }
) => {
  const root = await createFixture()
  const runtime = createBundledCodeGraphRuntime({
    platform: 'win32',
    arch: 'x64',
    runtimeRoot: root,
    metadata: makeMetadata(),
    diagnosticLogger,
    adapter: {
      stat: statFile,
      runVersionCommand: versionCommand
    }
  })
  return { root, runtime, versionCommand, diagnosticLogger }
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('内置 CodeGraph 运行时', () => {
  it('非核心文件不可读但内置命令可执行时仍返回 ready', async () => {
    const root = await createFixture()
    const unreadablePath = join(root, 'lib', 'node_modules', 'parser', 'index.js')
    const statFile = vi.fn(async (path: string) => {
      if (path === unreadablePath) {
        throw Object.assign(new Error('access denied'), { code: 'EACCES' })
      }
      return stat(path)
    })
    const versionCommand = vi.fn(async () => ({ ok: true, output: '1.4.1' }))
    const runtime = createBundledCodeGraphRuntime({
      platform: 'win32',
      arch: 'x64',
      runtimeRoot: root,
      metadata: makeMetadata(),
      diagnosticLogger: { warn: vi.fn() },
      adapter: { stat: statFile, runVersionCommand: versionCommand }
    })

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'ready',
      version: '1.4.1'
    })
    expect(statFile).toHaveBeenCalledOnce()
    expect(statFile).toHaveBeenCalledWith(join(root, 'bin', 'codegraph.cmd'))
    expect(versionCommand).toHaveBeenCalledWith(
      join(root, 'node.exe'),
      join(root, 'lib', 'dist', 'bin', 'codegraph.js')
    )
  })

  it('目录树摘要与 metadata 不一致但内置命令可执行时仍返回 ready', async () => {
    const root = await createFixture()
    const versionCommand = vi.fn(async () => ({ ok: true, output: '1.4.1' }))
    const mismatchedMetadata = makeMetadata()
    mismatchedMetadata.runtime.fileCount += 10
    mismatchedMetadata.runtime.unpackedBytes += 1024
    mismatchedMetadata.runtime.treeSha256 = '0'.repeat(64)
    const runtime = createBundledCodeGraphRuntime({
      platform: 'win32',
      arch: 'x64',
      runtimeRoot: root,
      metadata: mismatchedMetadata,
      diagnosticLogger: { warn: vi.fn() },
      adapter: { stat, runVersionCommand: versionCommand }
    })

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'ready',
      version: '1.4.1'
    })
    expect(versionCommand).toHaveBeenCalledOnce()
  })

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

  it('命令入口 ENOENT 时报告 missing 且不回退全局 CodeGraph', async () => {
    const { root, runtime, versionCommand, diagnosticLogger } = await createFixtureRuntime()
    await rm(join(root, 'bin', 'codegraph.cmd'))

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'missing',
      requiredVersion: '1.4.1',
      error: expect.stringContaining('重新安装客户端')
    })
    await expect(
      runtime.buildCodexEnvironment({ PATH: 'C:\\global-codegraph' })
    ).rejects.toBeInstanceOf(BundledCodeGraphUnavailableError)
    expect(versionCommand).not.toHaveBeenCalled()
    expect(diagnosticLogger.warn).toHaveBeenCalledWith({
      event: 'command_entry_failed',
      stage: 'command_entry',
      code: 'ENOENT',
      path: 'bin/codegraph.cmd'
    })
  })

  it('命令入口不可读取时报告 not_executable', async () => {
    const statFile = vi.fn(async () => {
      throw Object.assign(new Error('access denied'), { code: 'EACCES' })
    })
    const { runtime, versionCommand, diagnosticLogger } = await createFixtureRuntime(
      undefined,
      statFile
    )

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'not_executable',
      error: expect.stringContaining('无法执行')
    })
    expect(versionCommand).not.toHaveBeenCalled()
    expect(diagnosticLogger.warn).toHaveBeenCalledWith({
      event: 'command_entry_failed',
      stage: 'command_entry',
      code: 'EACCES',
      path: 'bin/codegraph.cmd'
    })
  })

  it('package.json 损坏或声明其他版本时以内置命令输出为准', async () => {
    const { root, runtime, versionCommand } = await createFixtureRuntime()
    await writeFile(join(root, 'lib', 'package.json'), '{not-json')

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'ready',
      version: '1.4.1'
    })
    await writeFile(join(root, 'lib', 'package.json'), JSON.stringify({ version: '1.5.0' }))
    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'ready',
      version: '1.4.1'
    })
    expect(versionCommand).toHaveBeenCalledTimes(2)
  })

  it('非核心文件缺失、新增或内容变化时不阻断可执行的内置命令', async () => {
    const { root, runtime, versionCommand } = await createFixtureRuntime()
    await rm(join(root, 'lib', 'node_modules', 'parser', 'index.js'))
    await writeFile(join(root, 'unexpected-file.txt'), 'unexpected')
    await writeFile(join(root, 'lib', 'package.json'), JSON.stringify({ version: 'changed' }))

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'ready',
      version: '1.4.1'
    })
    expect(versionCommand).toHaveBeenCalledOnce()
  })

  it.each([
    ['timeout', undefined],
    ['spawn_error', undefined],
    ['exit_code', 9]
  ] as const)('内置版本命令因 %s 失败时记录轻量诊断', async (failureReason, exitCode) => {
    const { runtime, diagnosticLogger } = await createFixtureRuntime(
      vi.fn(async () => ({ ok: false, failureReason, exitCode }))
    )

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'not_executable',
      requiredVersion: '1.4.1',
      error: expect.stringContaining('无法执行')
    })
    expect(diagnosticLogger.warn).toHaveBeenCalledWith({
      event: 'version_command_failed',
      stage: 'version_command',
      reason: failureReason,
      ...(exitCode === undefined ? {} : { exitCode })
    })
  })

  it('内置版本命令抛出异常时报告 not_executable', async () => {
    const { runtime, diagnosticLogger } = await createFixtureRuntime(
      vi.fn(async () => {
        throw new Error('spawn failed')
      })
    )

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'not_executable',
      requiredVersion: '1.4.1'
    })
    expect(diagnosticLogger.warn).toHaveBeenCalledWith({
      event: 'version_command_failed',
      stage: 'version_command',
      reason: 'spawn_error'
    })
  })

  it('内置版本命令返回其他版本时报告 version_mismatch', async () => {
    const { runtime } = await createFixtureRuntime(
      vi.fn(async () => ({ ok: true, output: '1.3.9' }))
    )

    await expect(runtime.inspect()).resolves.toMatchObject({
      status: 'version_mismatch',
      requiredVersion: '1.4.1',
      version: '1.3.9'
    })
  })

  it('非 Windows x64 平台保持 unsupported 且不检查命令', async () => {
    const root = await createFixture()
    const statFile = vi.fn(stat)
    const versionCommand = vi.fn(async () => ({ ok: true, output: '1.4.1' }))
    const runtime = createBundledCodeGraphRuntime({
      platform: 'darwin',
      arch: 'arm64',
      runtimeRoot: root,
      metadata: makeMetadata(),
      diagnosticLogger: { warn: vi.fn() },
      adapter: { stat: statFile, runVersionCommand: versionCommand }
    })

    await expect(runtime.inspect()).resolves.toMatchObject({ status: 'unsupported' })
    expect(statFile).not.toHaveBeenCalled()
    expect(versionCommand).not.toHaveBeenCalled()
  })
})
