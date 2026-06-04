import { expect, test } from "@playwright/test"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { randomItemDescription, randomItemTitle } from "./utils/random"
import { testSvnPassword } from "./config.ts"
import { logInWithSvn } from "./utils/user"

test("Admin can access items page and sees correct title", async ({ page }) => {
  await page.goto("/items")
  await expect(page.getByRole("heading", { name: "部门管理" })).toBeVisible()
  await expect(page.getByText("创建并管理部门信息")).toBeVisible()
})

test("Add Item button is visible", async ({ page }) => {
  await page.goto("/items")
  await expect(page.getByRole("button", { name: "新增部门" })).toBeVisible()
})

test.describe("Items management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/items")
  })

  test("Create a new item successfully", async ({ page }) => {
    const title = randomItemTitle()
    const description = randomItemDescription()

    await page.getByRole("button", { name: "新增部门" }).click()
    await page.getByLabel("部门名称").fill(title)
    await page.getByLabel("说明").fill(description)
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("部门创建成功")).toBeVisible()
    await expect(page.getByText(title)).toBeVisible()
  })

  test("Create item with only required fields", async ({ page }) => {
    const title = randomItemTitle()

    await page.getByRole("button", { name: "新增部门" }).click()
    await page.getByLabel("部门名称").fill(title)
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("部门创建成功")).toBeVisible()
    await expect(page.getByText(title)).toBeVisible()
  })

  test("Cancel item creation", async ({ page }) => {
    await page.getByRole("button", { name: "新增部门" }).click()
    await page.getByLabel("部门名称").fill("Test Item")
    await page.getByRole("button", { name: "取消" }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
  })

  test("请填写部门名称", async ({ page }) => {
    await page.getByRole("button", { name: "新增部门" }).click()
    await page.getByLabel("部门名称").fill("")
    await page.getByLabel("部门名称").blur()

    await expect(page.getByText("请填写部门名称")).toBeVisible()
  })

  test.describe("Edit and Delete", () => {
    let itemTitle: string

    test.beforeEach(async ({ page }) => {
      itemTitle = randomItemTitle()

      await page.getByRole("button", { name: "新增部门" }).click()
      await page.getByLabel("部门名称").fill(itemTitle)
      await page.getByRole("button", { name: "保存" }).click()
      await expect(page.getByText("部门创建成功")).toBeVisible()
      await expect(page.getByRole("dialog")).not.toBeVisible()
    })

    test("Edit an item successfully", async ({ page }) => {
      const itemRow = page.getByRole("row").filter({ hasText: itemTitle })
      await itemRow.getByRole("button").last().click()
      await page.getByRole("menuitem", { name: "编辑部门" }).click()

      const updatedTitle = randomItemTitle()
      await page.getByLabel("部门名称").fill(updatedTitle)
      await page.getByRole("button", { name: "保存" }).click()

      await expect(page.getByText("部门更新成功")).toBeVisible()
      await expect(page.getByText(updatedTitle)).toBeVisible()
    })

    test("Delete an item successfully", async ({ page }) => {
      const itemRow = page.getByRole("row").filter({ hasText: itemTitle })
      await itemRow.getByRole("button").last().click()
      await page.getByRole("menuitem", { name: "删除部门" }).click()

      await page.getByRole("button", { name: "删除" }).click()

      await expect(
        page.getByText("部门删除成功"),
      ).toBeVisible()
      await expect(page.getByText(itemTitle)).not.toBeVisible()
    })
  })
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
