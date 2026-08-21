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

  test("Admin task table keeps feedback status but omits useful text column", async ({
    page,
  }) => {
    await page.route("**/api/v1/auth/key-login", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { access_token: "test-token", token_type: "bearer" },
      })
    })
    await page.route("**/api/v1/users/me", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "22222222-2222-2222-2222-222222222222",
          full_name: "反馈管理员",
          svn_username: "feedback_admin",
          role: "admin",
          is_active: true,
          is_superuser: true,
        },
      })
    })
    await logInWithKey(page, "mock-api-key")

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
      page.getByRole("columnheader", { name: "反馈状态" }),
    ).toBeVisible()
    await expect(
      page.getByRole("columnheader", { name: "反馈内容" }),
    ).toHaveCount(0)
    const taskTable = page.getByRole("table")
    await expect(taskTable.getByText("有帮助", { exact: true })).toBeVisible()
    await expect(taskTable.getByText("未反馈", { exact: true })).toBeVisible()
    await expect(page.getByTitle("1. 空指针风险\n2. 越界访问风险")).toHaveCount(
      0,
    )

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

test.describe("Issue feedback task details", () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 900 },
  })

  const currentUser = {
    id: "22222222-2222-2222-2222-222222222222",
    full_name: "反馈管理员",
    svn_username: "feedback_admin",
    role: "admin",
    is_active: true,
    is_superuser: true,
  }

  const issueFeedbackTask = (
    id: string,
    userName: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    user_id: "33333333-3333-3333-3333-333333333333",
    user_name: userName,
    svn_username: "review_owner",
    svn_url: "https://example.test/svn/feedback-project",
    old_revision: "r101",
    new_revision: "r108",
    department_name: "研发一部",
    status: "success",
    report_path: "/reports/task.md",
    report_name: "代码审查报告.md",
    pdf_report_path: null,
    pdf_report_name: null,
    feedback_protocol_version: 1,
    feedback_submitted_at: null,
    issue_count: 3,
    evaluated_issue_count: 0,
    has_issue_feedback_draft: false,
    report_feedback_helpful: null,
    report_feedback_useful_issues_text: null,
    error_message: null,
    created_at: "2026-07-29T09:50:00+08:00",
    started_at: "2026-07-29T10:00:00+08:00",
    finished_at: "2026-07-29T10:08:00+08:00",
    ...overrides,
  })

  async function mockCurrentUser(
    page: import("@playwright/test").Page,
    user: typeof currentUser = currentUser,
  ) {
    await page.addInitScript(() => {
      localStorage.setItem("access_token", "test-token")
    })
    await page.route("**/api/v1/users/me", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: user,
      })
    })
  }

  test("普通用户在自己的任务详情查看 DS-99 规则和模式，不显示材料信息", async ({
    page,
  }) => {
    const taskId = "10000000-0000-0000-0000-000000000099"
    const normalUser = {
      ...currentUser,
      id: "33333333-3333-3333-3333-333333333333",
      full_name: "普通审查用户",
      role: "user",
      is_superuser: false,
    }
    const task = issueFeedbackTask(taskId, "普通审查用户", {
      user_id: normalUser.id,
      review_item_ids: ["DS-99"],
      custom_review_rule: "保护条件必须具有明确恢复路径。",
      custom_review_mode: "new_revision_full",
      has_custom_review_word_material: true,
      has_custom_review_excel_material: false,
      has_custom_review_pdf_material: true,
    })

    await mockCurrentUser(page, normalUser)
    await page.route("**/api/v1/review-tasks?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { data: [task], count: 1 },
      })
    })
    await page.route(`**/api/v1/review-tasks/${taskId}`, async (route) => {
      await route.fulfill({ contentType: "application/json", json: task })
    })
    await page.route(
      `**/api/v1/review-tasks/${taskId}/issues`,
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          json: { data: [], count: 0, evaluated_count: 0 },
        })
      },
    )

    await page.goto("/tasks/review")
    await page
      .getByRole("row")
      .filter({ hasText: "普通审查用户" })
      .getByRole("button", { name: "查看任务详情" })
      .click()

    const detail = page.getByTestId("custom-review-input-detail")
    await expect(detail).toBeVisible()
    await expect(detail.getByText("全量代码审查模式")).toBeVisible()
    await expect(
      detail.getByText("保护条件必须具有明确恢复路径。"),
    ).toBeVisible()
    await expect(detail).not.toContainText("Word 材料")
    await expect(detail).not.toContainText("Excel 材料")
    await expect(detail).not.toContainText("PDF 材料")
    await expect(detail).not.toContainText("/local/")
  })

  test("Task management exports issue feedback Excel with the applied start date", async ({
    page,
  }) => {
    await mockCurrentUser(page, {
      ...currentUser,
      full_name: "普通反馈用户",
      role: "user",
      is_superuser: false,
    })
    let exportAuthorization = ""
    const exportUrls: string[] = []
    await page.route("**/api/v1/review-tasks?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { data: [], count: 0 },
      })
    })
    await page.route(
      "**/api/v1/review-tasks/issue-feedback/export*",
      async (route) => {
        exportAuthorization = route.request().headers().authorization || ""
        exportUrls.push(route.request().url())
        await route.fulfill({
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          headers: {
            "Content-Disposition":
              "attachment; filename*=UTF-8''%E9%97%AE%E9%A2%98%E5%8F%8D%E9%A6%88%E6%98%8E%E7%BB%86_20260730_103000.xlsx",
            "Access-Control-Expose-Headers": "Content-Disposition",
          },
          body: "mock xlsx content",
        })
      },
    )

    await page.goto("/tasks/review")
    const exportButton = page.getByRole("button", {
      name: "导出问题反馈 Excel",
    })
    await expect(exportButton).toBeVisible()

    await page.getByLabel("开始时间").fill("2026-08-14")
    await page.getByRole("button", { name: "搜索" }).click()
    const downloadPromise = page.waitForEvent("download")
    await exportButton.click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe(
      "问题反馈明细_20260730_103000.xlsx",
    )
    expect(exportAuthorization).toBe("Bearer test-token")
    expect(new URL(exportUrls[0]).searchParams.get("started_from")).toBe(
      "2026-08-14",
    )

    await page.getByLabel("开始时间").fill("2026-08-15")
    const unsavedDownloadPromise = page.waitForEvent("download")
    await exportButton.click()
    await unsavedDownloadPromise
    expect(new URL(exportUrls[1]).searchParams.get("started_from")).toBe(
      "2026-08-14",
    )

    await page.getByRole("button", { name: "重置" }).click()
    const resetDownloadPromise = page.waitForEvent("download")
    await exportButton.click()
    await resetDownloadPromise
    expect(new URL(exportUrls[2]).searchParams.has("started_from")).toBe(false)
  })

  test("List distinguishes new feedback states and preserves legacy feedback", async ({
    page,
  }) => {
    await mockCurrentUser(page)
    await page.route("**/api/v1/review-tasks*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: [
            issueFeedbackTask(
              "10000000-0000-0000-0000-000000000001",
              "未开始用户",
            ),
            issueFeedbackTask(
              "10000000-0000-0000-0000-000000000002",
              "草稿用户",
              { evaluated_issue_count: 2 },
            ),
            issueFeedbackTask(
              "10000000-0000-0000-0000-000000000005",
              "说明草稿用户",
              { has_issue_feedback_draft: true },
            ),
            issueFeedbackTask(
              "10000000-0000-0000-0000-000000000003",
              "已提交用户",
              {
                evaluated_issue_count: 3,
                feedback_submitted_at: "2026-07-29T11:30:00+08:00",
                pdf_report_path: "/reports/task.pdf",
              },
            ),
            {
              ...issueFeedbackTask(
                "10000000-0000-0000-0000-000000000004",
                "历史用户",
              ),
              feedback_protocol_version: null,
              issue_count: 0,
              evaluated_issue_count: 0,
              report_feedback_helpful: true,
              report_feedback_useful_issues_text: "空指针问题帮助定位",
            },
          ],
          count: 5,
        },
      })
    })

    await page.goto("/tasks/review")

    const notStartedRow = page
      .getByRole("row")
      .filter({ hasText: "未开始用户" })
    await expect(notStartedRow).toContainText("未开始")
    await expect(notStartedRow).toContainText("0 / 3")

    const draftRow = page.getByRole("row").filter({
      has: page.getByText("草稿用户", { exact: true }),
    })
    await expect(draftRow).toContainText("草稿")
    await expect(draftRow).toContainText("2 / 3")

    const textOnlyDraftRow = page
      .getByRole("row")
      .filter({ hasText: "说明草稿用户" })
    await expect(textOnlyDraftRow).toContainText("草稿")
    await expect(textOnlyDraftRow).toContainText("0 / 3")

    const submittedRow = page.getByRole("row").filter({ hasText: "已提交用户" })
    await expect(submittedRow).toContainText("已提交")
    await expect(submittedRow).toContainText("3 / 3")

    const legacyRow = page.getByRole("row").filter({ hasText: "历史用户" })
    await expect(legacyRow).toContainText("有帮助")
    await expect(legacyRow).toContainText("空指针问题帮助定位")
    await expect(legacyRow).not.toContainText("0 / 0")

    const hasPageHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
    expect(hasPageHorizontalOverflow).toBe(false)
  })

  test("Detail shows ordered read-only feedback, original report and final PDF", async ({
    page,
  }) => {
    await mockCurrentUser(page)
    const taskId = "20000000-0000-0000-0000-000000000001"
    const task = issueFeedbackTask(taskId, "详情用户", {
      issue_count: 2,
      evaluated_issue_count: 2,
      feedback_submitted_at: "2026-07-29T11:30:00+08:00",
      pdf_report_path: "/reports/final.pdf",
      pdf_report_name: "反馈版代码审查报告.pdf",
    })
    let detailAuthorization = ""
    let issuesAuthorization = ""
    let pdfDownloadCount = 0

    await page.route("**/api/v1/review-tasks*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { data: [task], count: 1 },
      })
    })
    await page.route(`**/api/v1/review-tasks/${taskId}`, async (route) => {
      detailAuthorization = route.request().headers().authorization || ""
      await route.fulfill({ contentType: "application/json", json: task })
    })
    await page.route(
      `**/api/v1/review-tasks/${taskId}/issues`,
      async (route) => {
        issuesAuthorization = route.request().headers().authorization || ""
        await route.fulfill({
          contentType: "application/json",
          json: {
            data: [
              {
                id: "30000000-0000-0000-0000-000000000002",
                task_id: taskId,
                issue_text: "第二个问题：边界判断不完整",
                description_text:
                  "输入达到上限时会进入错误分支。这里附带足够长的描述，用来验证桌面详情中的文本会正常换行而不会横向撑开页面。",
                display_snapshot: "snapshot-2",
                order: 1,
                source: "template_one_heading",
                location: {
                  start_offset: 100,
                  end_offset: 200,
                  feedback_insertion_offset: 190,
                  anchor_line: 20,
                  heading_level: 4,
                },
                helpful: false,
                feedback_text:
                  "该分支在当前产品约束下不会出现，但已经补充注释说明边界，后续需求变化时需要重新确认。",
              },
              {
                id: "30000000-0000-0000-0000-000000000001",
                task_id: taskId,
                issue_text: "第一个问题：空指针风险",
                description_text: "对象释放后仍可能被回调函数访问。",
                display_snapshot: "snapshot-1",
                order: 0,
                source: "template_one_heading",
                location: {
                  start_offset: 0,
                  end_offset: 99,
                  feedback_insertion_offset: 90,
                  anchor_line: 10,
                  heading_level: 4,
                },
                helpful: true,
                feedback_text: "已增加空值检查并完成回归测试。",
              },
            ],
            count: 2,
            evaluated_count: 2,
            feedback_submitted_at: "2026-07-29T11:30:00+08:00",
          },
        })
      },
    )
    await page.route(
      `**/api/v1/review-tasks/${taskId}/report`,
      async (route) => {
        await route.fulfill({
          contentType: "text/markdown; charset=utf-8",
          body: "# 原始代码审查报告\n\n## 审查结论\n保留原始 Markdown 内容。",
        })
      },
    )
    await page.route(
      `**/api/v1/review-tasks/${taskId}/pdf/download`,
      async (route) => {
        pdfDownloadCount += 1
        await route.fulfill({
          contentType: "application/pdf",
          headers: {
            "Content-Disposition":
              'attachment; filename="feedback-review-report.pdf"',
          },
          body: "%PDF-1.4 mocked report",
        })
      },
    )

    await page.goto("/tasks/review")
    const taskRow = page.getByRole("row").filter({ hasText: "详情用户" })
    await taskRow.getByRole("button", { name: "查看任务详情" }).click()

    const dialog = page.getByRole("dialog", { name: "任务详情" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("研发一部")).toBeVisible()
    await expect(dialog.getByText("r101 → r108")).toBeVisible()
    await expect(dialog.getByText("已提交", { exact: true })).toBeVisible()
    await expect(dialog.getByText("2 / 2")).toBeVisible()
    await expect(dialog.getByText("2026-07-29 11:30:00")).toBeVisible()

    const feedbackItems = dialog.locator(
      '[data-testid="issue-feedback-list"] > li',
    )
    await expect(feedbackItems).toHaveCount(2)
    await expect(feedbackItems.nth(0)).toContainText("第一个问题：空指针风险")
    await expect(feedbackItems.nth(0)).toContainText("有帮助")
    await expect(feedbackItems.nth(0)).toContainText(
      "已增加空值检查并完成回归测试。",
    )
    await expect(feedbackItems.nth(1)).toContainText(
      "第二个问题：边界判断不完整",
    )
    await expect(feedbackItems.nth(1)).toContainText("没帮助")
    await expect(dialog.locator("textarea")).toHaveCount(0)
    await expect(dialog.getByRole("radio")).toHaveCount(0)
    await expect(
      dialog.getByRole("button", { name: /保存|提交|修改/ }),
    ).toHaveCount(0)

    const feedbackListBox = await feedbackItems.first().boundingBox()
    const tabListBox = await dialog
      .getByRole("tablist", { name: "任务详情视图" })
      .boundingBox()
    expect(feedbackListBox).not.toBeNull()
    expect(tabListBox).not.toBeNull()
    expect(
      (tabListBox?.y ?? 0) + (tabListBox?.height ?? 0),
    ).toBeLessThanOrEqual(feedbackListBox?.y ?? 0)

    await dialog.getByRole("tab", { name: "原始报告" }).click()
    await expect(dialog.getByText("# 原始代码审查报告")).toBeVisible()
    await expect(dialog.getByText("保留原始 Markdown 内容。")).toBeVisible()

    const downloadPromise = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "下载最终 PDF" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe("反馈版代码审查报告.pdf")
    expect(pdfDownloadCount).toBe(1)
    expect(detailAuthorization).toBe("Bearer test-token")
    expect(issuesAuthorization).toBe("Bearer test-token")

    const detailLayout = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const scrollBody = element.querySelector(".overflow-y-auto")
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        contentScrollWidth: scrollBody?.scrollWidth ?? 0,
        contentClientWidth: scrollBody?.clientWidth ?? 0,
      }
    })
    expect(detailLayout.left).toBeGreaterThanOrEqual(0)
    expect(detailLayout.right).toBeLessThanOrEqual(1440)
    expect(detailLayout.top).toBeGreaterThanOrEqual(0)
    expect(detailLayout.bottom).toBeLessThanOrEqual(900)
    expect(detailLayout.contentScrollWidth).toBeLessThanOrEqual(
      detailLayout.contentClientWidth,
    )
  })

  test("Detail presents empty states and a task-load error", async ({
    page,
  }) => {
    await mockCurrentUser(page)
    const emptyTaskId = "40000000-0000-0000-0000-000000000001"
    const errorTaskId = "40000000-0000-0000-0000-000000000002"
    const unevaluatedTaskId = "40000000-0000-0000-0000-000000000003"
    const emptyTask = issueFeedbackTask(emptyTaskId, "空报告用户", {
      report_path: null,
      issue_count: 0,
      evaluated_issue_count: 0,
    })
    const errorTask = issueFeedbackTask(errorTaskId, "错误任务用户")
    const unevaluatedTask = issueFeedbackTask(
      unevaluatedTaskId,
      "未评价问题用户",
      { issue_count: 1, evaluated_issue_count: 0 },
    )

    await page.route("**/api/v1/review-tasks*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: [emptyTask, unevaluatedTask, errorTask],
          count: 3,
        },
      })
    })
    await page.route(`**/api/v1/review-tasks/${emptyTaskId}`, async (route) => {
      await route.fulfill({ contentType: "application/json", json: emptyTask })
    })
    await page.route(
      `**/api/v1/review-tasks/${emptyTaskId}/issues`,
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          json: {
            data: [],
            count: 0,
            evaluated_count: 0,
            feedback_submitted_at: null,
          },
        })
      },
    )
    await page.route(`**/api/v1/review-tasks/${errorTaskId}`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        json: { detail: "mock failure" },
      })
    })
    await page.route(
      `**/api/v1/review-tasks/${unevaluatedTaskId}`,
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          json: unevaluatedTask,
        })
      },
    )
    await page.route(
      `**/api/v1/review-tasks/${unevaluatedTaskId}/issues`,
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          json: {
            data: [
              {
                id: "50000000-0000-0000-0000-000000000001",
                task_id: unevaluatedTaskId,
                issue_text: "尚未评价的问题",
                description_text: "该问题还没有评价和反馈说明。",
                display_snapshot: "snapshot",
                order: 0,
                source: "template_one_heading",
                location: {
                  start_offset: 0,
                  end_offset: 20,
                  feedback_insertion_offset: 20,
                  anchor_line: 1,
                  heading_level: 4,
                },
                helpful: null,
                feedback_text: null,
              },
            ],
            count: 1,
            evaluated_count: 0,
            feedback_submitted_at: null,
          },
        })
      },
    )

    await page.goto("/tasks/review")
    await page
      .getByRole("row")
      .filter({ hasText: "空报告用户" })
      .getByRole("button", { name: "查看任务详情" })
      .click()

    const dialog = page.getByRole("dialog", { name: "任务详情" })
    await expect(
      dialog.getByText("报告未识别到需要反馈的审查问题。"),
    ).toBeVisible()
    await dialog.getByRole("tab", { name: "原始报告" }).click()
    await expect(
      dialog.getByText("当前任务没有可查看的原始报告。"),
    ).toBeVisible()
    await dialog.getByRole("button", { name: "Close" }).click()

    await page
      .getByRole("row")
      .filter({ hasText: "未评价问题用户" })
      .getByRole("button", { name: "查看任务详情" })
      .click()
    await expect(dialog.getByText("尚未评价的问题")).toBeVisible()
    await expect(dialog.getByText("未评价", { exact: true })).toBeVisible()
    await expect(dialog.getByText("未填写", { exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Close" }).click()

    await page
      .getByRole("row")
      .filter({ hasText: "错误任务用户" })
      .getByRole("button", { name: "查看任务详情" })
      .click()
    await expect(
      page.getByText("任务详情加载失败，任务可能已删除或当前账号无权查看。"),
    ).toBeVisible({ timeout: 15_000 })
  })

  test("Legacy detail preserves report feedback and PDF download", async ({
    page,
  }) => {
    await mockCurrentUser(page)
    const taskId = "60000000-0000-0000-0000-000000000001"
    const task = issueFeedbackTask(taskId, "历史详情用户", {
      feedback_protocol_version: null,
      issue_count: 0,
      evaluated_issue_count: 0,
      has_issue_feedback_draft: false,
      report_feedback_helpful: true,
      report_feedback_useful_issues_text: "帮助确认了历史空指针问题",
      pdf_report_path: "/reports/legacy.pdf",
      pdf_report_name: "历史代码审查报告.pdf",
    })
    let issuesRequestCount = 0

    await page.route("**/api/v1/review-tasks*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { data: [task], count: 1 },
      })
    })
    await page.route(`**/api/v1/review-tasks/${taskId}`, async (route) => {
      await route.fulfill({ contentType: "application/json", json: task })
    })
    await page.route(
      `**/api/v1/review-tasks/${taskId}/issues`,
      async (route) => {
        issuesRequestCount += 1
        await route.fulfill({
          contentType: "application/json",
          json: {
            data: [],
            count: 0,
            evaluated_count: 0,
            feedback_submitted_at: null,
          },
        })
      },
    )
    await page.route(
      `**/api/v1/review-tasks/${taskId}/pdf/download`,
      async (route) => {
        await route.fulfill({
          contentType: "application/pdf",
          body: "%PDF-1.4 mocked legacy report",
        })
      },
    )

    await page.goto("/tasks/review")
    await page
      .getByRole("row")
      .filter({ hasText: "历史详情用户" })
      .getByRole("button", { name: "查看任务详情" })
      .click()

    const dialog = page.getByRole("dialog", { name: "任务详情" })
    await expect(dialog.getByText("历史报告反馈")).toBeVisible()
    await expect(
      dialog
        .getByRole("tabpanel", { name: "问题反馈" })
        .getByText("有帮助", { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByText("帮助确认了历史空指针问题")).toBeVisible()
    await expect(
      dialog.getByText("此任务使用历史报告级反馈，不包含逐问题反馈记录。"),
    ).toBeVisible()

    const downloadPromise = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "下载 PDF 报告" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe("历史代码审查报告.pdf")
    expect(issuesRequestCount).toBe(0)
  })

  test("In-scope users across all three roles can open read-only details", async ({
    browser,
  }) => {
    const roleScenarios = [
      {
        label: "普通用户",
        user: {
          ...currentUser,
          id: "70000000-0000-0000-0000-000000000001",
          full_name: "普通用户",
          role: "user",
          is_superuser: false,
        },
      },
      {
        label: "部门管理员",
        user: {
          ...currentUser,
          id: "70000000-0000-0000-0000-000000000002",
          full_name: "部门管理员",
          role: "department_admin",
          is_superuser: false,
        },
      },
      {
        label: "系统管理员",
        user: {
          ...currentUser,
          id: "70000000-0000-0000-0000-000000000003",
          full_name: "系统管理员",
        },
      },
    ]

    for (const [index, scenario] of roleScenarios.entries()) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      })
      const page = await context.newPage()
      const taskId = `80000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`
      const task = issueFeedbackTask(taskId, `${scenario.label}范围内任务`, {
        user_id: scenario.user.id,
        issue_count: 0,
      })

      try {
        await mockCurrentUser(page, scenario.user)
        await page.route("**/api/v1/review-tasks*", async (route) => {
          await route.fulfill({
            contentType: "application/json",
            json: { data: [task], count: 1 },
          })
        })
        await page.route(`**/api/v1/review-tasks/${taskId}`, async (route) => {
          await route.fulfill({ contentType: "application/json", json: task })
        })
        await page.route(
          `**/api/v1/review-tasks/${taskId}/issues`,
          async (route) => {
            await route.fulfill({
              contentType: "application/json",
              json: {
                data: [],
                count: 0,
                evaluated_count: 0,
                feedback_submitted_at: null,
              },
            })
          },
        )

        await page.goto("/tasks/review")
        await page
          .getByRole("row")
          .filter({ hasText: `${scenario.label}范围内任务` })
          .getByRole("button", { name: "查看任务详情" })
          .click()

        const dialog = page.getByRole("dialog", { name: "任务详情" })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByText(`任务编号 ${taskId}`)).toBeVisible()
        await expect(dialog.locator("textarea")).toHaveCount(0)
        await expect(dialog.getByRole("radio")).toHaveCount(0)
      } finally {
        await context.close()
      }
    }
  })
})
