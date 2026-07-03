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
    await expect(page.getByRole("link", { name: "部门管理" })).not.toBeVisible()

    const taskMenu = page.getByRole("button", { name: "任务管理" })
    await expect(taskMenu).toBeVisible()
    await taskMenu.click()
    await page.getByRole("link", { name: "代码审查任务管理" }).click()

    await expect(page).toHaveURL(/\/tasks\/review/)
    await expect(
      page.getByRole("heading", { name: "代码审查任务管理" }),
    ).toBeVisible()
    await expect(page.getByPlaceholder("用户姓名")).not.toBeVisible()
    await expect(page.getByPlaceholder("SVN账号")).not.toBeVisible()
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
    await expect(page.getByPlaceholder("用户姓名")).toBeVisible()
    await expect(page.getByPlaceholder("SVN账号")).toBeVisible()
  })

  test("Admin task table shows error message instead of client details", async ({
    page,
  }) => {
    await logInWithKey(page, testApiKey)

    await page.route("**/api/v1/review-tasks?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              user_id: "22222222-2222-2222-2222-222222222222",
              user_name: "测试用户",
              svn_username: "test_svn",
              svn_url: "https://example.test/svn/project",
              old_revision: "r1",
              new_revision: "r2",
              status: "failed",
              report_path: null,
              pdf_report_path: null,
              error_message: "客户端本地已生成报告，但未上传成功",
              client_hostname: "worker-01",
              client_version: "1.0.0",
              started_at: "2026-06-11T13:40:00",
              finished_at: "2026-06-11T13:52:30",
            },
          ],
          count: 1,
        },
      })
    })

    await page.goto("/tasks/review")

    await expect(
      page.getByRole("columnheader", { name: "错误信息" }),
    ).toBeVisible()
    await expect(
      page.getByRole("columnheader", { name: "执行客户端" }),
    ).not.toBeVisible()
    await expect(
      page.getByText("客户端本地已生成报告，但未上传成功"),
    ).toBeVisible()
    await expect(page.getByText("worker-01 / 1.0.0")).not.toBeVisible()
    await expect(page.getByText("失败")).toBeVisible()
    await expect(page.getByText("2026-06-11 13:40:00")).toBeVisible()
    await expect(page.getByText("2026-06-11 13:52:30")).toBeVisible()
  })

  test("Admin task table shows status badge and task times", async ({
    page,
  }) => {
    await logInWithKey(page, testApiKey)

    await page.route("**/api/v1/review-tasks?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              user_id: "22222222-2222-2222-2222-222222222222",
              user_name: "测试用户",
              svn_username: "test_svn",
              svn_url: "https://example.test/svn/project",
              old_revision: "r1",
              new_revision: "r2",
              status: "running_codex",
              report_path: null,
              pdf_report_path: null,
              error_message: null,
              client_hostname: null,
              client_version: null,
              started_at: "2026-06-11T14:03:20",
              finished_at: null,
            },
          ],
          count: 1,
        },
      })
    })

    await page.goto("/tasks/review")

    await expect(
      page.getByRole("columnheader", { name: "开始时间" }),
    ).toBeVisible()
    await expect(
      page.getByRole("columnheader", { name: "结束时间" }),
    ).toBeVisible()
    await expect(page.getByText("审查中")).toBeVisible()
    await expect(page.getByText("2026-06-11 14:03:20")).toBeVisible()

    const taskRow = page.getByRole("row").filter({ hasText: "测试用户" })
    const cells = taskRow.getByRole("cell")
    await expect(cells.nth(5)).toContainText("2026-06-11 14:03:20")
    await expect(cells.nth(6)).toHaveText("-")
  })

  test("Admin task table shows PDF download button for tasks with PDF report", async ({
    page,
  }) => {
    await logInWithKey(page, testApiKey)

    await page.route("**/api/v1/review-tasks?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              user_id: "22222222-2222-2222-2222-222222222222",
              user_name: "测试用户",
              svn_username: "test_svn",
              svn_url: "https://example.test/svn/project",
              old_revision: "r1",
              new_revision: "r2",
              status: "success",
              report_path: "/reports/task.md",
              pdf_report_path: "/reports/task.pdf",
              error_message: null,
              client_hostname: null,
              client_version: null,
              started_at: "2026-06-11T14:03:20",
              finished_at: "2026-06-11T14:08:20",
            },
          ],
          count: 1,
        },
      })
    })

    await page.goto("/tasks/review")

    await expect(
      page.getByRole("button", { name: "下载 PDF 报告" }),
    ).toBeVisible()
  })

  test("Admin task table shows report feedback columns and useful text title", async ({
    page,
  }) => {
    await logInWithKey(page, testApiKey)

    await page.route("**/api/v1/review-tasks?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              user_id: "22222222-2222-2222-2222-222222222222",
              user_name: "测试用户",
              svn_username: "test_svn",
              svn_url: "https://example.test/svn/project",
              old_revision: "r1",
              new_revision: "r2",
              status: "success",
              report_path: "/reports/task.md",
              pdf_report_path: "/reports/task.pdf",
              error_message: null,
              started_at: "2026-06-11T14:03:20",
              finished_at: "2026-06-11T14:08:20",
              report_feedback_helpful: true,
              report_feedback_useful_issues_text: "1. 空指针风险\n2. 越界访问风险",
            },
            {
              id: "33333333-3333-3333-3333-333333333333",
              user_id: "44444444-4444-4444-4444-444444444444",
              user_name: "未反馈用户",
              svn_username: "no_feedback",
              svn_url: "https://example.test/svn/project-2",
              old_revision: "r3",
              new_revision: "r4",
              status: "success",
              report_path: "/reports/task2.md",
              pdf_report_path: "/reports/task2.pdf",
              error_message: null,
              started_at: "2026-06-11T15:03:20",
              finished_at: "2026-06-11T15:08:20",
              report_feedback_helpful: null,
              report_feedback_useful_issues_text: null,
            },
          ],
          count: 2,
        },
      })
    })

    await page.goto("/tasks/review")

    await expect(page.getByRole("columnheader", { name: "是否有帮助" })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "有用信息" })).toBeVisible()
    await expect(page.getByText("有帮助")).toBeVisible()
    await expect(page.getByText("未反馈")).toBeVisible()
    const usefulCell = page.getByTitle("1. 空指针风险\n2. 越界访问风险")
    await expect(usefulCell).toBeVisible()

    await page.setViewportSize({ width: 1600, height: 900 })
    await expect(page.locator('[data-testid="review-tasks-content"]')).toHaveClass(
      /max-w-\[1600px\]/,
    )
    const hasPageHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasPageHorizontalOverflow).toBe(false)
  })
})
