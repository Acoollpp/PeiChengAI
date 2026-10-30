import { useCallback, useEffect, useRef, useState } from 'react'

import paceLogo from '../assets/pace-logo.png'
import type { GpioTask } from '../../../shared/types'

type GpioTaskPageProps = {
  svnUsername: string
}

const statusLabels: Record<GpioTask['status'], string> = {
  created: '已创建',
  uploaded: '已上传',
  analyzing: '服务端生成中',
  needs_confirmation: '需确认',
  success: '已完成',
  failed: '失败'
}

const formatDateTime = (value?: string | null): string => {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const summaryValue = (summary: GpioTask['recognition_summary'], key: string): string => {
  const value = summary?.[key]
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  return String(value)
}

export function GpioTaskPage({ svnUsername }: GpioTaskPageProps): React.JSX.Element {
  const [tasks, setTasks] = useState<GpioTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const isMountedRef = useRef(true)

  const selectedTask = tasks.find((task) => task.id === selectedTaskId)

  const loadTasks = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError('')

    try {
      const response = await window.codeReview.listGpioTasks()
      if (!isMountedRef.current) {
        return
      }
      setTasks(response.data)
      setSelectedTaskId((current) => current ?? response.data[0]?.id)
    } catch (loadError) {
      if (isMountedRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'GPIO任务列表加载失败。')
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    void loadTasks()

    return () => {
      isMountedRef.current = false
    }
  }, [loadTasks])

  const handleSvnSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = event.currentTarget
    const manualInput = form.elements.namedItem('manual-svn-url') as HTMLInputElement | null
    const codeInput = form.elements.namedItem('code-svn-url') as HTMLInputElement | null
    const manualSvnUrl = manualInput?.value.trim() ?? ''
    const codeSvnUrl = codeInput?.value.trim() ?? ''

    if (!manualSvnUrl || !codeSvnUrl) {
      setError('请填写芯片手册 SVN 路径和芯片代码 SVN 路径。')
      return
    }

    setIsSubmitting(true)
    setError('')
    setMessage('')

    try {
      const generatedTask = await window.codeReview.createGpioTask({
        manual_svn_url: manualSvnUrl,
        code_svn_url: codeSvnUrl
      })
      if (!isMountedRef.current) {
        return
      }
      setSelectedTaskId(generatedTask.id)
      setMessage('服务端已从 SVN 拉取资料并生成 GPIO 配置表。')
      form.reset()
      await loadTasks()
    } catch (submitError) {
      if (isMountedRef.current) {
        setError(submitError instanceof Error ? submitError.message : 'GPIO配置表任务提交失败。')
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false)
      }
    }
  }

  const handleGenerateAgain = async (task: GpioTask): Promise<void> => {
    setIsGenerating(true)
    setError('')
    setMessage('')

    try {
      const generatedTask = await window.codeReview.generateGpioTask(task.id)
      if (!isMountedRef.current) {
        return
      }
      setSelectedTaskId(generatedTask.id)
      setMessage('服务端已重新生成 GPIO 配置表。')
      await loadTasks()
    } catch (generateError) {
      if (isMountedRef.current) {
        setError(generateError instanceof Error ? generateError.message : '重新生成失败。')
      }
    } finally {
      if (isMountedRef.current) {
        setIsGenerating(false)
      }
    }
  }

  const handleOpenWorkbook = async (task: GpioTask): Promise<void> => {
    setIsOpening(true)
    setError('')
    setMessage('')

    try {
      const result = await window.codeReview.openGpioWorkbook(task.id, task.result_name)
      if (isMountedRef.current) {
        setMessage(`Excel位置：${result.workbookPath}`)
      }
    } catch (openError) {
      if (isMountedRef.current) {
        setError(openError instanceof Error ? openError.message : 'Excel打开失败。')
      }
    } finally {
      if (isMountedRef.current) {
        setIsOpening(false)
      }
    }
  }

  const handleDeleteTask = async (task: GpioTask): Promise<void> => {
    setError('')
    setMessage('')

    try {
      await window.codeReview.deleteGpioTask(task.id)
      if (!isMountedRef.current) {
        return
      }
      setSelectedTaskId(undefined)
      setMessage('GPIO任务已删除。')
      await loadTasks()
    } catch (deleteError) {
      if (isMountedRef.current) {
        setError(deleteError instanceof Error ? deleteError.message : 'GPIO任务删除失败。')
      }
    }
  }

  return (
    <section className="gpio-workspace">
      <aside className="left-pane">
        <div className="workspace-header">
          <div>
            <img className="workspace-logo" src={paceLogo} alt="沛城科技" />
            <p className="eyebrow">服务端生成</p>
            <h1>GPIO配置表任务</h1>
          </div>
          <span className="user-badge">{svnUsername}</span>
        </div>

        <section className="panel">
          <h2>提交 SVN 路径</h2>
          <form className="task-form" onSubmit={(event) => void handleSvnSubmit(event)}>
            <label className="field">
              芯片手册 SVN 路径
              <input
                name="manual-svn-url"
                type="text"
                placeholder="svn://.../芯片手册"
                autoComplete="off"
              />
            </label>
            <label className="field">
              芯片代码 SVN 路径
              <input
                name="code-svn-url"
                type="text"
                placeholder="svn://.../芯片代码"
                autoComplete="off"
              />
            </label>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? '生成中...' : '拉取SVN并生成'}
            </button>
          </form>
          <p className="hint">客户端只提交 SVN 路径，服务端自行拉取芯片手册和代码生成 Excel。</p>
          {error && <p className="form-error">{error}</p>}
          {message && <p className="hint">{message}</p>}
        </section>

        <section className="panel board-panel">
          <div className="panel-heading-row">
            <h2>任务记录</h2>
            <button className="ghost-button compact-button" type="button" onClick={() => void loadTasks()}>
              刷新
            </button>
          </div>
          {isLoading ? (
            <p className="empty-state">加载中...</p>
          ) : tasks.length === 0 ? (
            <p className="empty-state">暂无 GPIO 配置表任务。</p>
          ) : (
            <div className="task-list">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  className={`gpio-task-list-item${task.id === selectedTaskId ? ' is-selected' : ''}`}
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <strong>{formatDateTime(task.created_at)}</strong>
                  <span className={`task-status task-status-${task.status}`}>
                    {statusLabels[task.status]}
                  </span>
                  <span>{task.manual_svn_url}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </aside>

      <section className="right-pane gpio-detail-pane">
        <div className="preview-toolbar">
          <div>
            <p className="eyebrow">Excel</p>
            <h2>任务详情</h2>
          </div>
          {selectedTask?.result_path && (
            <button
              className="secondary-button"
              type="button"
              disabled={isOpening}
              onClick={() => void handleOpenWorkbook(selectedTask)}
            >
              打开Excel
            </button>
          )}
        </div>

        <div className="gpio-detail-scroll">
          {!selectedTask ? (
            <p className="preview-empty">选择或提交一个 GPIO 配置表任务后查看详情。</p>
          ) : (
            <div className="gpio-detail">
              <div className="gpio-detail-header">
                <div>
                  <span className={`task-status task-status-${selectedTask.status}`}>
                    {statusLabels[selectedTask.status]}
                  </span>
                  <h3>{selectedTask.result_name || 'GPIO配置表.xlsx'}</h3>
                </div>
                <div className="workspace-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={isGenerating}
                    onClick={() => void handleGenerateAgain(selectedTask)}
                  >
                    重新生成
                  </button>
                  <button
                    className="ghost-button danger-button"
                    type="button"
                    onClick={() => void handleDeleteTask(selectedTask)}
                  >
                    删除
                  </button>
                </div>
              </div>

              <dl className="gpio-summary-grid">
                <div>
                  <dt>项目号</dt>
                  <dd>{summaryValue(selectedTask.recognition_summary, 'project')}</dd>
                </div>
                <div>
                  <dt>芯片型号</dt>
                  <dd>{summaryValue(selectedTask.recognition_summary, 'chip')}</dd>
                </div>
                <div>
                  <dt>封装</dt>
                  <dd>{summaryValue(selectedTask.recognition_summary, 'package')}</dd>
                </div>
                <div>
                  <dt>创建时间</dt>
                  <dd>{formatDateTime(selectedTask.created_at)}</dd>
                </div>
              </dl>

              <section className="gpio-detail-section">
                <h3>SVN资料来源</h3>
                <dl className="gpio-source-list">
                  <div>
                    <dt>芯片手册</dt>
                    <dd>{selectedTask.manual_svn_url}</dd>
                  </div>
                  <div>
                    <dt>芯片代码</dt>
                    <dd>{selectedTask.code_svn_url}</dd>
                  </div>
                </dl>
              </section>

              {selectedTask.error_message && (
                <p className="form-error">{selectedTask.error_message}</p>
              )}
            </div>
          )}
        </div>
      </section>
    </section>
  )
}
