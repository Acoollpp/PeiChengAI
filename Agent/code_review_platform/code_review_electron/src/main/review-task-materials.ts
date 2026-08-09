import { copyFile, mkdir, open, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import type {
  ResolvedReviewItemInput,
  ResolvedReviewItemMaterialInput
} from '../shared/review-items'

export interface PrepareReviewMaterialsDependencies {
  copyFile?: (source: string, destination: string) => Promise<void>
  mkdir?: (path: string, options: { recursive: true }) => Promise<string | undefined>
  open?: (path: string, flags: string) => Promise<{ close: () => Promise<void> }>
  stat?: (path: string) => Promise<{ isFile: () => boolean }>
}

const formatExtensions = (extensions: readonly string[]): string =>
  extensions.join('、')

const reserveDestinationName = (sourcePath: string, reservedNames: Set<string>): string => {
  const sourceName = basename(sourcePath)
  const extension = extname(sourceName)
  const stem = basename(sourceName, extension)
  let candidate = sourceName
  let suffix = 2

  while (reservedNames.has(candidate.toLocaleLowerCase('en-US'))) {
    candidate = `${stem}-${suffix}${extension}`
    suffix += 1
  }
  reservedNames.add(candidate.toLocaleLowerCase('en-US'))
  return candidate
}

const validateMaterial = async (
  itemId: string,
  material: ResolvedReviewItemMaterialInput,
  dependencies: Pick<PrepareReviewMaterialsDependencies, 'open' | 'stat'>
): Promise<string[]> => {
  const errors: string[] = []
  const label = `${itemId} ${material.name}`

  if (material.required && material.filePaths.length === 0) {
    errors.push(`${label}为必填项`)
    return errors
  }
  if (!material.multiple && material.filePaths.length > 1) {
    errors.push(`${label}只能选择一个文件`)
  }

  for (const sourcePath of material.filePaths) {
    const trimmedPath = sourcePath.trim()
    if (!trimmedPath) {
      errors.push(`${label}的文件路径为空`)
      continue
    }

    const extension = extname(trimmedPath).toLowerCase()
    if (!material.allowedExtensions.includes(extension)) {
      errors.push(`${label}仅支持 ${formatExtensions(material.allowedExtensions)} 文件`)
    }

    const sourceStat = await dependencies.stat!(trimmedPath).catch(() => undefined)
    if (!sourceStat) {
      errors.push(`${label}不存在，请重新选择`)
      continue
    }
    if (!sourceStat.isFile()) {
      errors.push(`${label}路径不是文件，请重新选择`)
      continue
    }

    const handle = await dependencies.open!(trimmedPath, 'r').catch(() => undefined)
    if (!handle) {
      errors.push(`${label}不可读，请检查文件权限`)
      continue
    }
    await handle.close()
  }

  return errors
}

export const prepareReviewTaskMaterials = async (
  reviewItems: readonly ResolvedReviewItemInput[],
  destinationRoot: string,
  dependencies: PrepareReviewMaterialsDependencies = {}
): Promise<ResolvedReviewItemInput[]> => {
  const resolvedDependencies = {
    copyFile: dependencies.copyFile ?? copyFile,
    mkdir: dependencies.mkdir ?? mkdir,
    open: dependencies.open ?? open,
    stat: dependencies.stat ?? stat
  }
  const validationErrors = (
    await Promise.all(
      reviewItems.flatMap((item) =>
        item.materials.map((material) =>
          validateMaterial(item.id, material, resolvedDependencies)
        )
      )
    )
  ).flat()

  if (validationErrors.length > 0) {
    throw new Error(`审查材料无效：${[...new Set(validationErrors)].join('；')}。`)
  }

  const preparedItems: ResolvedReviewItemInput[] = []

  for (const item of reviewItems) {
    const preparedMaterials: ResolvedReviewItemMaterialInput[] = []
    for (const material of item.materials) {
      const destinationDir = join(destinationRoot, item.id, material.fieldId)
      if (material.filePaths.length > 0) {
        await resolvedDependencies.mkdir(destinationDir, { recursive: true })
      }

      const copiedPaths: string[] = []
      const reservedNames = new Set<string>()
      for (const sourcePath of material.filePaths) {
        const trimmedSourcePath = sourcePath.trim()
        const targetPath = join(
          destinationDir,
          reserveDestinationName(trimmedSourcePath, reservedNames)
        )
        await resolvedDependencies.copyFile(trimmedSourcePath, targetPath).catch(() => {
          throw new Error(`审查材料复制失败：${item.id} ${material.name}复制失败，请检查文件权限后重试。`)
        })
        copiedPaths.push(targetPath)
      }
      preparedMaterials.push({ ...material, filePaths: copiedPaths })
    }
    preparedItems.push({ ...item, materials: preparedMaterials })
  }

  return preparedItems
}
