import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })

const expectLegacyLoginEntrypointsRemoved = async (page: Page) => {
  await expect(page.locator('a[href="/recover-password"]')).toHaveCount(0)
  await expect(page.locator('a[href="/signup"]')).toHaveCount(0)
  await expect(page.locator('input[name="username"]')).toHaveCount(0)
  await expect(page.getByTestId("email-input")).toHaveCount(0)
}

test("Login page shows key and SVN login tabs", async ({ page }) => {
  await page.goto("/login")

  await expect(page.getByRole("tab", { name: "Key 登录" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "SVN 登录" })).toBeVisible()
})

test("Key login form uses key input only", async ({ page }) => {
  await page.goto("/login")

  await expect(page.getByLabel("Key")).toBeVisible()
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible()
  await expectLegacyLoginEntrypointsRemoved(page)
})

test("SVN login form asks for SVN credentials", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("tab", { name: "SVN 登录" }).click()

  await expect(page.getByLabel("SVN账号")).toBeVisible()
  await expect(page.getByLabel("SVN密码")).toBeVisible()
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible()
  await expectLegacyLoginEntrypointsRemoved(page)
})

test("Logged-out user cannot access protected routes", async ({ page }) => {
  await page.goto("/settings")
  await page.waitForURL("/login")
})

test("Redirects to /login when token is wrong", async ({ page }) => {
  await page.goto("/settings")
  await page.evaluate(() => {
    localStorage.setItem("access_token", "invalid_token")
  })
  await page.goto("/settings")
  await page.waitForURL("/login")
  await expect(page).toHaveURL("/login")
})
