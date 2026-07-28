import { expect, type Page, test } from "@playwright/test"
import { testSvnPassword } from "./config.ts"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { logInWithSvn } from "./utils/user"

const feedbackStatsByRange = {
  today: {
    range: "today",
    total: 6,
    pending: 2,
    processing: 1,
    resolved: 3,
    unresolved: 3,
    resolution_rate: 0.5,
    average_resolution_seconds: 0,
    by_status: {
      pending: 2,
      processing: 1,
      resolved: 3,
    },
    trend: [
      { label: "09:00", count: 1 },
      { label: "10:00", count: 2 },
      { label: "11:00", count: 3 },
    ],
    feedback_by_user: [
      {
        user_name: "汪思雨",
        svn_username: "wangsiyu",
        feedback_count: 3,
      },
      {
        user_name: "朱正寒",
        svn_username: "zhuzhenghan",
        feedback_count: 2,
      },
    ],
  },
  yesterday: {
    range: "yesterday",
    total: 4,
    pending: 1,
    processing: 1,
    resolved: 2,
    unresolved: 2,
    resolution_rate: 0.5,
    average_resolution_seconds: 7200,
    by_status: {
      pending: 1,
      processing: 1,
      resolved: 2,
    },
    trend: [{ label: "14:00", count: 4 }],
    feedback_by_user: [],
  },
  all: {
    range: "all",
    total: 42,
    pending: 9,
    processing: 6,
    resolved: 27,
    unresolved: 15,
    resolution_rate: 0.6428571428571429,
    average_resolution_seconds: 207360,
    by_status: {
      pending: 9,
      processing: 6,
      resolved: 27,
    },
    trend: [{ label: "2026-06-11", count: 42 }],
    feedback_by_user: [],
  },
}

const taskStatsByRange = {
  this_week: {
    range: "this_week",
    total: 18,
    success: 12,
    running: 2,
    failed_or_error: 4,
    average_duration_seconds: 10800,
    by_status: {
      created: 0,
      checking_environment: 1,
      running_codex: 1,
      uploading_report: 0,
      success: 12,
      failed: 3,
      environment_error: 1,
      cancelled: 0,
    },
    reports_by_user: [
      {
        user_name: "汪思雨",
        svn_username: "wangsiyu",
        report_count: 9,
      },
      {
        user_name: "朱正寒",
        svn_username: "zhuzhenghan",
        report_count: 3,
      },
    ],
    trend: [
      { label: "2026-06-29", count: 8 },
      { label: "2026-06-30", count: 10 },
    ],
  },
  last_week: {
    range: "last_week",
    total: 16,
    success: 14,
    running: 0,
    failed_or_error: 2,
    average_duration_seconds: 14400,
    by_status: {
      created: 0,
      checking_environment: 0,
      running_codex: 0,
      uploading_report: 0,
      success: 14,
      failed: 2,
      environment_error: 0,
      cancelled: 0,
    },
    reports_by_user: [],
    trend: [{ label: "2026-06-22", count: 16 }],
  },
  today: {
    range: "today",
    total: 8,
    success: 5,
    running: 1,
    failed_or_error: 2,
    average_duration_seconds: 5400,
    by_status: {
      created: 0,
      checking_environment: 0,
      running_codex: 1,
      uploading_report: 0,
      success: 5,
      failed: 2,
      environment_error: 0,
      cancelled: 0,
    },
    reports_by_user: [
      {
        user_name: "汪思雨",
        svn_username: "wangsiyu",
        report_count: 5,
      },
    ],
    trend: [
      { label: "2026-06-13", count: 3 },
      { label: "2026-06-14", count: 5 },
    ],
  },
  yesterday: {
    range: "yesterday",
    total: 4,
    success: 3,
    running: 0,
    failed_or_error: 1,
    average_duration_seconds: 7200,
    by_status: {
      created: 0,
      checking_environment: 0,
      running_codex: 0,
      uploading_report: 0,
      success: 3,
      failed: 1,
      environment_error: 0,
      cancelled: 0,
    },
    reports_by_user: [],
    trend: [{ label: "2026-06-12", count: 4 }],
  },
  all: {
    range: "all",
    total: 200,
    success: 164,
    running: 4,
    failed_or_error: 32,
    average_duration_seconds: 90000,
    by_status: {
      created: 0,
      checking_environment: 0,
      running_codex: 4,
      uploading_report: 0,
      success: 164,
      failed: 30,
      environment_error: 0,
      cancelled: 2,
    },
    reports_by_user: [],
    trend: [
      { label: "2026-06-10", count: 12 },
      { label: "2026-06-11", count: 38 },
      { label: "2026-06-12", count: 42 },
    ],
  },
}

