import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { TaskProgressEvent } from '../shared/types'

export const CODEX_REVIEW_LOG_FILE_NAME = 'codex-review.log'

// 调用方以 fire-and-forget 方式写日志，并发的 appendFile 会让行序与事件顺序不一致
// （真实日志里出现过 .988 的 stdout 排在 .987 的 stage 之前）。按日志路径串行化写入，
// 并允许调用方在收尾前 flush 未完成的写入。
const pendingWrites = new Map<string, Promise<void>>()

const writeTaskLogEvent = async (logPath: string, event: TaskProgressEvent): Promise<void> => {
  await mkdir(dirname(logPath), { recursive: true })
  const timestamp = new Date().toISOString()
  const line =
    event.type === 'codex_output'
      ? `${timestamp} [${event.stream}] ${event.message}`
      : `${timestamp} [stage:${event.stage}] ${event.message}\n`

  await appendFile(logPath, line, 'utf8')
}

export const appendTaskLogEvent = async (
  logPath: string,
  event: TaskProgressEvent
): Promise<void> => {
  const chained = (pendingWrites.get(logPath) ?? Promise.resolve())
    // 单条写入失败不能卡死后续日志，链条只保序不传播错误。
    .catch(() => undefined)
    .then(() => writeTaskLogEvent(logPath, event))

  pendingWrites.set(logPath, chained.catch(() => undefined))
  await chained
}

export const flushTaskLog = async (logPath: string | undefined): Promise<void> => {
  if (!logPath) {
    return
  }

  await pendingWrites.get(logPath)
  pendingWrites.delete(logPath)
}
