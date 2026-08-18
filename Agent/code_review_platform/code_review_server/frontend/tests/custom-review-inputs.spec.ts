import { expect, test } from "@playwright/test"

const adminUser = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "admin@example.com",
  full_name: "统计管理员",
  is_active: true,
  is_superuser: false,
  role: "admin",
  svn_username: "admin",
  department_id: null,
  department_name: null,
}

const customReviewInput = {
  id: "10000000-0000-0000-0000-000000000099",
  user_id: "22222222-2222-2222-2222-222222222222",
  user_name: "统计用户",
  svn_username: "stats-user",
  department_id: "33333333-3333-3333-3333-333333333333",
  department_name: "研发部",
  svn_url: "https://svn.example.com/project/custom",
  old_revision: "r101",
  new_revision: "r102",
  custom_review_rule: "保护条件必须具有明确恢复路径。",
  custom_review_mode: "dual_revision",
  has_custom_review_word_material: true,
  has_custom_review_excel_material: false,
  has_custom_review_pdf_material: true,
  status: "failed",
  created_at: "2026-08-18T10:00:00+08:00",
}

async function mockCurrentUser(
  page: import("@playwright/test").Page,
  user = adminUser,
) {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-token")
  })
  await page.route("**/api/v1/users/me", async (route) => {
    await route.fulfill({ contentType: "application/json", json: user })
  })
}

async function mockAdmin(page: import("@playwright/test").Page) {
  await mockCurrentUser(page, adminUser)
}

test("管理端可筛选、查看并导出自定义审查输入", async ({ page }) => {
  await mockAdmin(page)
  let listRequestUrl = ""
  let exportAuthorization = ""
  await page.route(
    "**/api/v1/review-tasks/custom-review-inputs?**",
    async (route) => {
      listRequestUrl = route.request().url()
      await route.fulfill({
        contentType: "application/json",
        json: { data: [customReviewInput], count: 1 },
      })
    },
  )
  await page.route(
    `**/api/v1/review-tasks/custom-review-inputs/${customReviewInput.id}`,
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: customReviewInput,
      })
    },
  )
  await page.route(
    "**/api/v1/review-tasks/custom-review-inputs/export?**",
    async (route) => {
      exportAuthorization = route.request().headers().authorization || ""
      await route.fulfill({
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: {
          "Content-Disposition":
            "attachment; filename*=UTF-8''%E8%87%AA%E5%AE%9A%E4%B9%89%E5%AE%A1%E6%9F%A5%E8%BE%93%E5%85%A5%E7%BB%9F%E8%AE%A1_20260818.xlsx",
          "Access-Control-Expose-Headers": "Content-Disposition",
        },
        body: "mock xlsx content",
      })
    },
  )

  await page.goto("/admin/custom-review-inputs")
  await expect(
    page.getByRole("heading", { name: "自定义审查输入统计" }),
  ).toBeVisible()
  await expect(page.getByText("统计用户")).toBeVisible()
  const inputRow = page.getByRole("row").filter({ hasText: "统计用户" })
  await expect(inputRow.getByText("Word：已提供")).toBeVisible()
  await expect(inputRow.getByText("Excel：未提供")).toBeVisible()
  await expect(inputRow.getByText("PDF：已提供")).toBeVisible()

  await page.getByLabel("规则关键词").fill("恢复路径")
  await page.getByLabel("用户").fill("统计用户")
  await page.getByLabel("部门").fill("研发部")
  await page.getByLabel("SVN 地址").fill("project")
  await page.getByLabel("版本号").fill("101")
  await page.getByLabel("审查模式").click()
  await page.getByRole("option", { name: "全量代码审查" }).click()
  await page.getByLabel("Word 材料").click()
  await page.getByRole("option", { name: "Word：已提供" }).click()
  await page.getByLabel("Excel 材料").click()
  await page.getByRole("option", { name: "Excel：未提供" }).click()
  await page.getByLabel("PDF 材料").click()
  await page.getByRole("option", { name: "PDF：已提供" }).click()
  await page.getByLabel("任务状态").click()
  await page.getByRole("option", { name: "失败" }).click()
  await page.getByRole("button", { name: "搜索" }).click()
  await expect
    .poll(() => listRequestUrl)
    .toContain("keyword=%E6%81%A2%E5%A4%8D%E8%B7%AF%E5%BE%84")
  expect(listRequestUrl).toContain(
    "user_name=%E7%BB%9F%E8%AE%A1%E7%94%A8%E6%88%B7",
  )
  expect(listRequestUrl).toContain(
    "department_name=%E7%A0%94%E5%8F%91%E9%83%A8",
  )
  expect(listRequestUrl).toContain("svn_url=project")
  expect(listRequestUrl).toContain("revision=101")
  expect(listRequestUrl).toContain("mode=new_revision_full")
  expect(listRequestUrl).toContain("has_word_material=true")
  expect(listRequestUrl).toContain("has_excel_material=false")
  expect(listRequestUrl).toContain("has_pdf_material=true")
  expect(listRequestUrl).toContain("status=failed")

  await page.getByRole("button", { name: "查看自定义审查输入详情" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("保护条件必须具有明确恢复路径。")).toBeVisible()
  await expect(dialog.getByText("变更代码审查")).toBeVisible()
  await page.keyboard.press("Escape")

  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 Excel" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe("自定义审查输入统计_20260818.xlsx")
  expect(exportAuthorization).toBe("Bearer test-token")
})

test("自定义审查输入页显示空结果和加载失败状态", async ({ page }) => {
  await mockAdmin(page)
  let failRequests = false
  await page.route(
    "**/api/v1/review-tasks/custom-review-inputs?**",
    async (route) => {
      if (failRequests) {
        await route.fulfill({ status: 500, body: "failed" })
        return
      }
      await route.fulfill({
        contentType: "application/json",
        json: { data: [], count: 0 },
      })
    },
  )
  await page.goto("/admin/custom-review-inputs")
  await expect(
    page.getByText("没有符合当前筛选条件的自定义审查输入。"),
  ).toBeVisible()

  failRequests = true
  await page.getByLabel("规则关键词").fill("失败测试")
  await page.getByRole("button", { name: "搜索" }).click()
  await expect(page.getByRole("alert")).toContainText("自定义审查输入加载失败")
})

test("普通用户没有统计入口且路由会被拦截", async ({ page }) => {
  await mockCurrentUser(page, { ...adminUser, role: "user" })
  let inputStatsRequested = false
  await page.route(
    "**/api/v1/review-tasks/custom-review-inputs?**",
    async (route) => {
      inputStatsRequested = true
      await route.fulfill({
        contentType: "application/json",
        json: { data: [], count: 0 },
      })
    },
  )

  await page.goto("/")
  await expect(
    page.getByText("自定义审查输入统计", { exact: true }),
  ).toHaveCount(0)
  await page.goto("/admin/custom-review-inputs")
  await expect(page).toHaveURL(/\/$/)
  expect(inputStatsRequested).toBe(false)
})

test("自定义审查输入页在列表响应前显示加载状态", async ({ page }) => {
  await mockAdmin(page)
  let releaseResponse: (() => void) | undefined
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve
  })
  await page.route(
    "**/api/v1/review-tasks/custom-review-inputs?**",
    async (route) => {
      await responseGate
      await route.fulfill({
        contentType: "application/json",
        json: { data: [customReviewInput], count: 1 },
      })
    },
  )

  await page.goto("/admin/custom-review-inputs")
  await expect(page.getByText("加载中...")).toBeVisible()
  releaseResponse?.()
  await expect(page.getByText("统计用户")).toBeVisible()
})
