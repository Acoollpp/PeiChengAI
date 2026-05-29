import { describe, expect, it } from 'vitest'

import { buildVersionCommandOptions, classifyEnvironment } from '../environment-checker'
import type { EnvironmentCheckResult } from '../environment-checker'

describe('classifyEnvironment', () => {
  it('returns ready when Codex, SVN, and the review skill are available', () => {
    expect(classifyEnvironment({ codexOk: true, svnOk: true, skillOk: true })).toBe('ready')
  })

  it('prioritizes missing_codex when Codex is unavailable', () => {
    expect(classifyEnvironment({ codexOk: false, svnOk: false, skillOk: false })).toBe(
      'missing_codex'
    )
  })

  it('prioritizes missing_svn after Codex is available', () => {
    expect(classifyEnvironment({ codexOk: true, svnOk: false, skillOk: false })).toBe(
      'missing_svn'
    )
  })

  it('returns missing_skill when only the review skill is unavailable', () => {
    expect(classifyEnvironment({ codexOk: true, svnOk: true, skillOk: false })).toBe(
      'missing_skill'
    )
  })

  it('can carry skill sync failure details for the renderer', () => {
    const result: EnvironmentCheckResult = {
      status: 'missing_skill',
      skillError: 'No active skill'
    }

    expect(result.skillError).toBe('No active skill')
  })
})

describe('buildVersionCommandOptions', () => {
  it('runs Codex through the shell on Windows so app execution aliases can resolve', () => {
    const options = buildVersionCommandOptions('win32')

    expect(options.shell).toBe(true)
  })
})
