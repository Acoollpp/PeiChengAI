import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDeleteSkillPrompt,
  buildInstallSkillPrompt,
  deleteCodexSkill,
  installCodexSkillFromZip
} from '../codex-skill-installer'

const execFileAsync = promisify(execFile)

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: spawnMock
  }
})

vi.mock('../codex-runner', () => ({
  buildCodexCommand: () => 'codex',
  buildCodexExecArgs: (prompt: string) => [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    prompt
  ]
}))

vi.mock('../environment-checker', () => ({
  buildVersionCommandOptions: () => ({ shell: true, env: { PATH: 'test-path' } })
}))

const originalCodexHome = process.env.CODEX_HOME
const tempRoots: string[] = []

const createTempRoot = async (): Promise<string> => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'codex-skill-installer-test-'))
  tempRoots.push(tempRoot)
  return tempRoot
}

const createSkillZip = async ({
  skillName,
  files = {}
}: {
  skillName: string
  files?: Record<string, string>
}): Promise<{ zipPath: string; hash: string }> => {
  const tempRoot = await createTempRoot()
  const sourceRoot = join(tempRoot, 'source')
  const skillRoot = join(sourceRoot, 'zip-root')
  await mkdir(skillRoot, { recursive: true })
  await writeFile(
    join(skillRoot, 'SKILL.md'),
    ['---', `name: ${skillName}`, 'description: test skill', '---', '', '# Test Skill', ''].join('\n')
  )
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(skillRoot, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }

  const zipPath = join(tempRoot, 'skill.zip')
  await execFileAsync('zip', ['-qr', zipPath, 'zip-root'], { cwd: sourceRoot })
  const zipBytes = await readFile(zipPath)
  return { zipPath, hash: createHash('sha256').update(zipBytes).digest('hex') }
}

const setCodexHome = async (): Promise<string> => {
  const codexHome = await createTempRoot()
  process.env.CODEX_HOME = codexHome
  return codexHome
}

