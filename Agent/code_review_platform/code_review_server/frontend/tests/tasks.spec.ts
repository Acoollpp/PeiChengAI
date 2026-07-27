import { expect, test } from "@playwright/test"
import { testApiKey, testSvnPassword } from "./config.ts"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { logInWithKey, logInWithSvn } from "./utils/user"

const pagedReviewTask = (index: number) => ({
  id: `11111111-1111-1111-1111-${String(index).padStart(12, "0")}`,
  user_id: "22222222-2222-2222-2222-222222222222",
  user_name: `分页用户${index}`,
  svn_username: `page_user_${index}`,
  svn_url: `https://example.test/svn/project-${index}`,
  old_revision: `r${index}`,
  new_revision: `r${index + 1}`,
  status: "success",
  report_path: null,
  pdf_report_path: null,
  error_message: null,
  started_at: "2026-07-24T10:00:00",
  finished_at: "2026-07-24T10:05:00",
})

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

  test("Admin task table maps common raw Codex failures to readable messages", async ({
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
              user_name: "超时用户",
              svn_username: "timeout_svn",
              svn_url: "https://example.test/svn/project",
              old_revision: "r1",
              new_revision: "r2",
              status: "failed",
              error_message: "Codex review timed out after 1800000ms",
              started_at: "2026-06-11T13:40:00",
              finished_at: "2026-06-11T13:52:30",
            },
            {
              id: "33333333-3333-3333-3333-333333333333",
              user_id: "44444444-4444-4444-4444-444444444444",
              user_name: "权限用户",
              svn_username: "permission_svn",
              svn_url: "https://example.test/svn/project-2",
              old_revision: "r3",
              new_revision: "r4",
              status: "failed",
              error_message: "审查报告不存在：[路径已隐藏]",
              started_at: "2026-06-11T14:40:00",
              finished_at: "2026-06-11T14:52:30",
            },
            {
              id: "55555555-5555-5555-5555-555555555555",
              user_id: "66666666-6666-6666-6666-666666666666",
              user_name: "Codex用户",
              svn_username: "codex_svn",
              svn_url: "https://example.test/svn/project-3",
              old_revision: "r5",
              new_revision: "r6",
              status: "failed",
              error_message:
                "Codex review failed with exit code 1: Reading failed\nstderr: 后续内容每次可能不同",
              started_at: "2026-06-11T15:40:00",
              finished_at: "2026-06-11T15:52:30",
            },
          ],
          count: 3,
        },
      })
    })

    await page.goto("/tasks/review")

    await expect(
      page.getByText(
        "Codex 审查超过 60 分钟仍未完成，请稍后重试或联系管理员。",
      ),
    ).toBeVisible()
    await expect(
      page.getByText("SVN权限不足（或者SVN账号未登录）"),
    ).toBeVisible()
    await expect(
      page.getByText("Codex报错请检查Codex对话后重试。"),
    ).toBeVisible()
    await expect(page.getByText("Codex review timed out")).not.toBeVisible()
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

  test("Admin task filters combine status feedback and started date", async ({
    page,
  }) => {
    await logInWithKey(page, testApiKey)

    const requestedUrls: string[] = []
    await page.route("**/api/v1/review-tasks?**", async (route) => {
      requestedUrls.push(route.request().url())
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: [],
          count: 0,
        },
      })
    })

    await page.goto("/tasks/review")
    await page.getByLabel("状态").click()
    await page.getByRole("option", { name: "已完成" }).click()
    await page.getByLabel("是否有帮助").click()
    await page.getByRole("option", { name: "未反馈" }).click()
    await page.getByLabel("开始时间").fill("2026-07-07")
    await page.getByRole("button", { name: "搜索" }).click()

    await expect.poll(() => requestedUrls.length).toBeGreaterThan(1)
    const searchRequest = new URL(requestedUrls.at(-1) ?? "")
    expect(searchRequest.searchParams.get("status")).toBe("success")
    expect(searchRequest.searchParams.get("report_feedback")).toBe("none")
    expect(searchRequest.searchParams.get("started_from")).toBe("2026-07-07")
  })

  test("Admin task table requests server pages and shows pagination controls", async ({
    page,
  }) => {
    const requestedUrls: string[] = []
    await page.addInitScript(() => {
      localStorage.setItem("access_token", "test-token")
    })
    await page.route("**/api/v1/users/me", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "22222222-2222-2222-2222-222222222222",
          full_name: "分页管理员",
          svn_username: "admin",
          role: "admin",
          is_active: true,
          is_superuser: true,
        },
      })
    })
    await page.route("**/api/v1/review-tasks?**", async (route) => {
      const requestUrl = new URL(route.request().url())
      requestedUrls.push(route.request().url())
      const skip = Number(requestUrl.searchParams.get("skip") ?? 0)
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: [pagedReviewTask(skip + 1)],
          count: 21,
        },
      })
    })

    await page.goto("/tasks/review")

    await expect(page.getByText("显示第 1 至 10 条，共")).toBeVisible()
    await expect(page.getByText("分页用户1")).toBeVisible()

    const firstRequest = new URL(requestedUrls.at(-1) ?? "")
    expect(firstRequest.searchParams.get("skip")).toBe("0")
    expect(firstRequest.searchParams.get("limit")).toBe("10")

    await page.getByRole("button", { name: "下一页" }).click()

    await expect(page.getByText("分页用户11")).toBeVisible()
    await expect(page.getByText("显示第 11 至 20 条，共")).toBeVisible()
    const secondRequest = new URL(requestedUrls.at(-1) ?? "")
    expect(secondRequest.searchParams.get("skip")).toBe("10")
    expect(secondRequest.searchParams.get("limit")).toBe("10")
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
              report_feedback_useful_issues_text:
                "1. 空指针风险\n2. 越界访问风险",
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

    await expect(
      page.getByRole("columnheader", { name: "是否有帮助" }),
    ).toBeVisible()
    await expect(
      page.getByRole("columnheader", { name: "有用信息" }),
    ).toBeVisible()
    await expect(page.getByText("有帮助")).toBeVisible()
    await expect(page.getByText("未反馈")).toBeVisible()
    const usefulCell = page.getByTitle("1. 空指针风险\n2. 越界访问风险")
    await expect(usefulCell).toBeVisible()

    await page.setViewportSize({ width: 1600, height: 900 })
    await expect(
      page.locator('[data-testid="review-tasks-content"]'),
    ).toHaveClass(/max-w-\[1600px\]/)
    const hasPageHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
    expect(hasPageHorizontalOverflow).toBe(false)
  })
})
