# Electron 任务看板与 Markdown 展示改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Electron 客户端任务看板改为“当前任务/历史任务”分段切换，并把右侧报告预览升级为成熟 Markdown 渲染。

**Architecture:** 保留现有 `TaskPage` 数据流和 Electron IPC，所有改造限定在 renderer 展示层。`TaskBoard` 内部维护 tab 状态并从 `tasks` 派生当前任务与历史任务；`MarkdownPreview` 使用 `react-markdown` 和 `remark-gfm` 替代手写 parser，并通过 CSS 处理代码块、表格和长内容溢出。

**Tech Stack:** Electron renderer、React 19、TypeScript、Vitest、React Testing Library、jsdom、react-markdown、remark-gfm、CSS。

---

## 文件结构

- 修改 `Agent/code_review_platform/code_review_electron/package.json`
  - 增加 Markdown 渲染依赖：`react-markdown`、`remark-gfm`。
  - 增加 renderer 组件测试依赖：`@testing-library/react`、`@testing-library/jest-dom`、`@testing-library/user-event`、`jsdom`。
- 修改 `Agent/code_review_platform/code_review_electron/package-lock.json`
  - 由 `npm install` 自动更新。
- 修改 `Agent/code_review_platform/code_review_electron/tsconfig.json`
  - 增加 Vitest 和 jest-dom 类型，支持 `.test.tsx` 组件测试。
- 创建 `Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskBoard.test.tsx`
  - 覆盖默认当前任务、历史任务切换、日志只在当前任务显示、空状态。
- 修改 `Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskBoard.tsx`
  - 增加 `当前任务/历史任务` 分段按钮。
  - 当前任务取 `tasks[0]`。
  - 历史任务取 `tasks.slice(1)`。
  - 历史任务不渲染 `codex_log`。
- 创建 `Agent/code_review_platform/code_review_electron/src/renderer/src/components/MarkdownPreview.test.tsx`
  - 覆盖标题、表格、代码块、链接安全过滤和空状态。
- 修改 `Agent/code_review_platform/code_review_electron/src/renderer/src/components/MarkdownPreview.tsx`
  - 使用 `react-markdown` 和 `remark-gfm` 渲染 Markdown。
  - 自定义 `a`、`pre`、`code`、`table` 等元素。
  - 移除 `dangerouslySetInnerHTML` 和 `renderMarkdown` 依赖。
- 删除 `Agent/code_review_platform/code_review_electron/src/renderer/src/markdown.ts`
  - 手写 Markdown parser 不再使用。
- 删除 `Agent/code_review_platform/code_review_electron/src/renderer/src/markdown.test.ts`
  - 迁移为 `MarkdownPreview.test.tsx` 组件测试。
- 修改 `Agent/code_review_platform/code_review_electron/src/renderer/src/styles.css`
  - 增加任务看板 tab、当前任务卡、历史任务列表样式。
  - 增强 Markdown 标题、段落、代码块、表格、链接、引用块样式。

---

### Task 1: 安装 Markdown 与组件测试依赖

**Files:**
- Modify: `Agent/code_review_platform/code_review_electron/package.json`
- Modify: `Agent/code_review_platform/code_review_electron/package-lock.json`

- [ ] **Step 1: 安装依赖**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm install react-markdown remark-gfm
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Expected: 命令成功，`package.json` 中出现以下依赖名称，具体版本号由 npm 写入：

```json
{
  "dependencies": {
    "react-markdown": "<npm 写入的版本>",
    "remark-gfm": "<npm 写入的版本>"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "<npm 写入的版本>",
    "@testing-library/react": "<npm 写入的版本>",
    "@testing-library/user-event": "<npm 写入的版本>",
    "jsdom": "<npm 写入的版本>"
  }
}
```

- [ ] **Step 2: 确认 lockfile 更新**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git status --short -- Agent/code_review_platform/code_review_electron/package.json Agent/code_review_platform/code_review_electron/package-lock.json
```

Expected: 只看到这两个文件因依赖安装发生修改：

```text
 M Agent/code_review_platform/code_review_electron/package.json
 M Agent/code_review_platform/code_review_electron/package-lock.json