describe('installCodexSkillFromZip', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('installs a verified zip locally and replaces an older same-name skill without spawning Codex', async () => {
    const codexHome = await setCodexHome()
    const { zipPath, hash } = await createSkillZip({
      skillName: '通用-代码审查-模版二',
      files: {
        'references/rule.md': 'new rule'
      }
    })
    const oldSkillDir = join(codexHome, 'skills', '通用-代码审查-模版二')
    await mkdir(oldSkillDir, { recursive: true })
    await writeFile(
      join(oldSkillDir, 'SKILL.md'),
      '---\nname: 通用-代码审查-模版二\ndescription: old\n---\n'
    )
    await writeFile(join(oldSkillDir, 'old.txt'), 'old')

    const result = await installCodexSkillFromZip({
      packagePath: zipPath,
      skillId: 'skill-1',
      skillName: '通用-代码审查-模版二',
      version: 'v1.0.0',
      contentHash: hash,
      timeoutMs: 1000
    })

    await expect(readFile(join(oldSkillDir, 'SKILL.md'), 'utf8')).resolves.toContain(
      'name: 通用-代码审查-模版二'
    )
    await expect(readFile(join(oldSkillDir, 'references', 'rule.md'), 'utf8')).resolves.toBe(
      'new rule'
    )
    await expect(readFile(join(oldSkillDir, 'old.txt'), 'utf8')).rejects.toThrow()
    expect(spawnMock).not.toHaveBeenCalled()
    expect(result.stdout).toContain('[SKILL_INSTALL_OK] 通用-代码审查-模版二@v1.0.0')
    expect(result.stderr).toBe('')
  })

  it('rejects without installing when the zip hash does not match the server hash', async () => {
    await setCodexHome()
    const { zipPath } = await createSkillZip({ skillName: '通用-代码审查-模版二' })

    await expect(
      installCodexSkillFromZip({
        packagePath: zipPath,
        skillId: 'skill-1',
        skillName: '通用-代码审查-模版二',
        version: 'v1.0.0',
        contentHash: 'bad-hash',
        timeoutMs: 1000
      })
    ).rejects.toThrow('Skill package hash mismatch')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects without installing when SKILL.md name differs from server metadata', async () => {
    await setCodexHome()
    const { zipPath, hash } = await createSkillZip({ skillName: '其他Skill' })

    await expect(
      installCodexSkillFromZip({
        packagePath: zipPath,
        skillId: 'skill-1',
        skillName: '通用-代码审查-模版二',
        version: 'v1.0.0',
        contentHash: hash,
        timeoutMs: 1000
      })
    ).rejects.toThrow('Skill package name mismatch')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('uses USERPROFILE as the default Codex home when CODEX_HOME and HOME are unavailable', async () => {
    const userProfile = await createTempRoot()
    delete process.env.CODEX_HOME
    delete process.env.HOME
    process.env.USERPROFILE = userProfile
    const { zipPath, hash } = await createSkillZip({ skillName: '通用-代码审查-模版二' })

    await installCodexSkillFromZip({
      packagePath: zipPath,
      skillId: 'skill-1',
      skillName: '通用-代码审查-模版二',
      version: 'v1.0.0',
      contentHash: hash,
      timeoutMs: 1000
    })

    await expect(
      readFile(join(userProfile, '.codex', 'skills', '通用-代码审查-模版二', 'SKILL.md'), 'utf8')
    ).resolves.toContain('name: 通用-代码审查-模版二')
  })

  it('fails instead of creating a relative .codex directory when no user home can be resolved', async () => {
    delete process.env.CODEX_HOME
    delete process.env.HOME
    delete process.env.USERPROFILE
    delete process.env.HOMEDRIVE
    delete process.env.HOMEPATH
    const { zipPath, hash } = await createSkillZip({ skillName: '通用-代码审查-模版二' })

    await expect(
      installCodexSkillFromZip({
        packagePath: zipPath,
        skillId: 'skill-1',
        skillName: '通用-代码审查-模版二',
        version: 'v1.0.0',
        contentHash: hash,
        timeoutMs: 1000
      })
    ).rejects.toThrow('Cannot resolve Codex home directory')
  })
})

describe('deleteCodexSkill', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('deletes only the target same-name skill directory locally', async () => {
    const codexHome = await setCodexHome()
    const targetDir = join(codexHome, 'skills', '通用-代码变更审查-模板一')
    const otherDir = join(codexHome, 'skills', '其他Skill')
    await mkdir(targetDir, { recursive: true })
    await mkdir(otherDir, { recursive: true })
    await writeFile(
      join(targetDir, 'SKILL.md'),
      '---\nname: 通用-代码变更审查-模板一\ndescription: target\n---\n'
    )
    await writeFile(join(otherDir, 'SKILL.md'), '---\nname: 其他Skill\ndescription: other\n---\n')

    const result = await deleteCodexSkill({
      skillId: 'skill-1',
      skillName: '通用-代码变更审查-模板一',
      version: '1.0.0',
      timeoutMs: 1000
    })

    await expect(readFile(join(targetDir, 'SKILL.md'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(otherDir, 'SKILL.md'), 'utf8')).resolves.toContain('其他Skill')
    expect(spawnMock).not.toHaveBeenCalled()
    expect(result.stdout).toContain('[SKILL_DELETE_OK] 通用-代码变更审查-模板一')
  })
})

describe('Codex Skill prompts', () => {
  it('builds an install prompt with server skill metadata and same-name replacement rules', () => {
    const prompt = buildInstallSkillPrompt({
      packagePath: '/tmp/skill.zip',
      skillId: 'skill-1',
      skillName: '通用-代码变更审查-模板一',
      version: '1.0.0',
      contentHash: 'hash-1'
    })

    expect(prompt).toContain('Skill ID：skill-1')
    expect(prompt).toContain('Skill 名称：通用-代码变更审查-模板一')
    expect(prompt).toContain('Skill 版本：1.0.0')
    expect(prompt).toContain('内容哈希：hash-1')
    expect(prompt).toContain('只能删除同名 Skill，不要删除其他名称的 Skill')
    expect(prompt).toContain('[SKILL_INSTALL_OK] 通用-代码变更审查-模板一@1.0.0')
  })

  it('builds a delete prompt that only removes the target skill name', () => {
    const prompt = buildDeleteSkillPrompt({
      skillId: 'skill-1',
      skillName: '通用-代码变更审查-模板一',
      version: '1.0.0'
    })

    expect(prompt).toContain('Skill 名称：通用-代码变更审查-模板一')
    expect(prompt).toContain('只删除名称为 通用-代码变更审查-模板一 的 Skill')
    expect(prompt).toContain('不要删除其他名称的 Skill')
    expect(prompt).toContain('[SKILL_DELETE_OK] 通用-代码变更审查-模板一')
  })
})

afterEach(async () => {
  process.env.CODEX_HOME = originalCodexHome
  await Promise.all(tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { recursive: true, force: true })))
})
