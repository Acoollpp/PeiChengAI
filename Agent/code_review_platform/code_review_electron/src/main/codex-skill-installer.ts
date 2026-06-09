import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { open, type Entry, type ZipFile } from 'yauzl'

export interface InstallCodexSkillInput {
  packagePath: string
  skillId: string
  skillName: string
  version: string
  contentHash?: string
  timeoutMs?: number
}

export interface DeleteCodexSkillInput {
  skillId: string
  skillName: string
  version: string
  timeoutMs?: number
}

export interface InstallCodexSkillResult {
  stdout: string
  stderr: string
}

type LegacyInstallCodexSkillInput = Pick<InstallCodexSkillInput, 'packagePath' | 'timeoutMs'>

export const buildInstallSkillPrompt = ({
  packagePath,
  skillId,
  skillName,
  version,
  contentHash
}: InstallCodexSkillInput): string =>
  [
    '请将下面这个本地 Skill zip 包安装为 Codex 当前可用的最新 Skill。',
    '',
    '这是服务端当前激活 Skill 列表中的一个条目，客户端正在按服务端激活列表同步本机 Codex Skill。',
    '',
    '服务端 Skill 元信息：',
    `- Skill ID：${skillId}`,
    `- Skill 名称：${skillName}`,
    `- Skill 版本：${version}`,
    `- 内容哈希：${contentHash ?? '未提供'}`,
    `- Skill zip 路径：${packagePath}`,
    '',
    '安装要求：',
    '1. 直接读取 Skill zip 路径对应的 zip 文件，不要修改 zip 内容。',
    `2. 安装前必须识别 zip 包内的 Skill 名称，并确认它与服务端 Skill 名称一致：${skillName}。`,
    `3. 在安装新包前，必须定位 Codex 当前已安装的所有同名 Skill：${skillName}。`,
    '4. 删除所有旧的同名 Skill，包括旧版本目录、缓存目录、注册信息或 Codex 机制中会影响同名 Skill 解析的旧记录。',
    '5. 只能删除同名 Skill，不要删除其他名称的 Skill。',
    '6. 删除完成后，安装当前 zip 包中的 Skill。',
    `7. 安装后必须确认后续通过 Skill 名称 ${skillName} 调用时，只会使用本次安装的新版本。`,
    '8. 如果无法确认旧同名 Skill 已删除、无法确认新 Skill 已安装成功，或发现安装后的 Skill 名称与服务端元信息不一致，必须以失败状态结束。',
    '9. 安装成功后只输出简短成功信息。',
    '',
    '失败输出格式：',
    '[SKILL_INSTALL_ERROR] <失败原因，包括已尝试的删除路径、安装步骤和失败细节>',
    '',
    '成功输出格式：',
    `[SKILL_INSTALL_OK] ${skillName}@${version}`
  ].join('\n')

export const buildDeleteSkillPrompt = ({
  skillId,
  skillName,
  version
}: DeleteCodexSkillInput): string =>
  [
    '请从 Codex 当前已安装的 Skill 中删除指定 Skill。',
    '',
    '删除目标：',
    `- Skill 名称：${skillName}`,
    `- 原服务端 Skill ID：${skillId}`,
    `- 原版本：${version}`,
    '',
    '删除要求：',
    `1. 只删除名称为 ${skillName} 的 Skill。`,
    '2. 删除该名称下所有旧版本目录、缓存目录、注册信息或 Codex 机制中会影响同名 Skill 解析的记录。',
    '3. 不要删除其他名称的 Skill。',
    `4. 删除后必须确认后续通过 Skill 名称 ${skillName} 不会再启动到任何本地残留版本。`,
    '5. 如果无法确认删除成功，必须以失败状态结束。',
    '',
    '失败输出格式：',
    '[SKILL_DELETE_ERROR] <失败原因，包括已尝试的删除路径和失败细节>',
    '',
    '成功输出格式：',
    `[SKILL_DELETE_OK] ${skillName}`
  ].join('\n')

export const buildLegacyInstallSkillPrompt = (packagePath: string): string =>
  [
    '请将下面这个本地 Skill zip 包作为最新版本安装到 Codex 自己的 Skill 目录中。',
    '要求：',
    '1. 直接读取这个 zip 文件路径，不要修改 zip 内容。',
    '2. 先定位 Codex 当前已安装的同名 Skill，并删除旧的同名 Skill，包括 Codex 自己机制中记录的旧版本目录或注册信息。',
    '3. 再安装这个 zip 包中的最新 Skill，确保后续 Codex 调用同名 Skill 时只会使用这次安装的新版本。',
    '4. 如果无法确认旧 Skill 已删除或新 Skill 已安装成功，请明确输出失败原因并以失败状态结束。',
    '5. 安装成功后只输出简短成功信息。',
    '',
    `Skill zip 路径：${packagePath}`
  ].join('\n')

