import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventEmitter as EventEmitterType } from 'node:events'

const { existingPaths, spawnMock } = vi.hoisted(() => ({
  existingPaths: new Set<string>(),
  spawnMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => existingPaths.has(path))
}))

vi.mock('../environment-checker', () => ({
  buildVersionCommandOptions: () => ({ shell: true, env: { PATH: 'test-path' } })
}))

describe('runCodexReview', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('emits stdout and stderr chunks while Codex is running', async () => {
    const { EventEmitter } = await import('node:events')
    const { runCodexReview } = await import('../codex-runner')
    const child = new EventEmitter() as EventEmitterType & {
      stdout: EventEmitterType
      stderr: EventEmitterType
      stdin: { end: ReturnType<typeof vi.fn> }
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end: vi.fn() }
    child.kill = vi.fn()
    spawnMock.mockReturnValue(child)
    const chunks: Array<{ stream: string; text: string }> = []

    const resultPromise = runCodexReview({
      cwd: '/tmp/workspace',
      prompt: 'prompt text',
      timeoutMs: 1000,
      onOutput: (event) => chunks.push({ stream: event.stream, text: event.text })
    })

    child.stdout.emit('data', Buffer.from('reading skill\n'))
    child.stderr.emit('data', Buffer.from('svn warning\n'))
    child.emit('close', 0)

    await expect(resultPromise).resolves.toMatchObject({
      stdout: 'reading skill\n',
      stderr: 'svn warning\n'
    })
    expect(chunks).toEqual([
      { stream: 'stdout', text: 'reading skill\n' },
      { stream: 'stderr', text: 'svn warning\n' }
    ])
    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      ['exec', '--dangerously-bypass-approvals-and-sandbox', 'prompt text'],
      expect.objectContaining({
        cwd: '/tmp/workspace',
        shell: false
      })
    )
    expect(child.stdin.end).toHaveBeenCalledWith()
  })

  it('kills Codex and rejects when the abort signal is triggered', async () => {
    const { EventEmitter } = await import('node:events')
    const { runCodexReview } = await import('../codex-runner')
    const child = new EventEmitter() as EventEmitterType & {
      stdout: EventEmitterType
      stderr: EventEmitterType
      stdin: { end: ReturnType<typeof vi.fn> }
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end: vi.fn() }
    child.kill = vi.fn()
    spawnMock.mockReturnValue(child)
    const controller = new AbortController()

    const resultPromise = runCodexReview({
      cwd: '/tmp/workspace',
      prompt: 'prompt text',
      timeoutMs: 1000,
      signal: controller.signal
    })

    controller.abort()

    await expect(resultPromise).rejects.toThrow('任务已取消')
    expect(child.kill).toHaveBeenCalledWith()
  })
})

import {
  buildCodexCommand,
  buildCodexExecArgs,
  buildCodexShellOption,
  buildReviewPrompt
} from '../codex-runner'
import { REVIEW_REPORT_IMAGES_DIR_NAME } from '../../shared/report-artifacts'

describe('buildCodexCommand', () => {
  afterEach(() => {
    existingPaths.clear()
  })

  it('uses the real Codex exe on Windows so prompt stays a single argv without shell parsing', () => {
    const codexExe =
      'C:\\Users\\admin\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe'
    existingPaths.add(codexExe)

    expect(buildCodexCommand('win32', { APPDATA: 'C:\\Users\\admin\\AppData\\Roaming' })).toBe(
      codexExe
    )
  })

  it('resolves the real Codex exe from a codex.cmd directory on Windows', () => {
    const nodeBin = 'C:\\Users\\admin\\Documents\\Codex\\2026-06-10\\node-js\\tools\\nodejs'
    const codexCmd = `${nodeBin}\\codex.cmd`
    const codexExe = `${nodeBin}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`
    existingPaths.add(codexCmd)
    existingPaths.add(codexExe)

    expect(buildCodexCommand('win32', { PATH: nodeBin })).toBe(codexExe)
  })

  it('falls back to the codex.cmd shim when the vendor exe is unavailable on Windows', () => {
    const nodeBin = 'C:\\Users\\admin\\Documents\\Codex\\2026-06-10\\node-js\\tools\\nodejs'
    const codexCmd = `${nodeBin}\\codex.cmd`
    existingPaths.add(codexCmd)

    expect(buildCodexCommand('win32', { PATH: nodeBin })).toBe(codexCmd)
  })

  it('uses codex on non-Windows platforms', () => {
    expect(buildCodexCommand('darwin')).toBe('codex')
  })
})

