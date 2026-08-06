import type {
  CreateTaskCommand,
  FeedbackScreenshotView,
  MaterialFileView,
  PreviewCommandResult,
  PreviewScenario,
  ReviewItemDefinition,
  ReviewItemId,
  ReviewReportViewModel,
  ReviewTaskViewModel,
  StageTrackItem,
  TaskStage,
  WorkbenchAdapter,
  WorkbenchViewModel
} from './types'

const catalog: ReviewItemDefinition[] = [
  {
    id: 'DS-01',
    category: '需求与变更',
    name: '变更点审查',
    summary: '核对两个真实 SVN revision 之间的代码变更是否完整承接产品需求。',
    goal: '建立需求、规格与代码变更之间的可追溯证据，识别漏改、错改和影响范围遗漏。',
    process: ['读取产品开发需求表的软件项', '核对产品规格书第五章', '结合双 revision 变更形成结论'],
    specification: '必须提供真实的旧、新 revision；平台仅整理输入，审查证据模式由 Skill 决定。',
    materialFields: [
      {
        id: 'requirement-sheet',
        label: '产品开发需求表',
        description: '包含本次变更软件项的 Excel 文件',
        required: true,
        extensions: ['.xlsx', '.xls'],
        multiplicity: 'single'
      },
      {
        id: 'product-spec',
        label: '产品规格书',
        description: '用于核对需求和第五章内容的 PDF 文件',
        required: true,
        extensions: ['.pdf'],
        multiplicity: 'single'
      }
    ]
  },
  {
    id: 'DS-02',
    category: '代码质量',
    name: '编码规范审核',
    summary: '检查命名、边界处理、资源使用和可维护性等编码规范问题。',
    goal: '以明确的代码证据识别影响可靠性和维护成本的规范偏差。',
    process: ['定位本次审查范围', '按 Skill 内正式规则检查代码', '输出可定位的问题与修改建议'],
    specification: '可由 Skill 根据旧 revision 选择双版本或新版本全量证据模式，无需专项材料。',
    materialFields: []
  },
  {
    id: 'DS-03',
    category: '可靠性',
    name: '状态机审核',
    summary: '检查状态定义、转换条件、异常分支及边界事件处理是否完整。',
    goal: '发现状态无法到达、转换条件冲突、异常路径缺失及事件处理不一致。',
    process: ['识别状态与事件', '核对转换和守卫条件', '检查异常与恢复路径'],
    specification: '固定使用新 revision 全量审查；旧 revision 原样传递，不依赖额外材料。',
    materialFields: []
  }
]

const phaseOrder: Array<Exclude<TaskStage, 'waiting' | 'failed' | 'cancelled'>> = [
  'checking_environment',
  'preparing_workspace',
  'running_review',
  'uploading_report',
  'completed'
]

const phaseLabels: Record<(typeof phaseOrder)[number], string> = {
  checking_environment: '环境检查',
  preparing_workspace: '准备工作区',
  running_review: '执行 Skill',
  uploading_report: '整理报告',
  completed: '完成'
}

