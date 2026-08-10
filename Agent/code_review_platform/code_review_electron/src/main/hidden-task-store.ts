import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const HIDDEN_TASK_FILE_NAME = 'hidden-tasks.json'

/**
 * 记录用户从本机任务列表移除的任务 ID。
 * 隐藏只影响客户端展示，服务端任务与报告始终保留，因此明文存储即可。
 */
export class HiddenTaskStore {
  private readonly filePath: string

  constructor(filePath = join(app.getPath('userData'), HIDDEN_TASK_FILE_NAME)) {
    this.filePath = filePath
  }

  async load(): Promise<string[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown

      if (Array.isArray(parsed)) {
        return parsed.filter(
          (taskId): taskId is string => typeof taskId === 'string' && taskId.length > 0
        )
      }
    } catch {
      // 名单缺失或损坏时退回空列表：任务重新出现远好于整个列表加载失败。
    }

    return []
  }

  async add(taskId: string): Promise<void> {
    const hiddenTaskIds = await this.load()
    if (hiddenTaskIds.includes(taskId)) {
      return
    }

    await this.save([...hiddenTaskIds, taskId])
  }

  async prune(existingTaskIds: string[]): Promise<void> {
    const hiddenTaskIds = await this.load()
    const existing = new Set(existingTaskIds)
    const remaining = hiddenTaskIds.filter((taskId) => existing.has(taskId))
    if (remaining.length === hiddenTaskIds.length) {
      return
    }

    await this.save(remaining)
  }

  private async save(hiddenTaskIds: string[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(hiddenTaskIds, null, 2)}\n`)
  }
}
