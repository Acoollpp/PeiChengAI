import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import yauzl from 'yauzl'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..')
const METADATA_PATH = join(PROJECT_ROOT, 'resources', 'codegraph', 'metadata.json')
const OUTPUT_ROOT = join(PROJECT_ROOT, 'build', 'codegraph-runtime', 'win32-x64')

const sha256File = async (filePath) => {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

const listRuntimeFiles = async (root) => {
  const files = []
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else if (entry.isFile()) {
        files.push(entryPath)
      } else {
        throw new Error(`CodeGraph 资产包含不支持的文件类型：${entryPath}`)
      }
    }
  }
  await walk(root)
  return files.sort((left, right) => {
    const leftRelative = relative(root, left).split(sep).join('/')
    const rightRelative = relative(root, right).split(sep).join('/')
    return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0
  })
}

const inspectRuntimeTree = async (root) => {
  const files = await listRuntimeFiles(root)
  const treeHash = createHash('sha256')
  let unpackedBytes = 0

  for (const filePath of files) {
    const content = await readFile(filePath)
    const relativePath = relative(root, filePath).split(sep).join('/')
    const fileHash = createHash('sha256').update(content).digest('hex')
    unpackedBytes += content.length
    treeHash.update(`${relativePath}\0${content.length}\0${fileHash}\n`)
  }

  return {
    fileCount: files.length,
    unpackedBytes,
    treeSha256: treeHash.digest('hex')
  }
}

const assertRuntimeTree = async (root, metadata) => {
  const actual = await inspectRuntimeTree(root)
  const expected = metadata.runtime
  for (const key of ['fileCount', 'unpackedBytes', 'treeSha256']) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `CodeGraph 解压资源校验失败：${key} 应为 ${expected[key]}，实际为 ${actual[key]}`
      )
    }
  }

  const packageJson = JSON.parse(
    await readFile(join(root, ...metadata.runtime.packageJson.split('/')), 'utf8')
  )
  if (packageJson.version !== metadata.version) {
    throw new Error(
      `CodeGraph 版本不符：应为 ${metadata.version}，实际为 ${String(packageJson.version)}`
    )
  }
}

const openZip = (archivePath) =>
  new Promise((resolvePromise, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error('无法打开 CodeGraph ZIP'))
        return
      }
      resolvePromise(zipFile)
    })
  })

const openEntryStream = (zipFile, entry) =>
  new Promise((resolvePromise, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`无法读取 ZIP 条目：${entry.fileName}`))
        return
      }
      resolvePromise(stream)
    })
  })

const extractArchive = async (archivePath, destination, archiveRoot) => {
  const zipFile = await openZip(archivePath)
  const expectedPrefix = `${archiveRoot}/`

  await new Promise((resolvePromise, reject) => {
    let settled = false
    const fail = (error) => {
      if (!settled) {
        settled = true
        zipFile.close()
        reject(error)
      }
    }

    zipFile.on('error', fail)
    zipFile.on('end', () => {
      if (!settled) {
        settled = true
        resolvePromise()
      }
    })
    zipFile.on('entry', (entry) => {
      void (async () => {
        const normalizedName = entry.fileName.replaceAll('\\', '/')
        if (!normalizedName.startsWith(expectedPrefix) || normalizedName.includes('../')) {
          throw new Error(`CodeGraph ZIP 路径无效：${entry.fileName}`)
        }
        const relativeName = normalizedName.slice(expectedPrefix.length)
        if (!relativeName) {
          zipFile.readEntry()
          return
        }

        const outputPath = resolve(destination, ...relativeName.split('/'))
        const destinationRoot = resolve(destination)
        if (outputPath !== destinationRoot && !outputPath.startsWith(`${destinationRoot}${sep}`)) {
          throw new Error(`CodeGraph ZIP 条目越界：${entry.fileName}`)
        }

        if (normalizedName.endsWith('/')) {
          await mkdir(outputPath, { recursive: true })
        } else {
          await mkdir(dirname(outputPath), { recursive: true })
          const entryStream = await openEntryStream(zipFile, entry)
          await pipeline(entryStream, createWriteStream(outputPath, { flags: 'wx' }))
        }
        zipFile.readEntry()
      })().catch(fail)
    })
    zipFile.readEntry()
  })
}

const downloadArchive = async (url, destination) => {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(destination, { flags: 'wx' })
      )
      return
    } catch (error) {
      lastError = error
      await rm(destination, { force: true })
      if (attempt < 3) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 500))
      }
    }
  }
  throw new Error(
    `下载 CodeGraph 官方资产失败：${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}

const resolveArchiveArgument = () => {
  const archiveIndex = process.argv.indexOf('--archive')
  if (archiveIndex >= 0) {
    const value = process.argv[archiveIndex + 1]
    if (!value) throw new Error('--archive 缺少文件路径')
    return resolve(value)
  }
  return process.env.CODEGRAPH_ARCHIVE_PATH
    ? resolve(process.env.CODEGRAPH_ARCHIVE_PATH)
    : undefined
}

export const prepareCodeGraphRuntime = async () => {
  const metadata = JSON.parse(await readFile(METADATA_PATH, 'utf8'))
  const providedArchivePath = resolveArchiveArgument()
  if (!providedArchivePath) {
    const existingOutput = await stat(OUTPUT_ROOT).catch(() => undefined)
    if (existingOutput?.isDirectory()) {
      try {
        await assertRuntimeTree(OUTPUT_ROOT, metadata)
        console.log(
          `CodeGraph ${metadata.version} Windows x64 资源已校验并复用：${OUTPUT_ROOT}（${metadata.runtime.fileCount} 个文件）`
        )
        return
      } catch {
        await rm(OUTPUT_ROOT, { recursive: true, force: true })
      }
    }
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'peicheng-codegraph-'))
  const archivePath = providedArchivePath ?? join(temporaryRoot, metadata.asset.name)
  const extractedRoot = join(temporaryRoot, 'runtime')

  try {
    if (!providedArchivePath) {
      await downloadArchive(metadata.asset.url, archivePath)
    } else {
      const archiveStat = await stat(archivePath).catch(() => undefined)
      if (!archiveStat?.isFile()) {
        throw new Error(`CodeGraph 资产不存在：${archivePath}`)
      }
    }

    const archiveStat = await stat(archivePath)
    if (archiveStat.size !== metadata.asset.size) {
      throw new Error(
        `CodeGraph ZIP 大小不符：应为 ${metadata.asset.size}，实际为 ${archiveStat.size}`
      )
    }
    const archiveHash = await sha256File(archivePath)
    if (archiveHash !== metadata.asset.sha256) {
      throw new Error(
        `CodeGraph ZIP SHA256 不符：应为 ${metadata.asset.sha256}，实际为 ${archiveHash}`
      )
    }

    await mkdir(extractedRoot, { recursive: true })
    await extractArchive(archivePath, extractedRoot, metadata.archiveRoot)
    await assertRuntimeTree(extractedRoot, metadata)

    await rm(OUTPUT_ROOT, { recursive: true, force: true })
    await mkdir(dirname(OUTPUT_ROOT), { recursive: true })
    await rename(extractedRoot, OUTPUT_ROOT)
    console.log(
      `CodeGraph ${metadata.version} Windows x64 资源已准备：${OUTPUT_ROOT}（${metadata.runtime.fileCount} 个文件）`
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareCodeGraphRuntime()
}
