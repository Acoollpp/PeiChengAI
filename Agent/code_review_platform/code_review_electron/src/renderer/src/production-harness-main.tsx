import React from 'react'
import ReactDOM from 'react-dom/client'

import type { CodeReviewApi } from './code-review-api'
import { SvnBindingDialog } from './components/SvnBindingDialog'
import { UpdateDialog } from './components/UpdateDialog'
import {
  PRODUCTION_REVIEW_ITEM_CATALOG,
  ProductionReviewWorkbench
} from './workbench-preview/ProductionReviewWorkbench'
import './styles.css'

const unsubscribe = (): void => undefined
const longReviewItemName = '状态机审核与故障恢复及跨模式安全降级边界条件完整性联合审查（超长名称视觉压力样例）'
const longNameStressCatalog = PRODUCTION_REVIEW_ITEM_CATALOG.map((item) =>
  item.id === 'DS-03' ? { ...item, name: longReviewItemName } : item
)
const searchParams = new URLSearchParams(window.location.search)
const harnessScenario = searchParams.get('scenario')
const catalogOverride = searchParams.get('catalog') === 'long-review-item-name'
  ? longNameStressCatalog
  : undefined
const pendingExecution = new Promise<never>(() => undefined)
const longRepositoryName = '储能柜主控状态机与故障恢复跨模式安全降级边界条件联合审查任务-2026-Q3-最终确认版'
const longSvnUrl = `svn://192.168.100.88:3690/新能源汽车电子平台/电池管理系统/储能柜控制器/正式发布分支/${longRepositoryName}`
const longFailureMessage =
  'Codex 执行失败：工作区中的状态机生成文件与规格书第五章约束不一致；请打开完整日志核对 checkout、CodeGraph 索引和审查 Skill 输出后，从头重试本任务。'
const reportMarkdown = `# BMS 状态机代码审查报告

## 审查结论

报告正文需要在明亮工作台中保持清晰，并保留[审查依据](https://example.com/review-basis)链接。

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| 状态迁移 | 通过 | 未发现阻断问题 |
| 异常恢复 | 待确认 | 核对 \`FAULT_RECOVERY_TIMEOUT\` 配置 |

\`guardStateTransition()\` 必须在所有入口保持一致。

\`\`\`c
if (next_state == STATE_FAULT) {
  enter_safe_mode();
}
\`\`\`

> 该报告为生产验收样例，用于验证 Markdown 的标题、链接、代码、引用和表格对比度。
`
const environment = harnessScenario === 'codegraph-error'
  ? {
      status: 'failed' as const,
      codexVersion: '0.1.2508071601',
      codexPath: 'C:\\Program Files\\PeiCheng AI Code Review\\resources\\codex\\codex.exe',
      codegraphStatus: 'corrupt' as const,
      codegraphRequiredVersion: '1.4.1',
      codegraphVersion: '1.4.1',
      codegraphPath:
        'C:\\Users\\Quality Engineer\\AppData\\Local\\Programs\\AI Code Review Client\\resources\\codegraph\\win32-x64\\bin\\codegraph.cmd',
      codegraphError:
        '内置 CodeGraph 1.4.1 资源损坏或校验不一致，请重新安装客户端；不会回退到用户全局版本。'
    }
  : {
      status: 'ready' as const,
      codexVersion: '0.1.2508071601',
      svnVersion: '1.14.5',
      codexPath: 'C:\\Program Files\\PeiCheng AI Code Review\\resources\\codex\\codex.exe',
      svnPath: 'C:\\Program Files\\PeiCheng AI Code Review\\resources\\svn\\svn.exe',
      codegraphStatus: 'ready' as const,
      codegraphRequiredVersion: '1.4.1',
      codegraphVersion: '1.4.1',
      codegraphPath:
        'C:\\Program Files\\PeiCheng AI Code Review\\resources\\codegraph\\win32-x64\\bin\\codegraph.cmd'
    }
const materialFiles = {
  'requirement-sheet': {
    filePath: '/private/tmp/2026年第三季度电池管理系统产品开发需求评审与协议变更追踪矩阵最终确认版.xlsx',
    fileName: '2026年第三季度电池管理系统产品开发需求评审与协议变更追踪矩阵最终确认版.xlsx',
    fileSize: 8_734_912
  },
  'product-spec': {
    filePath: '/private/tmp/PCH-BMS-储能柜控制器产品规格书第五章基本参数与异常恢复策略联合评审长文件名版本-R18.pdf',
    fileName: 'PCH-BMS-储能柜控制器产品规格书第五章基本参数与异常恢复策略联合评审长文件名版本-R18.pdf',
    fileSize: 15_482_771
  }
} as const

const harnessApi: Pick<
  CodeReviewApi,
  | 'listTasks'
  | 'getTodayTaskStats'
  | 'readTaskReport'
  | 'preflightTask'
  | 'executeTask'
  | 'retryTask'
  | 'cancelTask'
  | 'selectReviewMaterialFile'
  | 'onTaskProgress'
  | 'onTaskCompletionNotificationClicked'
  | 'onReportFeedbackFocusAnchor'
  | 'onReportFeedbackSubmitted'
  | 'onIssueFeedbackSubmitted'
