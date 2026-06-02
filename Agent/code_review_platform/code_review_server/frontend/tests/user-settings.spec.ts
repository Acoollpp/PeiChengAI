import { expect, test } from "@playwright/test"

const tabs = ["个人信息", "SVN凭据", "危险操作"]

test("个人信息 tab 默认激活", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.getByRole("tab", { name: "个人信息" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
})

test("设置页显示新的 tabs 并移除旧密码 tab", async ({ page }) => {
  await page.goto("/settings")
  for (const tab of tabs) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible()
  }
  await expect(page.getByRole("tab", { name: "Password" })).not.toBeVisible()
})

test("个人信息不再显示 Email 字段", async ({ page }) => {
  await page.goto("/settings")
  await page.getByRole("tab", { name: "个人信息" }).click()

  await expect(page.getByLabel("Email")).not.toBeVisible()
  await expect(page.getByText("Email", { exact: true })).not.toBeVisible()
})

test.describe("Edit user profile", () => {
  test("Edit user name with a valid name", async ({ page }) => {
    const updatedName = `Test User ${Date.now()}`

    await page.goto("/settings")
    await page.getByRole("tab", { name: "个人信息" }).click()
    await page.getByRole("button", { name: "Edit" }).click()
    await page.getByLabel("Full name").fill(updatedName)
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User updated successfully")).toBeVisible()
    await expect(
      page.locator("form").getByText(updatedName, { exact: true }),
    ).toBeVisible()
  })
})

test.describe("Cancel edit actions", () => {
  test("Cancel edit action restores original name", async ({ page }) => {
    await page.goto("/settings")
    await page.getByRole("tab", { name: "个人信息" }).click()

    const originalName = await page.locator("form p").first().innerText()

    await page.getByRole("button", { name: "Edit" }).click()
    await page.getByLabel("Full name").fill("Test User")
    await page.getByRole("button", { name: "Cancel" }).first().click()

    await expect(
      page.locator("form").getByText(originalName, { exact: true }),
    ).toBeVisible()
  })
})

test.describe("SVN credentials", () => {
  test("SVN credential form is available", async ({ page }) => {
    await page.goto("/settings")
    await page.getByRole("tab", { name: "SVN凭据" }).click()

    await expect(page.getByLabel("SVN账号")).toBeVisible()
    await expect(page.getByLabel("SVN密码")).toBeVisible()
    await expect(page.getByRole("button", { name: "保存" })).toBeVisible()
  })
})

test("Appearance button is visible in sidebar", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.getByTestId("theme-button")).toBeVisible()
})

test("User can switch between theme modes", async ({ page }) => {
  await page.goto("/settings")

  await page.getByTestId("theme-button").click()
  await page.getByTestId("dark-mode").click()
  await expect(page.locator("html")).toHaveClass(/dark/)

  await expect(page.getByTestId("dark-mode")).not.toBeVisible()

  await page.getByTestId("theme-button").click()
  await page.getByTestId("light-mode").click()
  await expect(page.locator("html")).toHaveClass(/light/)
})

test("Selected mode is preserved after reload", async ({ page }) => {
  await page.goto("/settings")

  await page.getByTestId("theme-button").click()
  if (
    await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    )
  ) {
    await page.getByTestId("light-mode").click()
    await page.getByTestId("theme-button").click()
  }

  const isLightMode = await page.evaluate(() =>
    document.documentElement.classList.contains("light"),
  )
  expect(isLightMode).toBe(true)

  await page.getByTestId("theme-button").click()
  await page.getByTestId("dark-mode").click()
  await page.reload()

  const isDarkMode = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  )
  expect(isDarkMode).toBe(true)
})
