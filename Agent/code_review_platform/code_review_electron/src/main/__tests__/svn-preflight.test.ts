import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams, spawn as spawnProcess } from 'node:child_process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildSvnInfoArgs,
  runSvnPreflight,
  sanitizeSvnDiagnostic,
  SvnPreflightError
} from '../svn-preflight'

interface FakeChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

interface SpawnOutcome {
  code?: number
  stderr?: string
  error?: Error
  pending?: boolean
}

const createSpawn = (outcomes: SpawnOutcome[]) => {
  const children: FakeChild[] = []
  const spawn = vi.fn((..._args: Parameters<typeof spawnProcess>) => {
    const outcome = outcomes.shift()
    if (!outcome) {
      throw new Error('缺少测试命令结果')
    }

    const child = new EventEmitter() as FakeChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn(() => true)
    children.push(child)

    if (!outcome.pending) {
      queueMicrotask(() => {
        if (outcome.stderr) {
          child.stderr.emit('data', Buffer.from(outcome.stderr))
        }
        if (outcome.error) {
          child.emit('error', outcome.error)
          return
        }
        child.emit('close', outcome.code ?? 0)
      })
    }

    return child as unknown as ChildProcessWithoutNullStreams
  })

  return { spawn, children }
}

const validInput = {
  svnUrl: ' https://svn.example.com/trunk ',
  oldRevision: '11',
  newRevision: 'R12',
  svnCommand: '/usr/local/bin/svn',
  commandOptions: { env: { PATH: '/test/bin' }, windowsHide: true }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('buildSvnInfoArgs', () => {
  it('规范化版本号并使用参数数组构造非交互命令', () => {
    expect(buildSvnInfoArgs(' https://svn.example.com/trunk ', 'R12')).toEqual([
      'info',
      '--non-interactive',
      '-r',
      '12',
      'https://svn.example.com/trunk'
    ])
  })
})

describe('runSvnPreflight 参数校验', () => {
  it.each([
    [{ ...validInput, svnUrl: '   ' }, 'INVALID_ARGUMENT'],
    [{ ...validInput, svnCommand: '' }, 'INVALID_ARGUMENT'],
    [{ ...validInput, oldRevision: '12.5' }, 'INVALID_ARGUMENT'],
    [{ ...validInput, newRevision: '-1' }, 'INVALID_ARGUMENT'],
    [{ ...validInput, newRevision: '0' }, 'INVALID_REVISION_ORDER'],
    [{ ...validInput, oldRevision: '12', newRevision: '12' }, 'INVALID_REVISION_ORDER'],
    [{ ...validInput, oldRevision: '13', newRevision: '12' }, 'INVALID_REVISION_ORDER']
  ])('拒绝无效输入 %#', async (input, code) => {
    const { spawn } = createSpawn([])

    await expect(runSvnPreflight(input, { spawn })).rejects.toMatchObject({ code })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('接受 r0 全量模式和超出 Number 安全范围的 BigInt 版本', async () => {
    const { spawn } = createSpawn([{ code: 0 }])

    await expect(
      runSvnPreflight(
        {
          ...validInput,
          oldRevision: 'r0',
          newRevision: '900719925474099312345'
        },
        { spawn }
      )
    ).resolves.toBeUndefined()

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith(
      validInput.svnCommand,
      [
        'info',
        '--non-interactive',
        '-r',
        '900719925474099312345',
        'https://svn.example.com/trunk'
      ],
      validInput.commandOptions
    )
  })
})

describe('runSvnPreflight 执行顺序', () => {
  it('先检查新版本，成功后再检查旧版本，并原样复用命令 options', async () => {
    const { spawn } = createSpawn([{ code: 0 }, { code: 0 }])

    await runSvnPreflight(validInput, { spawn })

    expect(spawn.mock.calls).toEqual([
      [
        validInput.svnCommand,
        ['info', '--non-interactive', '-r', '12', 'https://svn.example.com/trunk'],
        validInput.commandOptions
      ],
      [
        validInput.svnCommand,
        ['info', '--non-interactive', '-r', '11', 'https://svn.example.com/trunk'],
        validInput.commandOptions
      ]
    ])
  })

  it('新版本失败后不再检查旧版本', async () => {
    const { spawn } = createSpawn([{ code: 1, stderr: 'svn: E160006: No such revision 12' }])

    await expect(runSvnPreflight(validInput, { spawn })).rejects.toMatchObject({
      code: 'NEW_REVISION_UNAVAILABLE'
    })
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('旧版本未知失败稳定映射为 OLD_REVISION_UNAVAILABLE', async () => {
    const { spawn } = createSpawn([{ code: 0 }, { code: 1, stderr: 'unexpected svn failure' }])

    await expect(runSvnPreflight(validInput, { spawn })).rejects.toMatchObject({
      code: 'OLD_REVISION_UNAVAILABLE'
    })
  })
})

describe('runSvnPreflight 错误分类', () => {
  it.each([
    ['svn: E170001: Authentication failed', 'AUTHENTICATION_FAILED'],
    ['svn: E215004: No more credentials or we tried too many times', 'AUTHENTICATION_FAILED'],
    ['svn: E175013: Access to /trunk forbidden', 'PERMISSION_DENIED'],
    ['svn: E220004: Item is not readable', 'PERMISSION_DENIED'],
    ['svn: E170013: Unable to connect to a repository at URL', 'NETWORK_FAILED'],
    ['svn: E670002: Name or service not known', 'NETWORK_FAILED'],
    ['svn: E160013: path not found', 'NEW_REVISION_UNAVAILABLE'],
    ['svn: E160006: No such revision', 'NEW_REVISION_UNAVAILABLE']
  ])('将 %s 分类为 %s', async (stderr, code) => {
    const { spawn } = createSpawn([{ code: 1, stderr }])

    await expect(runSvnPreflight(validInput, { spawn })).rejects.toMatchObject({ code })
  })

  it('将 spawn error 分类为 CLI_START_FAILED', async () => {
    const { spawn } = createSpawn([{ error: new Error('spawn ENOENT') }])

    await expect(runSvnPreflight(validInput, { spawn })).rejects.toMatchObject({
      code: 'CLI_START_FAILED'
    })
  })
})

describe('runSvnPreflight 生命周期', () => {
  it('每次命令独立在 30 秒超时，终止子进程并清理取消监听器', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')
    const { spawn, children } = createSpawn([{ pending: true }])
    const result = runSvnPreflight({ ...validInput, signal: controller.signal }, { spawn })
    const rejection = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' })

    await vi.advanceTimersByTimeAsync(30_000)
    await rejection

    expect(children[0].kill).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('AbortSignal 取消时终止子进程并清理计时器', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const { spawn, children } = createSpawn([{ pending: true }])
    const result = runSvnPreflight({ ...validInput, signal: controller.signal }, { spawn })
    const rejection = expect(result).rejects.toMatchObject({ code: 'CANCELLED' })

    controller.abort()
    await rejection

    expect(children[0].kill).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('已取消的 signal 不启动子进程', async () => {
    const controller = new AbortController()
    controller.abort()
    const { spawn } = createSpawn([])

    await expect(
      runSvnPreflight({ ...validInput, signal: controller.signal }, { spawn })
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('SVN 诊断脱敏', () => {
  it('移除 URL、URL 凭据、绝对路径和敏感字段', () => {
    const diagnostic = [
      'svn: E170013: Unable to connect https://alice:secret@svn.example.com/private/trunk',
      'svn://svn.example.com/project/repo',
      'C:\\Users\\alice\\AppData\\auth.txt',
      '/Users/alice/.subversion/auth/file',
      'username=alice password: hunter2 token "abc-123"'
    ].join('\n')

    const sanitized = sanitizeSvnDiagnostic(diagnostic)

    expect(sanitized).not.toMatch(/alice|secret|svn\.example\.com|Users|hunter2|abc-123/i)
    expect(sanitized).toContain('[已脱敏URL]')
    expect(sanitized).toContain('username=[已脱敏]')
    expect(sanitized).toContain('password: [已脱敏]')
    expect(sanitized).toContain('token [已脱敏]')
  })

  it('logger 只能收到脱敏后的非空诊断', async () => {
    const logger = vi.fn()
    const { spawn } = createSpawn([
      {
        code: 1,
        stderr: 'svn: E170001: Authentication failed for https://alice:secret@svn.example.com/trunk'
      }
    ])

    await expect(runSvnPreflight(validInput, { spawn, logger })).rejects.toBeInstanceOf(
      SvnPreflightError
    )

    expect(logger).toHaveBeenCalledOnce()
    expect(logger.mock.calls[0][0]).not.toMatch(/alice|secret|svn\.example\.com/i)
  })
})