const stageLabels: Record<TaskStage, string> = {
  waiting: '本机等待',
  checking_environment: '环境检查',
  preparing_workspace: '准备工作区',
  running_review: '执行审查',
  uploading_report: '整理报告',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

const buildPhaseTrack = (stage: TaskStage): StageTrackItem[] => {
  const currentIndex = phaseOrder.indexOf(stage as (typeof phaseOrder)[number])
  const terminalIndex = stage === 'completed' ? phaseOrder.length - 1 : currentIndex

  return phaseOrder.map((id, index) => ({
    id,
    label: phaseLabels[id],
    state:
      index < terminalIndex
        ? 'complete'
        : index === terminalIndex && currentIndex >= 0
          ? 'current'
          : 'upcoming'
  }))
}

const task = (
  value: Omit<ReviewTaskViewModel, 'stageLabel' | 'phaseTrack'>
): ReviewTaskViewModel => ({
  ...value,
  stageLabel: stageLabels[value.stage],
  phaseTrack: buildPhaseTrack(value.stage)
})

const activeTasks: ReviewTaskViewModel[] = [
  task({
    id: 'CR-240806-017',
    title: '电池包主控状态机变更',
    svnUrl: 'svn://192.168.8.20/bms/platform/trunk/vehicle-control/pack-controller',
    oldRevision: '18420',
    newRevision: '18437',
    reviewItemIds: ['DS-01', 'DS-03'],
    stage: 'running_review',
    message: '正在按审查项执行证据核对，实时输出已收起。',
    updatedAt: '14:26'
  }),
  task({
    id: 'CR-240806-016',
    title: '充电握手异常处理',
    svnUrl: 'svn://192.168.8.20/bms/application/branches/release-candidate/charging-protocol-with-an-intentionally-long-path',
    oldRevision: '9831',
    newRevision: '9845',
    reviewItemIds: ['DS-02'],
    stage: 'preparing_workspace',
    message: '正在校验输入并准备任务专属工作区。',
    updatedAt: '14:21'
  }),
  task({
    id: 'CR-240806-018',
    title: '热管理降额边界复核',
    svnUrl: 'svn://192.168.8.20/bms/platform/trunk/thermal-management',
    oldRevision: '7220',
    newRevision: '7244',
    reviewItemIds: ['DS-01', 'DS-02'],
    stage: 'waiting',
    message: '等待本机执行名额，原始材料路径将保留到任务开始。',
    updatedAt: '14:29',
    queueIndex: 1
  }),
  task({
    id: 'CR-240806-019',
    title: '绝缘检测状态迁移',
    svnUrl: 'svn://192.168.8.20/bms/platform/trunk/diagnostics/isolation-monitor',
    oldRevision: '0',
    newRevision: '4412',
    reviewItemIds: ['DS-03'],
    stage: 'waiting',
    message: '等待本机执行名额。',
    updatedAt: '14:31',
    queueIndex: 2
  }),
  task({
    id: 'CR-240806-020',
    title: '均衡策略编码规范检查',
    svnUrl: 'svn://192.168.8.20/bms/application/trunk/balancing',
    oldRevision: '5310',
    newRevision: '5348',
    reviewItemIds: ['DS-02'],
    stage: 'waiting',
    message: '等待本机执行名额。',
    updatedAt: '14:33',
    queueIndex: 3
  }),
  task({
    id: 'CR-240806-012',
    title: '采样诊断阈值变更',
    svnUrl: 'svn://192.168.8.20/bms/platform/trunk/diagnostics/sample-monitor',
    oldRevision: '6102',
    newRevision: '6119',
    reviewItemIds: ['DS-01'],
    stage: 'failed',
    message: '产品规格书在任务开始前已被移动，请重新选择材料后从头重试。',
    updatedAt: '13:42'
  }),
  task({
    id: 'CR-240806-011',
    title: '唤醒源检查',
    svnUrl: 'svn://192.168.8.20/bms/boot/trunk/wakeup',
    oldRevision: '2201',
    newRevision: '2208',
    reviewItemIds: ['DS-02'],
    stage: 'cancelled',
    message: '任务已由当前用户取消。',
    updatedAt: '13:20'
  }),
  task({
    id: 'CR-240806-009',
    title: '低压上下电状态机复核',
    svnUrl: 'svn://192.168.8.20/bms/platform/trunk/power-mode',
    oldRevision: '0',
    newRevision: '10772',
    reviewItemIds: ['DS-03'],
    stage: 'completed',
    message: '报告已生成，可查看。',
    updatedAt: '12:48'
  })
]

const reportMarkdown = {
  powerMode: `# 低压上下电状态机复核

> 审查范围：\`r0 → r10772\` · 审查项：\`DS-03\`

## 审查结论

本次复核识别出 **4 个问题**，其中 1 个高等级问题会导致故障降级状态无法按预期退出。建议阻断当前版本发布，完成修复并补充状态迁移测试后重新审查。

| 等级 | 数量 | 处置建议 |
| --- | ---: | --- |
| 高 | 1 | 本版本必须修复 |
| 中 | 2 | 合入前完成验证 |
| 低 | 1 | 纳入本迭代整理 |

## 高等级问题：故障恢复后缺少退出事件

**位置**：\`src/power_mode/PowerModeState.c:286\`

从 \`POWER_MODE_DERATE\` 进入恢复分支后，仅清理故障快照，没有向主状态机投递 \`EVT_RECOVERY_DONE\`。状态会停留在降级模式，后续上电请求被守卫条件拒绝。

\`\`\`c
if (fault_snapshot == FAULT_CLEARED) {
    PowerMode_ClearDerateReason();
    /* 缺少状态迁移事件 */
}
\`\`\`

### 建议

1. 清理降级原因后投递恢复完成事件。
2. 增加“故障清除 → 恢复 → 再次上电”的往返路径测试。
3. 核对休眠唤醒路径是否复用同一故障快照。

## 证据范围

- 状态定义与转换表
- 故障快照读取和清理路径
- 休眠、唤醒、降级与恢复的相邻状态
`,
  soc: `# SOC 滤波边界复查

> 审查范围：\`r8920 → r8934\` · 审查项：\`DS-01\`、\`DS-02\`

## 审查结论

需求项、规格约束与代码变更范围能够对应，**未发现需要报告的问题**。滤波窗口上下限均有显式保护，异常采样不会写入历史窗口。

## 核对摘要

| 核对项 | 结果 | 证据 |
| --- | --- | --- |
| 需求软件项 | 通过 | 3 项变更均可定位到提交 |
| 规格边界 | 通过 | 第五章 5.4.2 与实现一致 |
| 异常采样 | 通过 | 无效值在入队前被拒绝 |

## 残余建议

- 保留极端温度下的回归用例。
- 下次调整窗口长度时同步检查定点数溢出边界。
`,
  timer: `# 故障恢复计时器审查

> 审查范围：\`r17603 → r17628\` · 审查项：\`DS-02\`、\`DS-03\`

## 审查结论

发现 **2 个中等级问题**，涉及计时器复位时机和异常状态的重复进入保护。

## 问题清单

1. \`FaultRecoveryTimer_Reset\` 在状态退出前调用，下一周期仍可能读取旧的超时标记。
2. 重复进入恢复状态时未检查计时器是否已经启动，可能覆盖首次启动时间。

## 建议验证

- 连续两次触发同一故障恢复事件。
- 在计时器临界周期同步触发状态退出。
- 验证恢复完成后所有诊断标志都已清零。
`
}

const reports: ReviewReportViewModel[] = [
  {
    id: 'report-009',
    taskId: 'CR-240806-009',
    title: '低压上下电状态机复核',
    svnUrl: 'svn://192.168.8.20/bms/platform/trunk/power-mode',
    revisionRange: 'r0 → r10772',
    reviewItemIds: ['DS-03'],
    completedAt: '今天 12:48',
    issueCount: 4,
    highestSeverity: 'high',
    summary: '发现 1 项状态退出条件缺失和 3 项异常事件覆盖问题，均已定位到源码文件与状态转换。',
    markdown: reportMarkdown.powerMode
  },
  {
    id: 'report-007',
    taskId: 'CR-240806-007',
    title: 'SOC 滤波边界复查',
    svnUrl: 'svn://192.168.8.20/bms/algorithm/trunk/soc-estimation',
    revisionRange: 'r8920 → r8934',
    reviewItemIds: ['DS-01', 'DS-02'],
    completedAt: '今天 11:06',
    issueCount: 0,
    highestSeverity: 'none',
    summary: '未发现需要报告的问题；需求项、规格约束与代码变更范围能够对应。',
    markdown: reportMarkdown.soc
  },
  {
    id: 'report-004',
    taskId: 'CR-240805-031',
    title: '故障恢复计时器审查',
    svnUrl: 'svn://192.168.8.20/bms/platform/branches/customer-a/diagnostics/fault-recovery-timer',
    revisionRange: 'r17603 → r17628',
    reviewItemIds: ['DS-02', 'DS-03'],
    completedAt: '昨天 18:32',
    issueCount: 2,
    highestSeverity: 'medium',
    summary: '发现 2 项中等级问题，涉及计时器复位时机和异常状态的重复进入保护。',
    markdown: reportMarkdown.timer
  }
]

const fixtureFiles: Record<string, MaterialFileView[]> = {
  'DS-01:requirement-sheet': [
    {
      id: 'file-requirement-long',
      name: 'BMS_平台_V2.7_低压上下电与故障恢复产品开发需求表_最终评审修订版_20260806.xlsx',
      sizeLabel: '1.8 MB'
    },
    {
      id: 'file-requirement-replacement',
      name: 'BMS_平台_V2.7_低压上下电产品开发需求表_二次评审修订版_20260806.xlsx',
      sizeLabel: '1.9 MB'
    }
  ],
  'DS-01:product-spec': [
    {
      id: 'file-spec-long',
      name: 'PCH-BMS-SPEC-2026-08_整车控制器产品规格书_第五章_状态机及故障处理正式发布版.pdf',
      sizeLabel: '8.6 MB'
    },
    {
      id: 'file-spec-replacement',
      name: 'PCH-BMS-SPEC-2026-08_整车控制器产品规格书_第五章_二次会签发布版.pdf',
      sizeLabel: '8.8 MB'
    }
  ]
}

const feedbackScreenshots: FeedbackScreenshotView[] = [
  { id: 'feedback-screen-1', name: '任务阶段停留在环境检查.png', sizeLabel: '684 KB' },
  { id: 'feedback-screen-2', name: '报告列表未刷新.webp', sizeLabel: '1.2 MB' },
  { id: 'feedback-screen-3', name: '长路径显示问题.jpg', sizeLabel: '932 KB' },
  { id: 'feedback-screen-4', name: '任务等待序号异常.png', sizeLabel: '756 KB' },
  { id: 'feedback-screen-5', name: '报告预览滚动位置.webp', sizeLabel: '1.5 MB' }
]

const clone = <T,>(value: T): T => structuredClone(value)

const makeState = (scenario: PreviewScenario): WorkbenchViewModel => ({
  productName: 'AI 代码审查',
  previewLabel: '2.0 交互预览',
  userName: '陈工',
  departmentName: 'BMS 软件部',
  scenarios: [
    { id: 'active', label: '完整状态' },
    { id: 'empty', label: '空数据' }
  ],
  activeScenario: scenario,
  catalog: clone(catalog),
  sampleTask: {
    svnUrl: 'svn://192.168.8.20/bms/platform/trunk/vehicle-control/pack-controller-with-a-long-validation-path',
    oldRevision: '18420',
    newRevision: '18437',
    selection: {
      'DS-01': {
        itemId: 'DS-01',
        extraRules: '重点检查低压上下电、故障恢复与充电状态交叉切换时，所有守卫条件是否使用同一组故障快照，并核对跨模块回调的清理时机。',
        materials: {
          'requirement-sheet': [clone(fixtureFiles['DS-01:requirement-sheet'][0])],
          'product-spec': [clone(fixtureFiles['DS-01:product-spec'][0])]
        }
      },
      'DS-03': {
        itemId: 'DS-03',
        extraRules: '覆盖休眠唤醒、故障降级和恢复三个相邻状态的往返路径。',
        materials: {}
      }
    }
  },
  tasks: scenario === 'active' ? clone(activeTasks) : [],
  reports: scenario === 'active' ? clone(reports) : []
})

const nextStage: Partial<Record<TaskStage, TaskStage>> = {
  checking_environment: 'preparing_workspace',
  preparing_workspace: 'running_review',
  running_review: 'uploading_report',
  uploading_report: 'completed'
}

export const createFixtureWorkbenchAdapter = (): WorkbenchAdapter => {
  let state = makeState('active')
  const listeners = new Set<(viewModel: WorkbenchViewModel) => void>()

  const publish = (): void => {
    const snapshot = clone(state)
    listeners.forEach((listener) => listener(snapshot))
  }

  const updateTask = (taskId: string, update: (value: ReviewTaskViewModel) => ReviewTaskViewModel) => {
    state.tasks = state.tasks.map((value) => (value.id === taskId ? update(value) : value))
  }

  const result = (message: string): PreviewCommandResult => {
    state.notice = message
    publish()
    return { message }
  }

  const normalizeWaitingQueueIndexes = (): void => {
    let position = 1
    state.tasks = state.tasks.map((value) =>
      value.stage === 'waiting' ? { ...value, queueIndex: position++ } : value
    )
  }

  const startWaitingTaskWhenPossible = (): void => {
    normalizeWaitingQueueIndexes()
    let runningCount = state.tasks.filter((value) =>
      ['checking_environment', 'preparing_workspace', 'running_review', 'uploading_report'].includes(
        value.stage
      )
    ).length
    while (runningCount < 2) {
      const waiting = state.tasks
        .filter((value) => value.stage === 'waiting')
        .sort((a, b) => (a.queueIndex ?? 0) - (b.queueIndex ?? 0))[0]
      if (!waiting) return

      updateTask(waiting.id, (value) =>
        task({
          ...value,
          stage: 'checking_environment',
          message: '已获得本机执行名额，正在检查本地环境。',
          updatedAt: '刚刚',
          queueIndex: undefined
        })
      )
      runningCount += 1
      normalizeWaitingQueueIndexes()
    }
  }

  return {
    getViewModel: () => clone(state),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    commands: {
      async setScenario(scenario) {
        state = makeState(scenario)
        return result(scenario === 'active' ? '已切换到完整状态场景。' : '已切换到空数据场景。')
      },
      async createTask(input: CreateTaskCommand) {
        const sequence = state.tasks.length + 21
        const selectedIds = Object.keys(input.selection) as ReviewItemId[]
        const created = task({
          id: `CR-240806-${String(sequence).padStart(3, '0')}`,
          title: `${selectedIds.join(' / ')} 新建审查任务`,
          svnUrl: input.svnUrl,
          oldRevision: input.oldRevision,
          newRevision: input.newRevision,
          reviewItemIds: selectedIds,
          stage: 'waiting',
          message: '任务已加入本机等待列表，材料路径已保留。',
          updatedAt: '刚刚',
          queueIndex: state.tasks.filter((value) => value.stage === 'waiting').length + 1
        })
        state.activeScenario = 'active'
        state.tasks = [created, ...state.tasks]
        startWaitingTaskWhenPossible()
        return result(`已创建预览任务 ${created.id}。`)
      },
      async cancelTask(taskId) {
        updateTask(taskId, (value) =>
          task({
            ...value,
            stage: 'cancelled',
            message: '任务已在预览中取消。',
            queueIndex: undefined,
            updatedAt: '刚刚'
          })
        )
        startWaitingTaskWhenPossible()
        return result(`已取消任务 ${taskId}。`)
      },
      async retryTask(taskId) {
        updateTask(taskId, (value) =>
          task({
            ...value,
            stage: 'waiting',
            message: '任务将从头重试，已进入本机等待列表。',
            queueIndex: state.tasks.filter((taskValue) => taskValue.stage === 'waiting').length + 1,
            updatedAt: '刚刚'
          })
        )
        startWaitingTaskWhenPossible()
        return result(`任务 ${taskId} 已从头重试。`)
      },
      async advanceTasks() {
        const newlyCompleted: ReviewTaskViewModel[] = []
        state.tasks = state.tasks.map((value) => {
          const advancedStage = nextStage[value.stage]
          if (!advancedStage) return value
          const advancedTask = task({
            ...value,
            stage: advancedStage,
            message:
              advancedStage === 'completed'
                ? '任务已完成，报告已生成。'
                : `任务阶段已推进到${stageLabels[advancedStage]}。`,
            updatedAt: '刚刚'
          })
          if (advancedStage === 'completed') newlyCompleted.push(advancedTask)
          return advancedTask
        })
        newlyCompleted.forEach((completedTask) => {
          if (state.reports.some((report) => report.taskId === completedTask.id)) return
          state.reports = [
            {
              id: `report-${completedTask.id}`,
              taskId: completedTask.id,
              title: completedTask.title,
              svnUrl: completedTask.svnUrl,
              revisionRange: `r${completedTask.oldRevision} → r${completedTask.newRevision}`,
              reviewItemIds: completedTask.reviewItemIds,
              completedAt: '刚刚',
              issueCount: 1,
              highestSeverity: 'medium',
              summary: '任务阶段推进已完成，生成 1 项用于验证报告查看交互的示例问题。',
              markdown: `# ${completedTask.title}\n\n> 审查范围：\`r${completedTask.oldRevision} → r${completedTask.newRevision}\`\n\n## 审查结论\n\n任务阶段推进已完成，生成 **1 个中等级示例问题**，用于验证报告中心的 Markdown 展示与后续 PDF 逻辑绑定。\n\n## 建议\n\n- 核对对应源码位置。\n- 修复后重新执行本地审查。\n`
            },
            ...state.reports
          ]
        })
        startWaitingTaskWhenPossible()
        return result('已推进一轮本地任务阶段。')
      },
      async openReport(reportId) {
        state.selectedReportId = reportId
        return result('已在报告中心选择该报告。')
      },
      async closeReport() {
        state.selectedReportId = undefined
        return result('已清除报告选择。')
      },
      async viewPdfReport(reportId) {
        const report = state.reports.find((value) => value.id === reportId)
        return result(
          report
            ? `已打开《${report.title}》PDF 报告。`
            : '未找到可查看的 PDF 报告。'
        )
      },
      async chooseFeedbackScreenshot(currentScreenshotIds = []) {
        const screenshot = feedbackScreenshots.find(
          (value) => !currentScreenshotIds.includes(value.id)
        )
        if (!screenshot) {
          throw new Error('没有更多可用截图。')
        }
        return clone(screenshot)
      },
      async submitFeedback(input) {
        const description = input.description.trim()
        if (!description) return result('请填写问题描述。')
        return result(`意见已提交，包含 ${input.screenshots.length} 张截图。`)
      },
      async chooseMaterial(itemId, fieldId, currentFileIds = []) {
        const values = fixtureFiles[`${itemId}:${fieldId}`]
        const value = values?.find((candidate) => !currentFileIds.includes(candidate.id)) ?? values?.[0]
        if (!value) {
          throw new Error('该审查项无需选择专项材料。')
        }
        return clone(value)
      },
      async dismissNotice() {
        state.notice = undefined
        publish()
      }
    }
  }
}
