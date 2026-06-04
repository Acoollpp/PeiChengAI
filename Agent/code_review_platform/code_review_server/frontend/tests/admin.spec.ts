import { expect, test } from "@playwright/test"
import { testApiKey, testSvnPassword } from "./config.ts"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { logInWithKey, logInWithSvn } from "./utils/user"

const randomSvnUsername = () =>
  `svn_${Math.random().toString(36).substring(2, 10)}`

test("Admin page is accessible and shows current management sections", async ({
  page,
}) => {
  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "同步 CCH 用户" }),
  ).toBeVisible()
  await expect(
    page.getByText("SVN账号和密码管理将在专用用户接口接入后启用。"),
  ).toBeVisible()
  const usersTable = page.getByRole("table").first()
  await expect(
    usersTable.getByRole("columnheader", { name: "姓名" }),
  ).toBeVisible()
  await expect(
    usersTable.getByRole("columnheader", { name: "SVN账号" }),
  ).toBeVisible()
  await expect(
    usersTable.getByRole("columnheader", { name: "来源" }),
  ).toBeVisible()
  await expect(
    usersTable.getByRole("columnheader", { name: "CCH用户ID" }),
  ).toBeVisible()
  await expect(
    usersTable.getByRole("columnheader", { name: "最近同步" }),
  ).toBeVisible()
  await expect(
    usersTable.getByRole("columnheader", { name: "角色" }),
  ).toBeVisible()
  await expect(
    usersTable.getByRole("columnheader", { name: "状态" }),
  ).toBeVisible()
})

test("Admin tasks page redirects to shared task management", async ({ page }) => {
  await page.goto("/admin/tasks")
  await expect(page).toHaveURL(/\/tasks\/review/)
  await expect(
    page.getByRole("heading", { name: "代码审查任务管理" }),
  ).toBeVisible()
})

test("Admin review tasks page has user filters", async ({ page }) => {
  await page.goto("/admin/tasks/review")
  await expect(page.getByPlaceholder("用户姓名")).toBeVisible()
  await expect(page.getByPlaceholder("SVN账号")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "重置" })).toBeVisible()
})

test("Admin sidebar entries are visible", async ({ page }) => {
  await page.goto("/admin")
  await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
  await expect(page.getByRole("link", { name: "部门管理" })).toBeVisible()
  await expect(page.getByRole("link", { name: "用户管理" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Skill库" })).toBeVisible()
  const taskMenu = page.getByRole("button", { name: "任务管理" })
  await expect(taskMenu).toBeVisible()
  await expect(taskMenu).toHaveAttribute("aria-expanded", "false")
  await expect(
    page.getByRole("link", { name: "代码审查任务管理" }),
  ).not.toBeVisible()

  await taskMenu.click()
  await expect(taskMenu).toHaveAttribute("aria-expanded", "true")
  await expect(
    page.getByRole("link", { name: "代码审查任务管理" }),
  ).toBeVisible()

  await taskMenu.click()
  await expect(taskMenu).toHaveAttribute("aria-expanded", "false")
  await expect(
    page.getByRole("link", { name: "代码审查任务管理" }),
  ).not.toBeVisible()
})

test("Add User button is visible", async ({ page }) => {
  await page.goto("/admin")
  await expect(page.getByRole("button", { name: "新增用户" })).toBeVisible()
})

test.describe("Admin user management", () => {
  test("Create a new user successfully", async ({ page }) => {
    await page.goto("/admin")

    const svnUsername = randomSvnUsername()
    const fullName = `Test User ${svnUsername}`

    await page.getByRole("button", { name: "新增用户" }).click()

    await page.getByPlaceholder("姓名").fill(fullName)
    await page.getByPlaceholder("SVN 账号").fill(svnUsername)

    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户创建成功")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: svnUsername })
    await expect(userRow).toBeVisible()
    await expect(userRow.getByText(fullName)).toBeVisible()
  })

  test("Create a superuser", async ({ page }) => {
    await page.goto("/admin")

    const svnUsername = randomSvnUsername()

    await page.getByRole("button", { name: "新增用户" }).click()

    await page.getByPlaceholder("SVN 账号").fill(svnUsername)
    await page.getByLabel("设为管理员").check()
    await page.getByLabel("启用账号").check()

    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户创建成功")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: svnUsername })
    await expect(userRow.getByText("管理员")).toBeVisible()
  })

  test("Edit a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const svnUsername = randomSvnUsername()
    const originalName = `Original ${svnUsername}`
    const updatedName = `Updated ${svnUsername}`

    await page.getByRole("button", { name: "新增用户" }).click()
    await page.getByPlaceholder("姓名").fill(originalName)
    await page.getByPlaceholder("SVN 账号").fill(svnUsername)
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户创建成功")).toBeVisible()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: svnUsername })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "编辑用户" }).click()

    await page.getByPlaceholder("姓名").fill(updatedName)
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户更新成功")).toBeVisible()
    await expect(page.getByText(updatedName)).toBeVisible()
  })

  test("Delete a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const svnUsername = randomSvnUsername()

    await page.getByRole("button", { name: "新增用户" }).click()
    await page.getByPlaceholder("SVN 账号").fill(svnUsername)
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户创建成功")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: svnUsername })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "删除用户" }).click()

    await page.getByRole("button", { name: "删除" }).click()

    await expect(
      page.getByText("用户删除成功"),
    ).toBeVisible()

    await expect(
      page.getByRole("row").filter({ hasText: svnUsername }),
    ).not.toBeVisible()
  })

  test("Cancel user creation", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "新增用户" }).click()
    await page.getByPlaceholder("SVN 账号").fill(randomSvnUsername())

    await page.getByRole("button", { name: "取消" }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
  })

  test("请填写 SVN 账号", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "新增用户" }).click()

    await page.getByPlaceholder("SVN 账号").fill(" ")
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("请填写 SVN 账号")).toBeVisible()
  })
})

test.describe("Admin page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Non-superuser cannot access admin page", async ({ page }) => {
    const svnUsername = uniqueSvnUsername()

    await createUser({ svnUsername })
    await logInWithSvn(page, svnUsername, testSvnPassword)

    await page.goto("/admin")

    await expect(
      page.getByRole("heading", { name: "用户管理" }),
    ).not.toBeVisible()
    await expect(page).not.toHaveURL(/\/admin/)
  })

  test("Superuser can access admin page", async ({ page }) => {
    await logInWithKey(page, testApiKey)

    await page.goto("/admin")

    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  })
})