const hasInstallMetadata = (
  input: InstallCodexSkillInput | LegacyInstallCodexSkillInput
): input is InstallCodexSkillInput =>
  'skillId' in input &&
  input.skillId.length > 0 &&
  'skillName' in input &&
  input.skillName.length > 0 &&
  'version' in input &&
  input.version.length > 0

const readZipEntries = (zipPath: string): Promise<Array<{ entry: Entry; fileName: string }>> =>
  new Promise((resolvePromise, reject) => {
    const entries: Array<{ entry: Entry; fileName: string }> = []
    open(
      zipPath,
      { lazyEntries: true, validateEntrySizes: true, decodeStrings: false },
      (openError: Error | null, zipfile: ZipFile) => {
        if (openError) {
          reject(openError)
          return
        }

        zipfile.on('entry', (entry: Entry) => {
          const fileName = decodeZipEntryName(entry)
          const validationError = validateZipEntryPath(fileName)
          if (validationError) {
            zipfile.close()
            reject(new Error(validationError))
            return
          }

          entries.push({ entry, fileName })
          zipfile.readEntry()
        })
        zipfile.once('end', () => {
          zipfile.close()
          resolvePromise(entries)
        })
        zipfile.once('error', reject)
        zipfile.readEntry()
      }
    )
  })

const openZipFile = (zipPath: string): Promise<ZipFile> =>
  new Promise((resolvePromise, reject) => {
    open(
      zipPath,
      { lazyEntries: true, validateEntrySizes: true, decodeStrings: false },
      (error: Error | null, zipfile: ZipFile) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise(zipfile)
      }
    )
  })

const extractZip = async (
  zipPath: string,
  destination: string,
  entries: Array<{ entry: Entry; fileName: string }>,
  rootPrefix: string
): Promise<void> => {
  const zipfile = await openZipFile(zipPath)

  try {
    for (const { entry, fileName } of entries) {
      const relativePath = removeRootPrefix(fileName, rootPrefix)
      if (!relativePath) {
        continue
      }

      const outputPath = safeJoin(destination, relativePath)
      if (isDirectoryEntry(fileName)) {
        await mkdir(outputPath, { recursive: true })
        continue
      }

      await mkdir(dirname(outputPath), { recursive: true })
      await extractEntry(zipfile, entry, outputPath)
      const fileStat = await stat(outputPath)
      if (fileStat.size !== entry.uncompressedSize) {
        throw new Error(
          `Extracted file size mismatch: ${relativePath} expected ${entry.uncompressedSize}, received ${fileStat.size}`
        )
      }
    }
  } finally {
    zipfile.close()
  }
}

const extractEntry = (zipfile: ZipFile, entry: Entry, outputPath: string): Promise<void> =>
  new Promise((resolvePromise, reject) => {
    zipfile.openReadStream(entry, (error: Error | null, readStream) => {
      if (error) {
        reject(error)
        return
      }

      pipeline(readStream, createWriteStream(outputPath)).then(resolvePromise, async (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          try {
            await mkdir(dirname(outputPath), { recursive: true })
            await pipeline(readStream, createWriteStream(outputPath))
            resolvePromise()
            return
          } catch (retryError) {
            reject(retryError)
            return
          }
        }
        reject(error)
      })
    })
  })

const parseSkillName = (skillText: string): string | null => {
  const match = /^name:\s*(.+?)\s*$/m.exec(skillText)
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null
}

const readSkillNameFromZip = async (
  zipPath: string,
  entries: Array<{ entry: Entry; fileName: string }>
): Promise<{ skillName: string; rootPrefix: string }> => {
  const skillEntries = entries.filter(({ fileName }) => fileName === 'SKILL.md' || fileName.endsWith('/SKILL.md'))
  if (skillEntries.length !== 1) {
    throw new Error(`Skill package must contain exactly one SKILL.md, received ${skillEntries.length}`)
  }

  const zipfile = await openZipFile(zipPath)
  try {
    const skillText = await readEntryText(zipfile, skillEntries[0].entry)
    const skillName = parseSkillName(skillText)
    if (!skillName) {
      throw new Error('Skill package SKILL.md must declare a name')
    }

    return {
      skillName,
      rootPrefix: skillEntries[0].fileName.slice(0, -'SKILL.md'.length)
    }
  } finally {
    zipfile.close()
  }
}

const readEntryText = (zipfile: ZipFile, entry: Entry): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    zipfile.openReadStream(entry, (error: Error | null, readStream) => {
      if (error) {
        reject(error)
        return
      }

      const chunks: Buffer[] = []
      readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
      readStream.once('error', reject)
      readStream.once('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')))
    })
  })

