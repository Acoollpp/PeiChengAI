import { expect, type Page, test } from "@playwright/test"
import type { ClientUpdatePolicyPublic } from "../src/client"
import { testApiKey, testSvnPassword } from "./config.ts"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { logInWithKey, logInWithSvn } from "./utils/user"

const randomSvnUsername = () =>
  `svn_${Math.random().toString(36).substring(2, 10)}`

const clientReleases = [
  {
    id: "release-140",
    version: "1.4.0",
    platform: "win32",
    arch: "x64",
    is_active: false,
  },
  {
    id: "release-150",
    version: "1.5.0",
    platform: "win32",
    arch: "x64",
    is_active: false,
  },
  {
    id: "release-160",
    version: "1.6.0",
    platform: "win32",
    arch: "x64",
    is_active: true,
  },
]

const initialClientUpdatePolicy = {
  platform: "win32",
  arch: "x64",
  active_release_id: "release-160",
  active_version: "1.6.0",
  minimum_supported_release_id: "release-150",
  minimum_supported_version: "1.5.0",
  updated_by_user_id: "admin-1",
  updated_at: "2026-07-31T12:00:00Z",
}

async function mockClientReleasePolicy(page: Page, updateError?: string) {
  let policy: ClientUpdatePolicyPublic = { ...initialClientUpdatePolicy }
  const updates: Array<string | null> = []

  await page.route("**/api/v1/client-releases", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue()
      return
    }
    await route.fulfill({ json: { data: clientReleases, count: 3 } })
  })
  await page.route(
    "**/api/v1/client-update-policy/win32/x64",
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: policy })
        return
      }

      const body = route.request().postDataJSON() as {
        minimum_supported_release_id: string | null
      }
      updates.push(body.minimum_supported_release_id)
      if (updateError) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ detail: updateError }),
        })
        return
      }

      const release = clientReleases.find(
        (candidate) => candidate.id === body.minimum_supported_release_id,
      )
      policy = {
        ...policy,
        minimum_supported_release_id: body.minimum_supported_release_id,
        minimum_supported_version: release?.version ?? null,
      }
      await route.fulfill({ json: policy })
    },
  )

  return updates
}

test("Admin page is accessible and shows current management sections", async ({
  page,
}) => {
  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  await expect(page.getByRole("button", { name: "同步用户Key" })).toBeVisible()
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
    usersTable.getByRole("columnheader", { name: "部门" }),
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

test("Admin tasks page redirects to shared task management", async ({
  page,
}) => {
  await page.goto("/admin/tasks")
  await expect(page).toHaveURL(/\/tasks\/review/)
  await expect(
    page.getByRole("heading", { name: "代码审查任务管理" }),
  ).toBeVisible()
})

test("Client release page separates activation and minimum supported version", async ({
  page,
}) => {
  await page.goto("/admin/client-releases")

  await expect(page.getByRole("heading", { name: "客户端版本" })).toBeVisible()
  await expect(page.getByText("上传客户端版本", { exact: true })).toBeVisible()
  await expect(page.locator("#minimum-supported-release")).toBeVisible()
  await expect(page.getByRole("button", { name: "调整门槛" })).toBeDisabled()
})

test("Client release page confirms lowering and disabling the minimum version", async ({
  page,
}) => {
  const updates = await mockClientReleasePolicy(page)
  await page.goto("/admin/client-releases")

  await page.locator("#minimum-supported-release").click()
  await page.getByRole("option", { name: "1.4.0" }).click()
  await page.getByRole("button", { name: "调整门槛" }).click()
  const lowerDialog = page.getByRole("dialog")
  await expect(lowerDialog).toContainText("当前门槛：1.5.0")
  await expect(lowerDialog).toContainText("目标门槛：1.4.0")
  await lowerDialog.getByRole("button", { name: "确认调整" }).click()
  await expect(page.getByText("最低支持版本已更新").last()).toBeVisible()
  expect(updates).toEqual(["release-140"])

  await page.locator("#minimum-supported-release").click()
  await page.getByRole("option", { name: "未启用" }).click()
  await page.getByRole("button", { name: "调整门槛" }).click()
  const disableDialog = page.getByRole("dialog")
  await expect(disableDialog).toContainText("目标门槛：未启用")
  await expect(disableDialog).toContainText(
    "调整后客户端不会因最低版本策略被强制更新",
  )
  await disableDialog.getByRole("button", { name: "确认调整" }).click()
  await expect(page.getByText("最低支持版本已更新").last()).toBeVisible()
  expect(updates).toEqual(["release-140", null])
})

test("Client release page shows a policy update failure", async ({ page }) => {
  const updates = await mockClientReleasePolicy(
    page,
    "激活版本低于最低支持版本",
  )
  await page.goto("/admin/client-releases")

  await page.locator("#minimum-supported-release").click()
  await page.getByRole("option", { name: "1.4.0" }).click()
  await page.getByRole("button", { name: "调整门槛" }).click()
  await page.getByRole("button", { name: "确认调整" }).click()

  await expect(page.getByText("激活版本低于最低支持版本")).toBeVisible()
  expect(updates).toEqual(["release-140"])
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
  await expect(page.getByRole("link", { name: "重点审查方向" })).toBeVisible()
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
  test("Create and edit a user department", async ({ page }) => {
    await page.goto("/items")
    const departmentName = `测试部门${Date.now()}`

    await page.getByRole("button", { name: "新增部门" }).click()
    await page.getByLabel("部门名称").fill(departmentName)
    await page.getByRole("button", { name: "保存" }).click()
    await expect(page.getByText("部门创建成功")).toBeVisible()

    await page.goto("/admin")

    const svnUsername = randomSvnUsername()
    const fullName = `Test User ${svnUsername}`

    await page.getByRole("button", { name: "新增用户" }).click()
    await expect(page.getByText("不选择部门")).toBeVisible()
    await page.getByLabel("部门").click()
    await page.getByRole("option", { name: departmentName }).click()
    await page.getByPlaceholder("姓名").fill(fullName)
    await page.getByPlaceholder("SVN 账号").fill(svnUsername)
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户创建成功")).toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: svnUsername })
    await expect(userRow.getByText(departmentName)).toBeVisible()

    await userRow.getByRole("button").click()
    await page.getByRole("menuitem", { name: "编辑用户" }).click()
    await page.getByLabel("部门").click()
    await page.getByRole("option", { name: "不选择部门" }).click()
    await page.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("用户更新成功")).toBeVisible()
    await expect(userRow.getByText("未分配")).toBeVisible()
  })

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
    await page.getByLabel("角色").click()
    await page.getByRole("option", { name: "管理员" }).click()
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

    await expect(page.getByText("用户删除成功")).toBeVisible()

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
