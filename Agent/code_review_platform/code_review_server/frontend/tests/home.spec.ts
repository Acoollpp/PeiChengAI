import { expect, test } from "@playwright/test"
import { testSvnPassword } from "./config.ts"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { logInWithSvn } from "./utils/user"

test("Home page is renamed and shows task statistics", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
  await expect(page.getByRole("heading", { name: /你好，/ })).toBeVisible()
  await expect(page.getByText("任务统计")).toBeVisible()
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
  await expect(
    taskStats.getByText("环境检查中", { exact: true }),
  ).toBeVisible()
  await expect(taskStats.getByText("运行中", { exact: true })).toBeVisible()
  await expect(
    taskStats.getByText("上传报告中", { exact: true }),
  ).toBeVisible()
  await expect(taskStats.getByText("成功", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("失败", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("环境异常", { exact: true })).toBeVisible()
  await expect(taskStats.getByText("已取消", { exact: true })).toBeVisible()
})

test.describe("Normal user home navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Normal user home does not show department management", async ({
    page,
  }) => {
    const svnUsername = uniqueSvnUsername()
    await createUser({ svnUsername })
    await logInWithSvn(page, svnUsername, testSvnPassword)

    await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
    await expect(
      page.getByRole("link", { name: "部门管理" }),
    ).not.toBeVisible()
    await expect(page.getByText("任务统计")).toBeVisible()
    await expect(page.getByText("报告生成数")).not.toBeVisible()
  })
})
