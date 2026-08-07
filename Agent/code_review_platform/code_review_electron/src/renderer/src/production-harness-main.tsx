import React from 'react'
import ReactDOM from 'react-dom/client'

import type { CodeReviewApi } from './code-review-api'
import {
  PRODUCTION_REVIEW_ITEM_CATALOG,
  ProductionReviewWorkbench
} from './workbench-preview/ProductionReviewWorkbench'
import './workbench-preview/workbench-preview.css'

const unsubscribe = (): void => undefined
const longReviewItemName = '状态机审核与故障恢复及跨模式安全降级边界条件完整性联合审查（超长名称视觉压力样例）'
const longNameStressCatalog = PRODUCTION_REVIEW_ITEM_CATALOG.map((item) =>
  item.id === 'DS-03' ? { ...item, name: longReviewItemName } : item
)
const catalogOverride = new URLSearchParams(window.location.search).get('catalog') === 'long-review-item-name'
  ? longNameStressCatalog
  : undefined
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
    return { data: [], count: 0 }
  },
  async readTaskReport() {
    return ''
  },
  async preflightTask() {
    return { status: 'valid' }
  },
  async executeTask() {
    return { taskId: 'production-harness-task', status: 'created' }
  },
  async retryTask() {
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
    <ProductionReviewWorkbench
      currentUser={{
        id: 'production-harness-user',
        full_name: '王小明·车载电池管理系统软件高级质量与安全责任人',
        department_name: '新能源汽车电子与嵌入式平台研发部'
      }}
      environment={{ status: 'ready' }}
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
  </React.StrictMode>
)