const weeklyInsights = {
  period_start: "2026-07-20",
  period_end: "2026-07-26",
  generated_at: "2026-07-27T09:00:00Z",
  scope_label: "全部部门",
  taxonomy_version: "fixed-audit-taxonomy-v1",
  success_tasks: 24,
  helpful: 12,
  not_helpful: 4,
  no_feedback: 8,
  feedback_coverage_rate: 2 / 3,
  explicit_useful_rate: 0.75,
  valid_useful_tasks: 10,
  cleaning_tasks: 2,
  valid_issue_count: 21,
  risk_counts: {
    high: 5,
    medium: 8,
    low: 4,
    recommendation: 2,
    unspecified: 2,
  },
  attention_points: [
    "上周完成 24 个成功任务，反馈覆盖率 66.7%；仍有 8 个任务未反馈。",
    "已反馈任务中 12 个被确认有帮助，明确有用率 75.0%；没帮助任务 4 个。",
    "10 个任务包含可分析描述，共归类 21 条有效信息，其中高风险 5 条。",
    "有用信息主要集中在：保护策略审核 5 条、通讯协议内容审核 4 条、变更点审核 3 条。",
  ],
  daily: [
    {
      date: "2026-07-20",
      success: 3,
      helpful: 2,
      not_helpful: 0,
      no_feedback: 1,
    },
    {
      date: "2026-07-21",
      success: 5,
      helpful: 3,
      not_helpful: 1,
      no_feedback: 1,
    },
    {
      date: "2026-07-22",
      success: 4,
      helpful: 2,
      not_helpful: 1,
      no_feedback: 1,
    },
    {
      date: "2026-07-23",
      success: 6,
      helpful: 3,
      not_helpful: 1,
      no_feedback: 2,
    },
    {
      date: "2026-07-24",
      success: 4,
      helpful: 2,
      not_helpful: 1,
      no_feedback: 1,
    },
    {
      date: "2026-07-25",
      success: 1,
      helpful: 0,
      not_helpful: 0,
      no_feedback: 1,
    },
    {
      date: "2026-07-26",
      success: 1,
      helpful: 0,
      not_helpful: 0,
      no_feedback: 1,
    },
  ],
  categories: [
    ["日常提交审核", "变更点审核", 3, 1],
    ["日常提交审核", "编码规范审核", 1, 0],
    ["日常提交审核", "基础逻辑审核", 1, 0],
    ["日常提交审核", "测试补充审核", 1, 0],
    ["日常提交审核", "自检项检查", 0, 0],
    ["品质风险审核", "客诉高频问题", 1, 1],
    ["重点项目发布审核", "全规则审核", 0, 0],
    ["协议专项审核", "通讯协议内容审核", 4, 1],
    ["协议专项审核", "异常通信审核", 1, 0],
    ["协议专项审核", "超时重发审核", 1, 1],
    ["协议专项审核", "缓冲区大小检查", 0, 0],
    ["驱动专项审核", "MCU驱动审核", 0, 0],
    ["驱动专项审核", "AFE驱动审核", 0, 0],
    ["驱动专项审核", "Flash操作审核", 1, 0],
    ["控制逻辑专项审核", "状态机审核", 1, 0],
    ["控制逻辑专项审核", "保护策略审核", 5, 1],
    ["控制逻辑专项审核", "控制闭环审核", 1, 0],
    ["控制逻辑专项审核", "故障恢复审核", 0, 0],
  ].map(([category, subcategory, usefulCount, highRiskCount]) => ({
    category,
    subcategory,
    useful_count: usefulCount,
    high_risk_count: highRiskCount,
    medium_risk_count: 0,
    low_risk_count: 0,
  })),
  departments: [
    {
      department_name: "软件一部",
      success: 14,
      helpful: 8,
      not_helpful: 2,
      no_feedback: 4,
    },
    {
      department_name: "软件二部",
      success: 10,
      helpful: 4,
      not_helpful: 2,
      no_feedback: 4,
    },
  ],
  representative_issues: [
    {
      task_id: "00000000-0000-0000-0000-000000000001",
      task_date: "2026-07-23",
      department_name: "软件一部",
      description: "高风险：过流保护恢复条件会导致保护提前退出。",
      category: "控制逻辑专项审核",
      subcategory: "保护策略审核",
      risk_level: "high",
    },
  ],
}

