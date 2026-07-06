import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { TaskProgressEvent } from '../shared/types'

export const CODEX_REVIEW_LOG_FILE_NAME = 'codex-review.log'

export const appendTaskLogEvent = async (
  logPath: string,
  event: TaskProgressEvent
): Promise<void> => {
  await mkdir(dirname(logPath), { recursive: true })
  const timestamp = new Date().toISOString()

  if (event.type === 'codex_output') {
    await appendFile(logPath, `${timestamp} [${event.stream}] ${event.message}`, 'utf8')
    return
  }

  await appendFile(logPath, `${timestamp} [stage:${event.stage}] ${event.message}\n`, 'utf8')
}