```

- [ ] **Step 3: 提交依赖变更**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git add Agent/code_review_platform/code_review_electron/package.json Agent/code_review_platform/code_review_electron/package-lock.json
git commit -m "chore: 增加 Electron Markdown 渲染依赖"
```

Expected: 生成一个只包含依赖文件的提交。

---

### Task 2: 配置 renderer 组件测试类型

**Files:**
- Modify: `Agent/code_review_platform/code_review_electron/tsconfig.json`

- [ ] **Step 1: 增加测试类型**

Modify `Agent/code_review_platform/code_review_electron/tsconfig.json` compiler options:

```json
{
  "compilerOptions": {
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"]
  }
}
```

Keep all existing compiler options unchanged.

- [ ] **Step 2: 运行现有测试确认类型配置未破坏主进程测试**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test
```

Expected: 现有测试继续执行；如果出现缺少 `jsdom` 或测试环境解析错误，修复配置后重跑。

- [ ] **Step 3: 提交测试类型配置**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git add Agent/code_review_platform/code_review_electron/tsconfig.json
git commit -m "test: 配置 Electron renderer 组件测试"
```

Expected: 生成一个只包含 `tsconfig.json` 的提交。

---

### Task 3: 用测试定义任务看板 tab 行为

**Files:**
- Create: `Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskBoard.test.tsx`
- Modify: `Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskBoard.tsx`

- [ ] **Step 1: 写失败测试**

Create `Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskBoard.test.tsx`:

```tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ReviewTask } from '../../../shared/types'
import { TaskBoard } from './TaskBoard'

const tasks: ReviewTask[] = [
  {
    id: 'task-current',
    svn_url: 'https://svn.example.com/project/current',
    old_revision: '100',
    new_revision: '101',
    status: 'running_codex',
    progress_message: 'Codex 正在审查',
    codex_log: [
      {
        taskId: 'task-current',
        type: 'codex_output',
        stream: 'stdout',
        message: 'analyzing src/current.c\n'
      }
    ]
  },
  {
    id: 'task-history',
    svn_url: 'https://svn.example.com/project/history',
    old_revision: '90',
    new_revision: '91',
    status: 'success',
    progress_message: '审查完成',
    codex_log: [
      {
        taskId: 'task-history',
        type: 'codex_output',
        stream: 'stdout',
        message: 'old noisy output\n'
      }
    ]
  }
]

describe('TaskBoard', () => {
  it('默认显示当前任务并展示 Codex 日志', () => {
    render(<TaskBoard tasks={tasks} />)

    expect(screen.getByRole('tab', { name: '当前任务' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('task-current')).toBeInTheDocument()
    expect(screen.getByText('https://svn.example.com/project/current')).toBeInTheDocument()
    expect(screen.getByText('analyzing src/current.c')).toBeInTheDocument()
    expect(screen.queryByText('task-history')).not.toBeInTheDocument()
  })

  it('切换到历史任务后隐藏当前任务和 Codex 日志', async () => {
    const user = userEvent.setup()
    render(<TaskBoard tasks={tasks} />)

    await user.click(screen.getByRole('tab', { name: '历史任务' }))

    expect(screen.getByRole('tab', { name: '历史任务' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('task-history')).toBeInTheDocument()
    expect(screen.getByText('https://svn.example.com/project/history')).toBeInTheDocument()
    expect(screen.queryByText('old noisy output')).not.toBeInTheDocument()
    expect(screen.queryByText('task-current')).not.toBeInTheDocument()
  })

  it('历史任务成功时可以查看报告', async () => {
    const user = userEvent.setup()
    const onViewReport = vi.fn()
    render(<TaskBoard tasks={tasks} onViewReport={onViewReport} />)

    await user.click(screen.getByRole('tab', { name: '历史任务' }))
    await user.click(screen.getByRole('button', { name: '查看报告' }))

    expect(onViewReport).toHaveBeenCalledWith(tasks[1])
  })

  it('当前任务为空时显示当前任务空状态', () => {
    render(<TaskBoard tasks={[]} />)

    expect(screen.getByText('暂无当前任务，填写上方表单后开始审查。')).toBeInTheDocument()
  })

  it('历史任务为空时显示历史任务空状态', async () => {
    const user = userEvent.setup()
    render(<TaskBoard tasks={[tasks[0]]} />)

    await user.click(screen.getByRole('tab', { name: '历史任务' }))

    expect(screen.getByText('暂无历史任务。')).toBeInTheDocument()
  })

  it('加载状态显示任务加载文案', () => {
    render(<TaskBoard tasks={[]} isLoading />)

    expect(screen.getByText('正在加载任务...')).toBeInTheDocument()
  })

  it('当前任务成功时查看报告按钮使用当前任务', async () => {
    const user = userEvent.setup()
    const onViewReport = vi.fn()
    const successTasks: ReviewTask[] = [{ ...tasks[0], status: 'success' }]
    render(<TaskBoard tasks={successTasks} onViewReport={onViewReport} />)

    const currentPanel = screen.getByRole('tabpanel', { name: '当前任务' })
    await user.click(within(currentPanel).getByRole('button', { name: '查看报告' }))

    expect(onViewReport).toHaveBeenCalledWith(successTasks[0])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/TaskBoard.test.tsx
```

