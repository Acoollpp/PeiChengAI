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
