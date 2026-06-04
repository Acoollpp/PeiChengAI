import { expect, test } from "@playwright/test"
import { testApiKey, testSvnPassword } from "./config.ts"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { logInWithKey, logInWithSvn } from "./utils/user"

test.describe("Normal user task navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Normal user sees task management but not department management", async ({
    page,
  }) => {
    const svnUsername = uniqueSvnUsername()
    await createUser({ svnUsername })
    await logInWithSvn(page, svnUsername, testSvnPassword)

    await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
    await expect(
      page.getByRole("link", { name: "部门管理" }),
    ).not.toBeVisible()

    const taskMenu = page.getByRole("button", { name: "任务管理" })
    await expect(taskMenu).toBeVisible()
    await taskMenu.click()
    await page.getByRole("link", { name: "代码审查任务管理" }).click()

    await expect(page).toHaveURL(/\/tasks\/review/)
    await expect(
      page.getByRole("heading", { name: "代码审查任务管理" }),
    ).toBeVisible()
  })
})

test.describe("Admin task navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Admin can use shared task route and old admin route redirects", async ({
    page,
  }) => {
    await logInWithKey(page, testApiKey)

    await page.goto("/admin/tasks/review")
    await expect(page).toHaveURL(/\/tasks\/review/)
    await expect(
      page.getByRole("heading", { name: "代码审查任务管理" }),
    ).toBeVisible()
  })
})