Expected: FAIL，原因是 `TaskBoard` 还没有 tab、tabpanel 和新的空状态。

- [ ] **Step 3: 实现 TaskBoard tab 与当前/历史任务派生**

Replace `Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskBoard.tsx` with:

```tsx
import { useMemo, useState } from 'react'

import type { ReviewTask } from '../../../shared/types'

type TaskBoardProps = {
  tasks: ReviewTask[]
  isLoading?: boolean
  selectedTaskId?: string
  loadingReportTaskId?: string
  onViewReport?: (task: ReviewTask) => void
}

type TaskBoardView = 'current' | 'history'

const statusText: Record<ReviewTask['status'], string> = {
  created: '已创建',
  checking_environment: '检查环境',
  running_codex: '审查中',
  uploading_report: '上传报告',
  success: '已完成',
  failed: '失败',
  environment_error: '环境异常',
  cancelled: '已取消'
}

export function TaskBoard({
  tasks,
  isLoading = false,
  selectedTaskId,
  loadingReportTaskId,
  onViewReport
}: TaskBoardProps): React.JSX.Element {
  const [activeView, setActiveView] = useState<TaskBoardView>('current')
  const currentTask = tasks[0]
  const historyTasks = useMemo(() => tasks.slice(1), [tasks])

  return (
    <div className="task-board">
      <div className="task-board-tabs" role="tablist" aria-label="任务看板视图">
        <button
          className={activeView === 'current' ? 'task-board-tab is-active' : 'task-board-tab'}
          type="button"
          role="tab"
          aria-selected={activeView === 'current'}
          aria-controls="current-task-panel"
          id="current-task-tab"
          onClick={() => setActiveView('current')}
        >
          当前任务
        </button>
        <button
          className={activeView === 'history' ? 'task-board-tab is-active' : 'task-board-tab'}
          type="button"
          role="tab"
          aria-selected={activeView === 'history'}
          aria-controls="history-task-panel"
          id="history-task-tab"
          onClick={() => setActiveView('history')}
        >
          历史任务
        </button>
      </div>

      {isLoading ? (
        <p className="empty-state">正在加载任务...</p>
      ) : activeView === 'current' ? (
        <div
          id="current-task-panel"
          role="tabpanel"
          aria-label="当前任务"
          aria-labelledby="current-task-tab"
        >
          {currentTask ? (
            <TaskCard
              task={currentTask}
              variant="current"
              isSelected={currentTask.id === selectedTaskId}
              isLoadingReport={loadingReportTaskId === currentTask.id}
              onViewReport={onViewReport}
            />
          ) : (
            <p className="empty-state">暂无当前任务，填写上方表单后开始审查。</p>
          )}
        </div>
      ) : (
        <div
          id="history-task-panel"
          role="tabpanel"
          aria-label="历史任务"
          aria-labelledby="history-task-tab"
        >
          {historyTasks.length > 0 ? (
            <div className="history-task-list" aria-label="历史任务列表">
              {historyTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  variant="history"
                  isSelected={task.id === selectedTaskId}
                  isLoadingReport={loadingReportTaskId === task.id}
                  onViewReport={onViewReport}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">暂无历史任务。</p>
          )}
        </div>
      )}
    </div>
  )
}

type TaskCardProps = {
  task: ReviewTask
  variant: TaskBoardView
  isSelected: boolean
  isLoadingReport: boolean
  onViewReport?: (task: ReviewTask) => void
}

function TaskCard({
  task,
  variant,
  isSelected,
  isLoadingReport,
  onViewReport
}: TaskCardProps): React.JSX.Element {
  const showCodexLog = variant === 'current' && task.codex_log && task.codex_log.length > 0
  const cardClassName = [
    'task-card',
    variant === 'current' ? 'current-task-card' : 'history-task-card',
    isSelected ? 'is-selected' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={cardClassName}>
      <div className="task-card-header">
        <strong>{task.id}</strong>
        <span className={`task-status task-status-${task.status}`}>{statusText[task.status]}</span>
      </div>
      <p className="task-url">{task.svn_url}</p>
      <dl className="task-meta">
        <div>
          <dt>旧版本</dt>
          <dd>{task.old_revision}</dd>
        </div>
        <div>
          <dt>新版本</dt>
          <dd>{task.new_revision}</dd>
        </div>
      </dl>
      {task.status === 'success' && (
        <button
          className="task-action-button"
          type="button"
          disabled={isLoadingReport}
          onClick={() => onViewReport?.(task)}
        >
          {isLoadingReport ? '加载中...' : '查看报告'}
        </button>
      )}
      {task.progress_message && <p className="task-progress">{task.progress_message}</p>}
      {showCodexLog && (
        <div className="task-log" aria-label="Codex 执行输出">
          {task.codex_log!.slice(-6).map((event, index) => (
            <pre className={`task-log-line task-log-${event.type}`} key={`${task.id}-${index}`}>
              {event.message.trimEnd()}
            </pre>
          ))}
        </div>
      )}
      {task.error_message && <p className="task-error">{task.error_message}</p>}
    </article>
  )
}
```