async function mockFeedbackStats(
  page: Page,
  options?: { includeUsers?: boolean },
) {
  const requestedRanges: string[] = []
  await page.route("**/api/v1/feedback/stats?**", async (route) => {
    const url = new URL(route.request().url())
    const range = url.searchParams.get("range") || "today"
    requestedRanges.push(range)
    const stats =
      feedbackStatsByRange[range as keyof typeof feedbackStatsByRange] ??
      feedbackStatsByRange.today
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...stats,
        feedback_by_user: options?.includeUsers ? stats.feedback_by_user : [],
      },
    })
  })
  return requestedRanges
}

async function mockTaskStats(page: Page, options?: { includeUsers?: boolean }) {
  const requestedRanges: string[] = []
  await page.route("**/api/v1/review-tasks/stats?**", async (route) => {
    const url = new URL(route.request().url())
    const range = url.searchParams.get("range") || "today"
    requestedRanges.push(range)
    const stats =
      taskStatsByRange[range as keyof typeof taskStatsByRange] ??
      taskStatsByRange.today
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...stats,
        reports_by_user: options?.includeUsers ? stats.reports_by_user : [],
      },
    })
  })
  return requestedRanges
}

async function mockWeeklyInsights(page: Page) {
  await page.route("**/api/v1/review-tasks/weekly-insights", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: weeklyInsights,
    })
  })
}

