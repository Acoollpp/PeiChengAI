import { expect, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

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

test("Admin tasks page is accessible", async ({ page }) => {
  await page.goto("/admin/tasks")
  await expect(page).toHaveURL(/\/admin\/tasks\/review/)
  await expect(
    page.getByRole("heading", { name: "代码审查任务管理" }),
  ).toBeVisible()
  const tasksTable = page.getByRole("table").first()
  await expect(
    tasksTable.getByRole("columnheader", { name: "用户名称" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "SVN账号" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "SVN地址" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "版本" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "状态" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "执行客户端" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "报告" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "操作" }),
  ).toBeVisible()
})

test("Admin review tasks page has user filters", async ({ page }) => {
  await page.goto("/admin/tasks/review")
  await expect(page.getByPlaceholder("用户姓名")).toBeVisible()
  await expect(page.getByPlaceholder("SVN账号")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "重置" })).toBeVisible()
})

test("Admin sidebar entry is visible", async ({ page }) => {
  await page.goto("/admin")
  await expect(page.getByRole("link", { name: "管理" })).toBeVisible()
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
  await expect(page.getByRole("button", { name: "Add User" })).toBeVisible()
})

test.describe("Admin user management", () => {
  test("Create a new user successfully", async ({ page }) => {
    await page.goto("/admin")

    const svnUsername = randomSvnUsername()
    const fullName = `Test User ${svnUsername}`

    await page.getByRole("button", { name: "Add User" }).click()

    await page.getByPlaceholder("Full name").fill(fullName)
    await page.getByPlaceholder("SVN username").fill(svnUsername)

    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User created successfully")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: svnUsername })
    await expect(userRow).toBeVisible()
    await expect(userRow.getByText(fullName)).toBeVisible()
  })

  test("Create a superuser", async ({ page }) => {
    await page.goto("/admin")

    const svnUsername = randomSvnUsername()

    await page.getByRole("button", { name: "Add User" }).click()

    await page.getByPlaceholder("SVN username").fill(svnUsername)
    await page.getByLabel("Is superuser?").check()
    await page.getByLabel("Is active?").check()

    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User created successfully")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: svnUsername })
    await expect(userRow.getByText("管理员")).toBeVisible()
  })

  test("Edit a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const svnUsername = randomSvnUsername()
    const originalName = `Original ${svnUsername}`
    const updatedName = `Updated ${svnUsername}`

    await page.getByRole("button", { name: "Add User" }).click()
    await page.getByPlaceholder("Full name").fill(originalName)
    await page.getByPlaceholder("SVN username").fill(svnUsername)
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User created successfully")).toBeVisible()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: svnUsername })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "Edit User" }).click()

    await page.getByPlaceholder("Full name").fill(updatedName)
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User updated successfully")).toBeVisible()
    await expect(page.getByText(updatedName)).toBeVisible()
  })

  test("Delete a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const svnUsername = randomSvnUsername()

    await page.getByRole("button", { name: "Add User" }).click()
    await page.getByPlaceholder("SVN username").fill(svnUsername)
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User created successfully")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: svnUsername })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "Delete User" }).click()

    await page.getByRole("button", { name: "Delete" }).click()

    await expect(
      page.getByText("The user was deleted successfully"),
    ).toBeVisible()

    await expect(
      page.getByRole("row").filter({ hasText: svnUsername }),
    ).not.toBeVisible()
  })

  test("Cancel user creation", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "Add User" }).click()
    await page.getByPlaceholder("SVN username").fill(randomSvnUsername())

    await page.getByRole("button", { name: "Cancel" }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
  })

  test("SVN username is required", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "Add User" }).click()

    await page.getByPlaceholder("SVN username").fill(" ")
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("SVN username is required")).toBeVisible()
  })
})

test.describe("Admin page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Non-superuser cannot access admin page", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()

    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/admin")

    await expect(
      page.getByRole("heading", { name: "用户管理" }),
    ).not.toBeVisible()
    await expect(page).not.toHaveURL(/\/admin/)
  })

  test("Superuser can access admin page", async ({ page }) => {
    await logInUser(page, firstSuperuser, firstSuperuserPassword)

    await page.goto("/admin")

    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  })
})
