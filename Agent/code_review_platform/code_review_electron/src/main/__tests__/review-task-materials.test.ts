import { mkdtemp, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { prepareReviewTaskMaterials } from '../review-task-materials'
import { resolveReviewItemInputs, type ResolvedReviewItemInput } from '../../shared/review-items'

const temporaryDirectories: string[] = []

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'review-materials-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('prepareReviewTaskMaterials', () => {
  it('一次校验真实 Excel 后复制到 DS-01 任务工作区', async () => {
    const root = await makeTemporaryDirectory()
    const sourceDirectory = join(root, 'source')
    await mkdir(sourceDirectory)
    const requirementPath = join(sourceDirectory, '产品开发需求表.xlsx')
    await writeFile(requirementPath, 'xlsx-content')
    const reviewItems = resolveReviewItemInputs([{
      id: 'DS-01',
      user_extra_rules: '只核对本次变更范围',
      materials: [
        { field_id: 'requirement-sheet', file_paths: [requirementPath] }
      ]
    }])

    const prepared = await prepareReviewTaskMaterials(reviewItems, join(root, 'workspace', 'materials'))

    expect(prepared[0].materials.map((material) => material.filePaths[0])).toEqual([
      join(root, 'workspace', 'materials', 'DS-01', 'requirement-sheet', '产品开发需求表.xlsx')
    ])
    await expect(readFile(prepared[0].materials[0].filePaths[0], 'utf8')).resolves.toBe('xlsx-content')
  })

  it('组合任务只为有材料的 DS-01、DS-04、DS-06 复制材料，DS-05 不产生材料目录', async () => {
    const root = await makeTemporaryDirectory()
    const requirementPath = join(root, '组合审查需求表.xlsx')
    const afeAPath = join(root, 'AFE-A.pdf')
    const afeBPath = join(root, 'AFE-B.pdf')
    const specificationPath = join(root, '组合审查规格书.pdf')
    const destinationRoot = join(root, 'workspace', 'materials')
    await writeFile(requirementPath, 'xlsx-content')
    await writeFile(afeAPath, 'afe-a')
    await writeFile(afeBPath, 'afe-b')
    await writeFile(specificationPath, 'pdf-content')
    const reviewItems = resolveReviewItemInputs([
      {
        id: 'DS-01',
        user_extra_rules: '只核对需求变更',
        materials: [
          { field_id: 'requirement-sheet', file_paths: [requirementPath] }
        ]
      },
      {
        id: 'DS-04',
        user_extra_rules: '只检查 AFE 驱动',
        materials: [{ field_id: 'chip-specs', file_paths: [afeAPath, afeBPath] }]
      },
      {
        id: 'DS-06',
        user_extra_rules: '只核对规格参数',
        materials: [{ field_id: 'product-spec', file_paths: [specificationPath] }]
      },
      { id: 'DS-05', user_extra_rules: '只检查变更风险' }
    ])

    const prepared = await prepareReviewTaskMaterials(reviewItems, destinationRoot)

    expect(prepared).toEqual([
      expect.objectContaining({
        id: 'DS-01',
          user_extra_rules: '只核对需求变更',
          materials: [
            expect.objectContaining({ filePaths: [join(destinationRoot, 'DS-01', 'requirement-sheet', '组合审查需求表.xlsx')] })
          ]
        }),
        expect.objectContaining({
          id: 'DS-04',
          user_extra_rules: '只检查 AFE 驱动',
          materials: [
            expect.objectContaining({ filePaths: [
              join(destinationRoot, 'DS-04', 'chip-specs', 'AFE-A.pdf'),
              join(destinationRoot, 'DS-04', 'chip-specs', 'AFE-B.pdf')
            ] })
          ]
        }),
        expect.objectContaining({
          id: 'DS-06',
          user_extra_rules: '只核对规格参数',
          materials: [
            expect.objectContaining({ filePaths: [join(destinationRoot, 'DS-06', 'product-spec', '组合审查规格书.pdf')] })
          ]
        }),
        {
          id: 'DS-05',
          name: '变更点风险检查',
          user_extra_rules: '只检查变更风险',
          materials: []
      }
    ])
    await expect(stat(join(destinationRoot, 'DS-05'))).rejects.toThrow()
  })

  it('一次返回必填缺失、错误扩展名、文件缺失和不可读错误，且不复制任何文件', async () => {
    const root = await makeTemporaryDirectory()
    const wrongExtensionPath = join(root, '需求表.txt')
    const unreadablePdfPath = join(root, '芯片规格书.pdf')
    const missingPdfPath = join(root, '不存在.pdf')
    await writeFile(wrongExtensionPath, 'not-excel')
    await writeFile(unreadablePdfPath, 'pdf')
    const copyFile = vi.fn()
    const inspectMaterial = vi.fn(async (path: string) => {
      if (path === missingPdfPath) throw new Error('ENOENT')
      return stat(path)
    })
    const openMaterial = vi.fn(async (path: string, flags: string) => {
      if (path === unreadablePdfPath) throw new Error('EACCES')
      return open(path, flags)
    })

    const reviewItems: ResolvedReviewItemInput[] = [
      ...resolveReviewItemInputs([{
        id: 'DS-01',
        materials: [
          { field_id: 'requirement-sheet', file_paths: [wrongExtensionPath] }
        ]
      },
      {
        id: 'DS-04',
        materials: [
          { field_id: 'chip-specs', file_paths: [unreadablePdfPath] }
        ]
      }]),
      {
        id: 'DS-TEST',
        name: '测试材料',
        materials: [
          {
            fieldId: 'missing-required',
            name: '缺少的必填材料',
            required: true,
            multiple: false,
            allowedExtensions: ['.pdf'],
            filePaths: []
          },
          {
            fieldId: 'missing-file',
            name: '已删除材料',
            required: true,
            multiple: false,
            allowedExtensions: ['.pdf'],
            filePaths: [missingPdfPath]
          }
        ]
      }
    ]

    await expect(
      prepareReviewTaskMaterials(reviewItems, join(root, 'workspace'), {
        copyFile,
        open: openMaterial,
        stat: inspectMaterial
      })
    ).rejects.toThrow(/产品开发需求表仅支持 \.xlsx、\.xls 文件.*芯片规格书不可读.*缺少的必填材料为必填项.*已删除材料不存在/)
    expect(inspectMaterial).toHaveBeenCalledWith(missingPdfPath)
    expect(openMaterial).toHaveBeenCalledWith(unreadablePdfPath, 'r')
    expect(copyFile).not.toHaveBeenCalled()
  })

  it('复制失败时明确失败，并为不同字段的同名文件保留独立目标路径', async () => {
    const root = await makeTemporaryDirectory()
    const firstDirectory = join(root, 'first')
    const secondDirectory = join(root, 'second')
    await mkdir(firstDirectory)
    await mkdir(secondDirectory)
    const firstPath = join(firstDirectory, '同名材料.bin')
    const secondPath = join(secondDirectory, '同名材料.bin')
    await writeFile(firstPath, 'first')
    await writeFile(secondPath, 'second')
    const reviewItems: ResolvedReviewItemInput[] = [{
      id: 'DS-TEST',
      name: '测试材料',
      materials: [
        { fieldId: 'first', name: '材料一', required: true, multiple: false, allowedExtensions: ['.bin'], filePaths: [firstPath] },
        { fieldId: 'second', name: '材料二', required: true, multiple: false, allowedExtensions: ['.bin'], filePaths: [secondPath] }
      ]
    }]
    const prepared = await prepareReviewTaskMaterials(reviewItems, join(root, 'workspace'))
    expect(prepared[0].materials[0].filePaths[0]).not.toBe(prepared[0].materials[1].filePaths[0])

    await expect(prepareReviewTaskMaterials(reviewItems, join(root, 'failed-workspace'), {
      copyFile: vi.fn(async () => { throw new Error('disk full') })
    })).rejects.toThrow('审查材料复制失败：DS-TEST 材料一复制失败')
  })

  it('同一多文件字段按输入顺序隔离同名文件并保留两份内容', async () => {
    const root = await makeTemporaryDirectory()
    const firstDirectory = join(root, 'first')
    const secondDirectory = join(root, 'second')
    await mkdir(firstDirectory)
    await mkdir(secondDirectory)
    const firstPath = join(firstDirectory, '同名材料.bin')
    const secondPath = join(secondDirectory, '同名材料.bin')
    await writeFile(firstPath, 'first-content')
    await writeFile(secondPath, 'second-content')
    const destinationRoot = join(root, 'workspace', 'materials')
    const destinationDirectory = join(destinationRoot, 'DS-TEST', 'evidence')
    const reviewItems: ResolvedReviewItemInput[] = [{
      id: 'DS-TEST',
      name: '测试材料',
      materials: [{
        fieldId: 'evidence',
        name: '审查证据',
        required: true,
        multiple: true,
        allowedExtensions: ['.bin'],
        filePaths: [firstPath, secondPath]
      }]
    }]

    const prepared = await prepareReviewTaskMaterials(reviewItems, destinationRoot)
    const copiedPaths = prepared[0].materials[0].filePaths

    expect(copiedPaths).toEqual([
      join(destinationDirectory, '同名材料.bin'),
      join(destinationDirectory, '同名材料-2.bin')
    ])
    expect(copiedPaths.every((filePath) => dirname(filePath) === destinationDirectory)).toBe(true)
    await expect(Promise.all(copiedPaths.map((filePath) => readFile(filePath, 'utf8')))).resolves.toEqual([
      'first-content',
      'second-content'
    ])
  })

  it('同一多文件字段按输入顺序复制不同名文件且不重命名', async () => {
    const root = await makeTemporaryDirectory()
    const sourceDirectory = join(root, 'source')
    await mkdir(sourceDirectory)
    const firstPath = join(sourceDirectory, '第一份证据.bin')
    const secondPath = join(sourceDirectory, '第二份证据.txt')
    await writeFile(firstPath, 'first-content')
    await writeFile(secondPath, 'second-content')
    const destinationRoot = join(root, 'workspace', 'materials')
    const reviewItems: ResolvedReviewItemInput[] = [{
      id: 'DS-TEST',
      name: '测试材料',
      materials: [{
        fieldId: 'evidence',
        name: '审查证据',
        required: true,
        multiple: true,
        allowedExtensions: ['.bin', '.txt'],
        filePaths: [firstPath, secondPath]
      }]
    }]

    const prepared = await prepareReviewTaskMaterials(reviewItems, destinationRoot)
    const copiedPaths = prepared[0].materials[0].filePaths

    expect(copiedPaths).toEqual([
      join(destinationRoot, 'DS-TEST', 'evidence', '第一份证据.bin'),
      join(destinationRoot, 'DS-TEST', 'evidence', '第二份证据.txt')
    ])
    await expect(Promise.all(copiedPaths.map((filePath) => readFile(filePath, 'utf8')))).resolves.toEqual([
      'first-content',
      'second-content'
    ])
  })

  it('单文件字段选择多份文件时保留原有错误且在复制前失败', async () => {
    const root = await makeTemporaryDirectory()
    const firstPath = join(root, '第一份.bin')
    const secondPath = join(root, '第二份.bin')
    await writeFile(firstPath, 'first-content')
    await writeFile(secondPath, 'second-content')
    const copyFile = vi.fn()
    const reviewItems: ResolvedReviewItemInput[] = [{
      id: 'DS-TEST',
      name: '测试材料',
      materials: [{
        fieldId: 'single-evidence',
        name: '单文件证据',
        required: true,
        multiple: false,
        allowedExtensions: ['.bin'],
        filePaths: [firstPath, secondPath]
      }]
    }]

    await expect(
      prepareReviewTaskMaterials(reviewItems, join(root, 'workspace'), { copyFile })
    ).rejects.toThrow('审查材料无效：DS-TEST 单文件证据只能选择一个文件。')
    expect(copyFile).not.toHaveBeenCalled()
  })

  it('从头重试会重新读取原始路径，原文件删除后明确失败', async () => {
    const root = await makeTemporaryDirectory()
    const sourcePath = join(root, '原始材料.pdf')
    await writeFile(sourcePath, 'pdf')
    const reviewItems: ResolvedReviewItemInput[] = [{
      id: 'DS-TEST',
      name: '测试材料',
      materials: [{
        fieldId: 'spec', name: '产品规格书', required: true, multiple: false,
        allowedExtensions: ['.pdf'], filePaths: [sourcePath]
      }]
    }]
    await prepareReviewTaskMaterials(reviewItems, join(root, 'first-run'))
    await rm(sourcePath)

    await expect(
      prepareReviewTaskMaterials(reviewItems, join(root, 'retry-run'))
    ).rejects.toThrow('产品规格书不存在，请重新选择')
  })
})
