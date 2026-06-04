import { expect, test } from "@playwright/test"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { testSvnPassword } from "./config.ts"
import { logInWithSvn } from "./utils/user"

test("Admin can access items page and sees correct title", async ({ page }) => {
  await page.goto("/items")
  await expect(page.getByRole("heading", { name: "部门管理" })).toBeVisible()
  await expect(page.getByText("创建并管理部门信息")).toBeVisible()
  await expect(page.getByRole("button", { name: "新增部门" })).toBeVisible()
})

test.describe("Items page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Normal user is redirected away from items page", async ({ page }) => {
    const svnUsername = uniqueSvnUsername()
    await createUser({ svnUsername })
    await logInWithSvn(page, svnUsername, testSvnPassword)

    await page.goto("/items")

    await expect(page).toHaveURL("/")
    await expect(
      page.getByRole("heading", { name: /你好，/ }),
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "部门管理" }),
    ).not.toBeVisible()
  })
})