describe('buildCodexShellOption', () => {
  it('keeps direct executables out of the shell', () => {
    expect(buildCodexShellOption('C:\\tools\\codex.exe', 'win32')).toBe(false)
    expect(buildCodexShellOption('codex', 'darwin')).toBe(false)
  })

  it('uses the shell on Windows when falling back to command shims', () => {
    expect(buildCodexShellOption('C:\\tools\\codex.cmd', 'win32')).toBe(true)
    expect(buildCodexShellOption('codex', 'win32')).toBe(true)
  })
})

describe('buildReviewPrompt', () => {
  it('includes readable Chinese prompt text and interpolated task values', () => {
    const prompt = buildReviewPrompt({
      svnUrl: 'svn://example.com/repo/project',
      oldRevision: '123',
      newRevision: '130',
      reportPath: '/tmp/review/代码审查报告.md',
      imagesDir: '/tmp/review/images',
      skillName: '通用-代码审查-模版二'
    })

    expect(prompt).toContain('Codex')
    expect(prompt).toContain('请强制使用本机 Codex 已安装的 Skill：通用-代码审查-模版二')
    expect(prompt).not.toContain('skills/')
    expect(prompt).toContain('项目路径：svn://example.com/repo/project')
    expect(prompt).toContain('旧版本号：123')
    expect(prompt).toContain('新版本号：130')
    expect(prompt).toContain('报告输出路径：/tmp/review/代码审查报告.md')
    expect(prompt).toContain('图片保存目录：/tmp/review/images')
    expect(prompt).toContain(`${REVIEW_REPORT_IMAGES_DIR_NAME}/<文件名>`)
    expect(prompt).toContain('SVN 获取策略')
    expect(prompt).not.toContain('{svnUrl}')
    expect(prompt).not.toContain('{oldRevision}')
    expect(prompt).not.toContain('{newRevision}')
    expect(prompt).not.toContain('閫氱敤')
  })

  it('does not ask Codex to run a hard-coded svn diff command outside the skill', () => {
    const prompt = buildReviewPrompt({
      svnUrl: 'svn://example.com/repo/project',
      oldRevision: '123',
      newRevision: '130',
      reportPath: '/tmp/review/代码审查报告.md',
      imagesDir: '/tmp/review/images',
      skillName: '通用-代码审查-模版二'
    })

    expect(prompt).not.toContain('svn diff')
  })

  it('includes optional requirement file and focus direction before execution rules', () => {
    const prompt = buildReviewPrompt({
      svnUrl: 'svn://example.com/repo/project',
      oldRevision: '123',
      newRevision: '130',
      reportPath: '/tmp/review/代码审查报告.md',
      imagesDir: '/tmp/review/images',
      skillName: '通用-代码审查-模版二',
      requirementFilePath: '/tmp/workspaces/task-1/requirements/产品开发需求表.xls',
      focusDirectionSnapshot: '重点检查 SOC 跳变和低电量禁放逻辑'
    })

    expect(prompt).toContain('补充审查输入：')
    expect(prompt).toContain(
      '产品开发需求表路径：/tmp/workspaces/task-1/requirements/产品开发需求表.xls'
    )
    expect(prompt).toContain('重点审查方向：\n重点检查 SOC 跳变和低电量禁放逻辑')
    expect(prompt).toContain('不得覆盖 Skill 中已有规则')
    expect(prompt.indexOf('补充审查输入：')).toBeGreaterThan(prompt.indexOf('图片保存目录：'))
    expect(prompt.indexOf('补充审查输入：')).toBeLessThan(
      prompt.indexOf('请严格按该 Skill 的输入模块')
    )
    expect(prompt.indexOf('补充审查输入：')).toBeLessThan(prompt.indexOf('错误处理规范'))
  })
})

describe('buildCodexExecArgs', () => {
  it('runs Codex in exec mode with full access and rendered prompt input', () => {
    expect(buildCodexExecArgs('rendered prompt')).toEqual([
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      'rendered prompt'
    ])
  })
})