> = {
  async listTasks() {
    if (harnessScenario === 'report-center') {
      return {
        data: [
          {
            id: 'completed-markdown-report-001',
            svn_url: longSvnUrl,
            old_revision: '18420',
            new_revision: '18579',
            review_item_ids: ['DS-01', 'DS-03'],
            status: 'success' as const,
            report_path: 'C:\\Users\\Quality Engineer\\Documents\\PeiCheng AI Reports\\BMS 状态机代码审查报告.md',
            report_name: 'BMS 状态机代码审查报告.md',
            issue_count: 2,
            highest_issue_severity: 'medium' as const,
            finished_at: '2026-08-09T16:08:00Z'
          },
          {
            id: 'completed-empty-report-002',
            svn_url: 'svn://192.168.100.88:3690/BMS/controller/release/empty-report-compatibility',
            old_revision: '18579',
            new_revision: '18580',
            review_item_ids: ['DS-03'],
            status: 'success' as const,
            report_path: 'C:\\Users\\Quality Engineer\\Documents\\PeiCheng AI Reports\\空报告兼容性检查.md',
            report_name: '空报告兼容性检查.md',
            finished_at: '2026-08-09T16:10:00Z'
          }
        ],
        count: 2
      }
    }
    if (harnessScenario === 'failed-tasks') {
      return {
        data: [
          {
            id: 'failed-long-task-2026-08-09-001',
            svn_url: longSvnUrl,
            old_revision: '18420',
            new_revision: '18579',
            review_item_ids: ['DS-01', 'DS-03'],
            status: 'failed' as const,
            error_message: longFailureMessage,
            finished_at: '2026-08-09T15:32:00Z'
          },
          {
            id: 'failed-codegraph-index-002',
            svn_url: 'svn://192.168.100.88:3690/BMS/platform/release/branch-with-a-very-long-name-for-layout-validation',
            old_revision: '18310',
            new_revision: '18420',
            review_item_ids: ['DS-02'],
            status: 'failed' as const,
            error_message: 'CodeGraph 索引阶段退出，详细堆栈已写入本地日志。',
            finished_at: '2026-08-09T14:18:00Z'
          },
          {
            id: 'failed-upload-report-003',
            svn_url: 'svn://192.168.100.88:3690/BMS/controller/hotfix/report-upload-timeout',
            old_revision: '18290',
            new_revision: '18310',
            review_item_ids: ['DS-03'],
            status: 'failed' as const,
            error_message: '报告上传超时，Markdown 草稿和 Codex 日志仍保留在本机任务目录。',
            finished_at: '2026-08-09T13:06:00Z'
          }
        ],
        count: 3
      }
    }
    return { data: [], count: 0 }
  },
  async getTodayTaskStats() {
    if (harnessScenario === 'stats-error') {
      throw new Error('生产验收模拟：今日统计服务暂不可用')
    }
    const running = harnessScenario === 'multi-task' ? 2 : 0
    const failed = harnessScenario === 'failed-tasks' ? 3 : 0
    return {
      range: 'today',
      total: 5 + running + failed,
      success: 5,
      running,
      failed_or_error: failed,
      average_duration_seconds: 521,
      by_status: { success: 5, running_codex: running, failed },
      reports_by_user: [],
      trend: [{ label: '14:00', count: 5 + running + failed }]
    }
  },
  async readTaskReport(taskId) {
    return harnessScenario === 'report-center' && taskId !== 'completed-empty-report-002'
      ? reportMarkdown
      : ''
  },
  async preflightTask() {
    return { status: 'valid' }
  },
  async executeTask() {
    if (harnessScenario === 'multi-task') return pendingExecution
    return { taskId: 'production-harness-task', status: 'created' }
  },
  async retryTask() {
    if (harnessScenario === 'multi-task') return pendingExecution
    return { taskId: 'production-harness-task', status: 'created' }
  },
  async cancelTask() {
    return { status: 'cancelled' }
  },
  async selectReviewMaterialFile({ field_id: fieldId }) {
    const file = materialFiles[fieldId as keyof typeof materialFiles]
    return file ? { status: 'selected', ...file } : { status: 'cancelled' }
  },
  onTaskProgress: () => unsubscribe,
  onTaskCompletionNotificationClicked: () => unsubscribe,
  onReportFeedbackFocusAnchor: () => unsubscribe,
  onReportFeedbackSubmitted: () => unsubscribe,
  onIssueFeedbackSubmitted: () => unsubscribe
}

window.codeReview = harnessApi as CodeReviewApi

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <main className="app-shell production-shell">
      <ProductionReviewWorkbench
        currentUser={{
          id: 'production-harness-user',
          full_name: '王小明·车载电池管理系统软件高级质量与安全责任人',
          department_name: '新能源汽车电子与嵌入式平台研发部'
        }}
        environment={environment}
        isCheckingEnvironment={false}
        isInstallingSkillDuringCheck={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        onRefreshEnvironment={async () => undefined}
        onInstallCodex={async () => undefined}
        onInstallSvn={async () => undefined}
        onInstallSkill={async () => undefined}
        catalogOverride={catalogOverride}
      />
      {harnessScenario === 'svn-binding-dialog' && (
        <SvnBindingDialog
          onSubmit={async () => undefined}
          onSkip={() => undefined}
          isSubmitting={false}
          error=""
        />
      )}
      {harnessScenario === 'update-dialog' && (
        <UpdateDialog
          state="available"
          info={{
            version: '2.0.0',
            releaseNotes: '明亮工作台已覆盖任务、报告、反馈和环境状态。\n本次更新保留原有任务与报告入口。'
          }}
          progress={null}
          error=""
          onDownload={() => undefined}
          onInstall={() => undefined}
          onDismiss={() => undefined}
        />
      )}
    </main>
  </React.StrictMode>
)
