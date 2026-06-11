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
  await page.goto("/")

  await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
  await expect(page.getByRole("heading", { name: /你好，/ })).toBeVisible()
  await expect(page.getByRole("tab", { name: "任务统计" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "任务统计" })).toBeVisible()
  await expect(page.getByText("总任务数")).toBeVisible()
  await expect(page.getByText("成功数")).toBeVisible()
  await expect(page.getByText("失败/异常数")).toBeVisible()
  await expect(page.getByText("运行中数")).toBeVisible()
  await expect(page.getByText("报告生成数")).toBeVisible()
  await expect(page.getByText("状态分布")).toBeVisible()

  const taskStats = page
    .getByText("状态分布")
    .locator("xpath=ancestor::div[@data-slot='card']")
  await expect(taskStats.getByText("待处理", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("环境检查中", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("运行中", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("上传报告中", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("成功", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("失败", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("环境异常", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("已取消", { exact: true })).toBeVisible()
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
  await expect(cardByText(page, "处理概览").getByText("0分钟")).toBeVisible()
  await expect(page.getByText("提交人排行")).toBeVisible()
  await expect(page.getByText("汪思雨")).toBeVisible()
  expect(requestedRanges).toContain("today")
})

test("Feedback statistics supports today yesterday and all ranges", async ({
  page,
}) => {
  const requestedRanges = await mockFeedbackStats(page, { includeUsers: true })
  await page.goto("/")
  await page.getByRole("tab", { name: "意见统计" }).click()

  await expect(summaryCard(page, "总意见数").getByText("6")).toBeVisible()
  await page.getByRole("button", { name: "昨日" }).click()
  await expect(summaryCard(page, "总意见数").getByText("4")).toBeVisible()
  await page.getByRole("button", { name: "累计" }).click()
  await expect(summaryCard(page, "总意见数").getByText("42")).toBeVisible()

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
    await expect(page.getByText("报告生成数")).not.toBeVisible()
    await page.getByRole("tab", { name: "意见统计" }).click()
    await expect(page.getByText("总意见数")).toBeVisible()
    await expect(page.getByText("提交人排行")).not.toBeVisible()
  })
})