const codexHomeDir = (): string => {
  if (process.env.CODEX_HOME) {
    return process.env.CODEX_HOME
  }
  if (process.env.HOME) {
    return join(process.env.HOME, '.codex')
  }
  if (process.env.USERPROFILE) {
    return join(process.env.USERPROFILE, '.codex')
  }
  if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
    return join(`${process.env.HOMEDRIVE}${process.env.HOMEPATH}`, '.codex')
  }
  throw new Error('Cannot resolve Codex home directory')
}

const codexSkillsDir = (): string => join(codexHomeDir(), 'skills')

const skillDir = (skillName: string): string => join(codexSkillsDir(), sanitizeSkillDirectoryName(skillName))

const sanitizeSkillDirectoryName = (skillName: string): string => {
  if (skillName.includes('/') || skillName.includes('\\') || skillName === '.' || skillName === '..') {
    throw new Error(`Unsafe skill name: ${skillName}`)
  }
  return skillName
}

const decodeZipEntryName = (entry: Entry): string => {
  const rawFileName = (entry as Entry & { fileName: string | Buffer }).fileName
  const decoded = Buffer.isBuffer(rawFileName) ? rawFileName.toString('utf8') : rawFileName
  return decoded.replace(/\\/g, '/')
}

const validateZipEntryPath = (fileName: string): string | null => {
  if (fileName.startsWith('/') || /^[a-zA-Z]:\//.test(fileName)) {
    return `Skill package contains absolute path: ${fileName}`
  }
  if (fileName.split('/').includes('..')) {
    return `Skill package contains unsafe path: ${fileName}`
  }
  return null
}

const safeJoin = (root: string, relativePath: string): string => {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(root, relativePath)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Skill package entry escapes destination: ${relativePath}`)
  }
  return resolvedTarget
}

const isDirectoryEntry = (fileName: string): boolean => fileName.endsWith('/')

const removeRootPrefix = (fileName: string, rootPrefix: string): string =>
  rootPrefix && fileName.startsWith(rootPrefix) ? fileName.slice(rootPrefix.length) : fileName

const verifyPackageHash = async (packagePath: string, expectedHash?: string): Promise<string> => {
  const packageBytes = await readFile(packagePath)
  const actualHash = createHash('sha256').update(packageBytes).digest('hex')
  if (expectedHash && actualHash !== expectedHash) {
    throw new Error(`Skill package hash mismatch: expected ${expectedHash}, received ${actualHash}`)
  }
  return actualHash
}

const installSkillLocally = async (input: InstallCodexSkillInput): Promise<InstallCodexSkillResult> => {
  const packageHash = await verifyPackageHash(input.packagePath, input.contentHash)
  const entries = await readZipEntries(input.packagePath)
  const { skillName: packageSkillName, rootPrefix } = await readSkillNameFromZip(input.packagePath, entries)
  if (packageSkillName !== input.skillName) {
    throw new Error(
      `Skill package name mismatch: expected ${input.skillName}, received ${packageSkillName}`
    )
  }

  const targetDir = skillDir(input.skillName)
  const parentDir = dirname(targetDir)
  await mkdir(parentDir, { recursive: true })
  const tempDir = await mkdtemp(join(parentDir, `.installing-${basename(targetDir)}-`))

  try {
    await extractZip(input.packagePath, tempDir, entries, rootPrefix)
    const installedSkillText = await readFile(join(tempDir, 'SKILL.md'), 'utf8')
    const installedSkillName = parseSkillName(installedSkillText)
    if (installedSkillName !== input.skillName) {
      throw new Error(
        `Installed skill name mismatch: expected ${input.skillName}, received ${installedSkillName ?? 'missing'}`
      )
    }

    await rm(targetDir, { recursive: true, force: true })
    await rename(tempDir, targetDir)
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true })
    throw error
  }

  return {
    stdout: `[SKILL_INSTALL_OK] ${input.skillName}@${input.version} ${packageHash}\n`,
    stderr: ''
  }
}

const deleteSkillLocally = async (input: DeleteCodexSkillInput): Promise<InstallCodexSkillResult> => {
  const targetDir = skillDir(input.skillName)
  try {
    const skillText = await readFile(join(targetDir, 'SKILL.md'), 'utf8')
    const installedSkillName = parseSkillName(skillText)
    if (installedSkillName === input.skillName) {
      await rm(targetDir, { recursive: true, force: true })
    }
  } catch {
    await access(targetDir).catch(() => undefined)
  }

  return {
    stdout: `[SKILL_DELETE_OK] ${input.skillName}\n`,
    stderr: ''
  }
}

export function installCodexSkillFromZip(
  input: InstallCodexSkillInput | LegacyInstallCodexSkillInput
): Promise<InstallCodexSkillResult> {
  if (!hasInstallMetadata(input)) {
    throw new Error('Skill metadata is required for local Skill installation')
  }
  return installSkillLocally(input)
}

export const deleteCodexSkill = (input: DeleteCodexSkillInput): Promise<InstallCodexSkillResult> =>
  deleteSkillLocally(input)