async function mockRepresentativeTaskDetail(page: Page) {
  const taskId = "00000000-0000-0000-0000-000000000001"
  await page.route(`**/api/v1/review-tasks/${taskId}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        id: taskId,
        user_id: "11111111-1111-1111-1111-111111111111",
        user_name: "张三",
        svn_username: "zhangsan",
        svn_url: "svn://example.com/firmware/trunk",
        old_revision: "r100",
        new_revision: "r120",
        department_name: "软件一部",
        status: "success",
        report_path: "/reports/task.md",
        report_name: "代码审查报告.md",
        pdf_report_path: "/reports/task.pdf",
        pdf_report_name: "代码审查报告.pdf",
        report_feedback_helpful: true,
        report_feedback_useful_issues_text:
          "1. 高风险：过流保护恢复条件会导致保护提前退出。\n2. 中风险：保护恢复计数缺少边界检查。",
        created_at: "2026-07-23T03:20:00Z",
      },
    })
  })
  await page.route(
    `**/api/v1/review-tasks/${taskId}/download`,
    async (route) => {
      await route.fulfill({
        body: "# 代码审查报告\n",
        contentType: "text/markdown",
      })
    },
  )
  await page.route(
    `**/api/v1/review-tasks/${taskId}/pdf/download`,
    async (route) => {
      await route.fulfill({
        body: "%PDF-1.4\n",
        contentType: "application/pdf",
      })
    },
  )
}

function cardByText(page: Page, text: string) {
  return page.getByText(text).locator("xpath=ancestor::div[@data-slot='card']")
}

function summaryCard(page: Page, label: string) {
  return page.locator("[data-slot='card']").filter({
    hasText: label,
    hasNot: page.locator("[data-slot='card-header']"),
  })
}

test("Home page is renamed and shows task statistics", async ({ page }) => {
  await mockTaskStats(page, { includeUsers: true })
  await page.goto("/")

  await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
  await expect(page.getByRole("heading", { name: /你好，/ })).toBeVisible()
  await expect(page.getByRole("tab", { name: "任务统计" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "周报统计" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "任务统计" })).toBeVisible()
  await expect(page.getByText("总任务数")).toBeVisible()
  await expect(page.getByText("成功数")).toBeVisible()
  await expect(page.getByText("失败/异常数")).toBeVisible()
  await expect(page.getByText("平均运行时间")).toBeVisible()
  await expect(page.getByText("运行中数")).not.toBeVisible()
  await expect(summaryCard(page, "总任务数").getByText("200")).toBeVisible()
  await expect(summaryCard(page, "平均运行时间").getByText("1天")).toBeVisible()
  await expect(page.getByText("报告生成数")).toBeVisible()
  await expect(page.getByText("提交趋势")).toBeVisible()
  await expect(page.getByText("按日期统计任务提交数量。")).toBeVisible()
  await expect(page.getByText("2026-06-12")).toBeVisible()
  await expect(page.getByText("状态分布")).not.toBeVisible()
})

test("Task statistics supports today yesterday and all ranges", async ({
  page,
}) => {
  const requestedRanges = await mockTaskStats(page, { includeUsers: true })
  await page.goto("/")

  await expect(page.getByRole("button", { name: "累计" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(summaryCard(page, "总任务数").getByText("200")).toBeVisible()
  await expect(summaryCard(page, "平均运行时间").getByText("1天")).toBeVisible()
  await page.getByRole("button", { name: "今日" }).click()
  await expect(page.getByRole("button", { name: "今日" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(summaryCard(page, "总任务数").getByText("8")).toBeVisible()
  await expect(
    summaryCard(page, "平均运行时间").getByText("2小时"),
  ).toBeVisible()
  await expect(page.getByText("状态分布")).not.toBeVisible()
  await expect(page.getByText("成功报告排行榜")).toBeVisible()
  const successReportRanking = cardByText(page, "成功报告排行榜")
  await expect(successReportRanking.getByText("汪思雨")).toBeVisible()
  await expect(successReportRanking.getByText("5份")).toBeVisible()
  await page.getByRole("button", { name: "昨日" }).click()
  await expect(page.getByRole("button", { name: "昨日" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(summaryCard(page, "总任务数").getByText("4")).toBeVisible()
  await expect(
    summaryCard(page, "平均运行时间").getByText("2小时"),
  ).toBeVisible()
  await page.getByRole("button", { name: "本周" }).click()
  await expect(page.getByRole("button", { name: "本周" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(summaryCard(page, "总任务数").getByText("18")).toBeVisible()
  await expect(page.getByLabel("汪思雨报告柱")).toBeVisible()
  await expect(page.getByLabel("汪思雨报告占比")).not.toBeVisible()
  await expect(page.getByText("9份报告")).toBeVisible()
  await expect(successReportRanking.getByText("朱正寒")).toBeVisible()
  await expect(successReportRanking.getByText("3份")).toBeVisible()
  await page.getByRole("button", { name: "上周" }).click()
  await expect(page.getByRole("button", { name: "上周" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(summaryCard(page, "总任务数").getByText("16")).toBeVisible()

  expect(requestedRanges).toContain("this_week")
  expect(requestedRanges).toContain("last_week")
  expect(requestedRanges).toContain("today")
  expect(requestedRanges).toContain("yesterday")
  expect(requestedRanges).toContain("all")
})

test("Home page can switch to feedback statistics", async ({ page }) => {
  const requestedRanges = await mockFeedbackStats(page, { includeUsers: true })
  await page.goto("/")

  await expect(page.getByRole("tab", { name: "任务统计" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "意见统计" })).toBeVisible()
  await expect(page.getByText("总任务数")).toBeVisible()

  await page.getByRole("tab", { name: "意见统计" }).click()
  await expect(page.getByRole("heading", { name: "意见统计" })).toBeVisible()
  await expect(
    page.getByText("当前权限范围内的意见反馈处理情况。"),
  ).toBeVisible()
  await expect(page.getByText("总意见数")).toBeVisible()
  await expect(summaryCard(page, "待处理")).toBeVisible()
  await expect(summaryCard(page, "处理中")).toBeVisible()
  await expect(summaryCard(page, "已解决")).toBeVisible()
  await expect(page.getByText("状态分布")).toBeVisible()
  await expect(page.getByText("提交趋势")).toBeVisible()
  await expect(page.getByText("处理概览")).toBeVisible()
  await expect(cardByText(page, "处理概览").getByText("2天")).toBeVisible()
  await expect(page.getByText("提交人排行")).toBeVisible()
  await expect(page.getByText("汪思雨")).not.toBeVisible()
  expect(requestedRanges).toContain("all")
})

test("Home page can switch to weekly insights with fixed categories", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-token")
  })
  await page.route("**/api/v1/users/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        id: "22222222-2222-2222-2222-222222222222",
        full_name: "周报管理员",
        svn_username: "weekly-admin",
        role: "admin",
        is_active: true,
        is_superuser: true,
      },
    })
  })
  await mockTaskStats(page)
  await mockFeedbackStats(page)
  await mockWeeklyInsights(page)
  await mockRepresentativeTaskDetail(page)
  await page.goto("/")

  await page.getByRole("tab", { name: "周报统计" }).click()

  await expect(page.getByRole("heading", { name: "周报统计" })).toBeVisible()
  await expect(page.getByText("07-20 至 07-26")).toBeVisible()
  await expect(summaryCard(page, "成功任务").getByText("24")).toBeVisible()
  await expect(summaryCard(page, "有帮助").getByText("12")).toBeVisible()
  await expect(summaryCard(page, "没帮助").getByText("4")).toBeVisible()
  await expect(summaryCard(page, "未反馈").getByText("8")).toBeVisible()
  await expect(
    page.getByRole("img", {
      name: "上一周成功任务反馈饼图：有帮助 12，没帮助 4，未反馈 8",
    }),
  ).toBeVisible()
  await expect(page.getByText("固定分类 TOP 5")).toBeVisible()
  await expect(
    page.getByText("6 个大类、18 个小类固定展示，便于跨周对比。"),
  ).toBeVisible()
  await expect(page.getByText("保护策略审核").first()).toBeVisible()
  await expect(page.getByTitle("客诉高频问题")).toBeVisible()
  await expect(page.getByTitle("全规则审核")).toBeVisible()
  await expect(page.getByTitle("通讯协议内容审核")).toBeVisible()
  await expect(page.getByTitle("MCU驱动审核")).toBeVisible()
  await expect(page.getByTitle("故障恢复审核")).toBeVisible()
  await expect(
    page.getByText("过流保护恢复条件会导致保护提前退出", { exact: false }),
  ).toBeVisible()

  await page.getByRole("button", { name: "查看任务详情" }).click()
  await expect(page.getByRole("heading", { name: "任务详情" })).toBeVisible()
  await expect(page.getByText("张三")).toBeVisible()
  await expect(page.getByText("zhangsan")).toBeVisible()
  await expect(
    page.getByText("中风险：保护恢复计数缺少边界检查。", { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "下载 Markdown" }),
  ).toBeEnabled()
  await expect(page.getByRole("button", { name: "下载 PDF" })).toBeEnabled()

  const markdownDownloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "下载 Markdown" }).click()
  const markdownDownload = await markdownDownloadPromise
  expect(markdownDownload.suggestedFilename()).toBe("代码审查报告.md")

  const pdfDownloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "下载 PDF" }).click()
  const pdfDownload = await pdfDownloadPromise
  expect(pdfDownload.suggestedFilename()).toBe("代码审查报告.pdf")

  await page.getByRole("button", { name: "Close" }).click()

  await page.getByRole("tab", { name: "任务统计" }).click()
  await expect(page.getByRole("heading", { name: "任务统计" })).toBeVisible()
  await page.getByRole("tab", { name: "意见统计" }).click()
  await expect(page.getByRole("heading", { name: "意见统计" })).toBeVisible()
})

test("Feedback statistics supports today yesterday and all ranges", async ({
  page,
}) => {
  const requestedRanges = await mockFeedbackStats(page, { includeUsers: true })
  await page.goto("/")
  await page.getByRole("tab", { name: "意见统计" }).click()

  await expect(page.getByRole("button", { name: "累计" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(summaryCard(page, "总意见数").getByText("42")).toBeVisible()
  await page.getByRole("button", { name: "今日" }).click()
  await expect(page.getByRole("button", { name: "今日" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(summaryCard(page, "总意见数").getByText("6")).toBeVisible()
  await page.getByRole("button", { name: "昨日" }).click()
  await expect(page.getByRole("button", { name: "昨日" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(summaryCard(page, "总意见数").getByText("4")).toBeVisible()

  expect(requestedRanges).toContain("today")
  expect(requestedRanges).toContain("yesterday")
  expect(requestedRanges).toContain("all")
})

test.describe("Normal user home navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Normal user home does not show department management", async ({
    page,
  }) => {
    await mockFeedbackStats(page, { includeUsers: true })
    const svnUsername = uniqueSvnUsername()
    await createUser({ svnUsername })
    await logInWithSvn(page, svnUsername, testSvnPassword)

    await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
    await expect(page.getByRole("link", { name: "部门管理" })).not.toBeVisible()
    await expect(page.getByRole("tab", { name: "任务统计" })).toBeVisible()
    await expect(page.getByText("平均运行时间")).toBeVisible()
    await expect(page.getByText("报告生成数")).not.toBeVisible()
    await page.getByRole("tab", { name: "意见统计" }).click()
    await expect(page.getByText("总意见数")).toBeVisible()
    await expect(page.getByText("提交人排行")).not.toBeVisible()
  })
})
