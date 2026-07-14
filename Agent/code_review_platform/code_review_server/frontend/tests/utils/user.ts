import { expect, type Page } from "@playwright/test"

export async function logInWithKey(page: Page, key: string) {
  await page.goto("/login")

  await page.getByRole("tab", { name: "Key 登录" }).click()
  await page.getByTestId("key-input").fill(key)
  await page.getByRole("button", { name: "登录" }).click()
  await page.waitForURL("/")
  await expect(page.getByTestId("user-menu")).toBeVisible()
}

export async function logInWithSvn(
  page: Page,
  svnUsername: string,
  svnPassword: string,
) {
  await page.goto("/login")

  await page.getByRole("tab", { name: "SVN 登录" }).click()
  await page.getByLabel("SVN账号").fill(svnUsername)
  await page.getByLabel("SVN密码").fill(svnPassword)
  await page.getByRole("button", { name: "登录" }).click()
  await page.waitForURL("/")
  await expect(page.getByTestId("user-menu")).toBeVisible()
}

export async function logOutUser(page: Page) {
  await page.getByTestId("user-menu").click()
  await page.getByRole("menuitem", { name: "Log out" }).click()
  await page.goto("/login")
}