- [ ] **Step 4: 运行 TaskBoard 测试确认通过**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/TaskBoard.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 提交 TaskBoard 行为改造**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git add Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskBoard.tsx Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskBoard.test.tsx
git commit -m "feat: 拆分 Electron 当前任务和历史任务看板"
```

Expected: 生成一个只包含 TaskBoard 组件与测试的提交。

---

### Task 4: 用测试定义 MarkdownPreview 渲染行为

**Files:**
- Create: `Agent/code_review_platform/code_review_electron/src/renderer/src/components/MarkdownPreview.test.tsx`
- Modify: `Agent/code_review_platform/code_review_electron/src/renderer/src/components/MarkdownPreview.tsx`
- Delete: `Agent/code_review_platform/code_review_electron/src/renderer/src/markdown.ts`
- Delete: `Agent/code_review_platform/code_review_electron/src/renderer/src/markdown.test.ts`

- [ ] **Step 1: 写失败测试**

Create `Agent/code_review_platform/code_review_electron/src/renderer/src/components/MarkdownPreview.test.tsx`:

```tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownPreview } from './MarkdownPreview'

describe('MarkdownPreview', () => {
  it('空内容显示空状态', () => {
    render(<MarkdownPreview markdown="" />)

    expect(screen.getByText('审查完成后，Markdown 报告会显示在这里。')).toBeInTheDocument()
  })

  it('渲染标题、列表、表格和代码块', () => {
    render(
      <MarkdownPreview
        markdown={[
          '# 审查报告',
          '',
          '- 文件 `src/App.tsx` 已更新',
          '',
          '| 文件 | 风险 |',
          '| --- | --- |',
          '| src/App.tsx | 低 |',
          '',
          '```ts',
          'const status = "ok"',
          '```'
        ].join('\n')}
      />
    )

    expect(screen.getByRole('heading', { name: '审查报告', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('文件')).toBeInTheDocument()
    expect(screen.getByText('src/App.tsx')).toBeInTheDocument()
    expect(screen.getByText('低')).toBeInTheDocument()
    expect(screen.getByText('const status = "ok"')).toBeInTheDocument()
    expect(screen.getByText('ts')).toBeInTheDocument()
  })

  it('安全链接保留 href 并阻止危险协议', () => {
    render(
      <MarkdownPreview markdown="[安全链接](https://example.com)\n\n[危险链接](javascript:alert(1))" />
    )

    expect(screen.getByRole('link', { name: '安全链接' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByText('危险链接')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '危险链接' })).not.toBeInTheDocument()
  })

  it('表格被横向滚动容器包裹', () => {
    const { container } = render(<MarkdownPreview markdown="| A | B |\n| --- | --- |\n| 1 | 2 |" />)

    const wrapper = container.querySelector('.markdown-table-wrapper')
    expect(wrapper).toBeInTheDocument()
    expect(within(wrapper as HTMLElement).getByRole('table')).toBeInTheDocument()
  })

  it('遇到渲染异常时显示兜底提示', () => {
    const throwingMarkdown = {
      trim: () => 'not-empty',
      toString: () => {
        throw new Error('render failed')
      }
    } as unknown as string

    render(<MarkdownPreview markdown={throwingMarkdown} />)

    expect(screen.getByText('报告渲染失败，请下载报告查看原始 Markdown。')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/MarkdownPreview.test.tsx
```

Expected: FAIL，原因是 `MarkdownPreview` 仍然使用手写 HTML 渲染，缺少表格 wrapper、语言标签和链接过滤行为。

- [ ] **Step 3: 实现 React Markdown 渲染**

Replace `Agent/code_review_platform/code_review_electron/src/renderer/src/components/MarkdownPreview.tsx` with:

```tsx
import { Component, isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownPreviewProps = {
  markdown: string
}

const safeUrl = (href?: string): string | undefined => {
  if (!href) {
    return undefined
  }

  try {
    const parsed = new URL(href, 'https://code-review.local')
    if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return href
    }
  } catch {
    return undefined
  }

  return undefined
}

const getCodeLanguage = (children: ReactNode): string | undefined => {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement<{ className?: string }>(child)) {
    return undefined
  }

  return /language-(\w+)/.exec(child.props.className ?? '')?.[1]
}

class MarkdownErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <div className="preview-empty">报告渲染失败，请下载报告查看原始 Markdown。</div>
    }

    return this.props.children
  }
}

export function MarkdownPreview({ markdown }: MarkdownPreviewProps): React.JSX.Element {
  if (!markdown.trim()) {
    return (
      <div className="preview-scroll">
        <div className="preview-empty">审查完成后，Markdown 报告会显示在这里。</div>
      </div>
    )
  }

  return (
    <div className="preview-scroll">
      <MarkdownErrorBoundary>
        <article className="markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => {
                const safeHref = safeUrl(href)
                if (!safeHref) {
                  return <span>{children}</span>
                }

                return (
                  <a href={safeHref} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                )
              },
              code: ({ className, children, ...props }) => (
                <code className={className} {...props}>
                  {children}
                </code>
              ),
              pre: ({ children }) => {
                const language = getCodeLanguage(children)
                return (
                  <div className="markdown-code-block">
                    {language && <div className="markdown-code-language">{language}</div>}
                    <pre>{children}</pre>
                  </div>
                )
              },
              table: ({ children }) => (
                <div className="markdown-table-wrapper">
                  <table>{children}</table>
                </div>
              )
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      </MarkdownErrorBoundary>
    </div>
  )
}
```

- [ ] **Step 4: 删除手写 parser 和旧测试**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
rm Agent/code_review_platform/code_review_electron/src/renderer/src/markdown.ts
rm Agent/code_review_platform/code_review_electron/src/renderer/src/markdown.test.ts
```

Expected: `markdown.ts` 和 `markdown.test.ts` 被删除。

- [ ] **Step 5: 运行 MarkdownPreview 测试确认通过**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/MarkdownPreview.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 运行 renderer 相关测试确认删除旧 parser 后无引用**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src
```

Expected: PASS。

- [ ] **Step 7: 提交 MarkdownPreview 改造**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git add Agent/code_review_platform/code_review_electron/src/renderer/src/components/MarkdownPreview.tsx Agent/code_review_platform/code_review_electron/src/renderer/src/components/MarkdownPreview.test.tsx
git rm Agent/code_review_platform/code_review_electron/src/renderer/src/markdown.ts Agent/code_review_platform/code_review_electron/src/renderer/src/markdown.test.ts
git commit -m "feat: 升级 Electron Markdown 报告预览"
```

Expected: 生成一个包含 MarkdownPreview、测试和旧 parser 删除的提交。

---

### Task 5: 补齐任务看板与 Markdown 样式

**Files:**
- Modify: `Agent/code_review_platform/code_review_electron/src/renderer/src/styles.css`

- [ ] **Step 1: 增加任务看板 tab 样式**

Append near existing `.board-panel` and `.task-list` styles in `styles.css`:

```css
.task-board {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.task-board-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 8px;
  background: rgb(255 255 255 / 8%);
}

.task-board-tab {
  min-height: 34px;
  border: 0;
  border-radius: 6px;
  color: rgb(245 247 251 / 60%);
  background: transparent;
  font-size: 13px;
  font-weight: 800;
}

.task-board-tab.is-active {
  color: #ffffff;
  background: rgb(18 185 120 / 24%);
  box-shadow: inset 0 0 0 1px rgb(18 185 120 / 24%);
}
```

- [ ] **Step 2: 调整任务卡和历史列表样式**

Replace existing `.task-list` block with:

```css
.history-task-list {
  display: grid;
  gap: 12px;
  max-height: 460px;
  min-width: 0;
  overflow: auto;
}
```

Keep `.task-card` selector but adjust it to:

```css
.task-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 8px;
  padding: 13px;
  background: #0b0f13;
}

.current-task-card {
  min-height: 250px;
}

.history-task-card {
  min-height: 0;
}
```

Keep existing `.task-card.is-selected`, `.task-card strong`, `.task-url`, `.task-meta`, `.task-action-button`, `.task-error`, `.task-progress`, `.task-log`, `.task-log-line` rules.

- [ ] **Step 3: 增强 Markdown 样式**

Replace existing `.markdown-preview` Markdown-related rules from `.markdown-preview` through `.markdown-preview tr:nth-child(even) td` with:

```css
.markdown-preview {
  max-width: 980px;
  min-width: 0;
  color: rgb(245 247 251 / 86%);
  font-size: 15px;
  line-height: 1.75;
}

.markdown-preview h1,
.markdown-preview h2,
.markdown-preview h3 {
  margin: 28px 0 12px;
  color: #ffffff;
  line-height: 1.28;
}

.markdown-preview h1:first-child,
.markdown-preview h2:first-child,
.markdown-preview h3:first-child {
  margin-top: 0;
}

.markdown-preview p,
.markdown-preview ul,
.markdown-preview ol,
.markdown-preview blockquote {
  margin: 0 0 16px;
}

.markdown-preview ul,
.markdown-preview ol {
  padding-left: 22px;
}

.markdown-preview blockquote {
  border-left: 3px solid rgb(18 185 120 / 64%);
  padding: 8px 0 8px 14px;
  color: rgb(245 247 251 / 68%);
  background: rgb(255 255 255 / 5%);
}

.markdown-preview a {
  color: #64d8ff;
  text-decoration: none;
}

.markdown-preview a:hover {
  text-decoration: underline;
}

.markdown-preview :not(pre) > code {
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 5px;
  padding: 2px 5px;
  color: #bff8d8;
  background: rgb(255 255 255 / 8%);
  font-size: 0.9em;
}

.markdown-code-block {
  overflow: hidden;
  margin: 0 0 18px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 8px;
  background: #070a0d;
}

.markdown-code-language {
  min-height: 30px;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
  padding: 6px 12px;
  color: rgb(245 247 251 / 56%);
  background: rgb(255 255 255 / 5%);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.markdown-code-block pre {
  margin: 0;
  overflow: auto;
  padding: 14px;
}

.markdown-code-block code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  color: #e8edf2;
  font-size: 13px;
  line-height: 1.6;
}

.markdown-table-wrapper {
  max-width: 100%;
  overflow-x: auto;
  margin: 0 0 18px;
}

.markdown-preview table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.markdown-preview th,
.markdown-preview td {
  border: 1px solid rgb(255 255 255 / 10%);
  padding: 9px 11px;
  text-align: left;
  vertical-align: top;
}

.markdown-preview th {
  color: #f5f7fb;
  background: rgb(255 255 255 / 9%);
}

.markdown-preview tr:nth-child(even) td {
  background: rgb(255 255 255 / 4%);
}
```

- [ ] **Step 4: 运行 typecheck 捕获 CSS 之外的类型问题**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm run typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交样式改造**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git add Agent/code_review_platform/code_review_electron/src/renderer/src/styles.css
git commit -m "style: 优化 Electron 任务看板和 Markdown 样式"
```

Expected: 生成一个只包含 CSS 的提交。

---

### Task 6: 全量验证与构建

**Files:**
- No source changes expected.

- [ ] **Step 1: 运行完整测试**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test
```

Expected: PASS，包含主进程测试、`TaskBoard.test.tsx` 和 `MarkdownPreview.test.tsx`。

- [ ] **Step 2: 运行类型检查**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm run typecheck
```

Expected: PASS。

- [ ] **Step 3: 运行构建**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm run build
```

Expected: PASS，生成 `out/` 目录。不要提交 `out/` 或 `release/` 构建产物。

- [ ] **Step 4: 检查工作区只剩预期文件**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git status --short
```

Expected: 不出现本次任务未提交的源码、测试或配置文件。仓库已有的无关构建产物和 runtime 数据如果仍存在，不处理、不提交、不删除。

---

### Task 7: 人工预览与交付记录

**Files:**
- No source changes expected unless preview finds a defect.

- [ ] **Step 1: 启动 Electron dev 客户端**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm run dev
```

Expected: Electron 客户端启动。

- [ ] **Step 2: 人工检查任务看板**

在客户端中确认：

1. `任务看板` 标题下方显示 `当前任务` 和 `历史任务` 两个分段按钮。
2. 默认选中 `当前任务`。
3. 当前任务卡能显示任务摘要、状态、版本号、进度和 Codex 日志。
4. 切换 `历史任务` 后不显示 Codex 日志。
5. 历史任务“查看报告”能切换右侧报告。

- [ ] **Step 3: 人工检查 Markdown 报告**

使用一份包含标题、列表、表格、代码块和长链接的报告确认：

1. 标题层级清晰。
2. 代码块深色展示且横向滚动。
3. 表格在右侧面板内横向滚动，不撑破布局。
4. 长 URL 不破坏布局。
5. 空报告状态仍显示原文案。

- [ ] **Step 4: 停止 dev 客户端**

关闭 Electron 窗口；如果终端进程仍在运行，按 `Ctrl+C` 停止。

- [ ] **Step 5: 最终状态检查**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git log --oneline -5
git status --short
```

Expected: 最近提交包含本次改造相关提交；`git status` 中没有本次改造遗漏的未提交文件。
