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
  await expect(page.getByText("状态分布")).toBeVisible()
  await expect(page.getByText("待处理")).toBeVisible()
  await expect(page.getByText("环境检查中")).toBeVisible()
  await expect(page.getByText("运行中")).toBeVisible()
  await expect(page.getByText("上传报告中")).toBeVisible()
  await expect(page.getByText("成功")).toBeVisible()
  await expect(page.getByText("失败")).toBeVisible()
  await expect(page.getByText("环境异常")).toBeVisible()
  await expect(page.getByText("已取消")).toBeVisible()
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
  })
})
