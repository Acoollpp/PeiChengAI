import { expect, test } from "@playwright/test"

const randomTitle = () =>
  `重点方向${Math.random().toString(36).substring(2, 10)}`

test("Admin review focus directions page is accessible from sidebar", async ({
  page,
}) => {
  await page.goto("/admin/review-focus-directions")

  await expect(
    page.getByRole("heading", { name: "重点审查方向" }),
  ).toBeVisible()
  await expect(
    page.getByText("管理方向库条目，并将用户常用输入沉淀为可复用方向。"),
  ).toBeVisible()
  await expect(page.getByRole("tab", { name: "方向库" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.getByRole("tab", { name: "用户输入统计" })).toHaveAttribute(
    "aria-selected",
    "false",
  )
  await expect(page.getByRole("heading", { name: "方向库" })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "用户输入统计" }),
  ).not.toBeVisible()
  await expect(page.getByRole("button", { name: "新增方向" })).toBeVisible()

  await page.getByRole("tab", { name: "用户输入统计" }).click()
  await expect(
    page.getByRole("heading", { name: "用户输入统计" }),
  ).toBeVisible()
  await expect(page.getByRole("heading", { name: "方向库" })).not.toBeVisible()
  await expect(page.getByRole("button", { name: "新增方向" })).not.toBeVisible()

  await page.getByRole("tab", { name: "方向库" }).click()
  await expect(page.getByRole("button", { name: "新增方向" })).toBeVisible()
})

test("Admin can create, edit, toggle and delete review focus direction", async ({
  page,
}) => {
  await page.goto("/items")
  const departmentNameA = `重点部门A${Date.now()}`
  const departmentNameB = `重点部门B${Date.now()}`

  await page.getByRole("button", { name: "新增部门" }).click()
  await page.getByLabel("部门名称").fill(departmentNameA)
  await page.getByRole("button", { name: "保存" }).click()
  await expect(page.getByText("部门创建成功")).toBeVisible()

  await page.getByRole("button", { name: "新增部门" }).click()
  await page.getByLabel("部门名称").fill(departmentNameB)
  await page.getByRole("button", { name: "保存" }).click()
  await expect(page.getByText("部门创建成功")).toBeVisible()

  await page.goto("/admin/review-focus-directions")

  const title = randomTitle()
  const updatedTitle = `${title}已更新`
  const content = `请重点关注 ${title} 的异常处理和边界条件。`
  const updatedContent = `${content} 同时检查日志是否完整。`

  await page.getByRole("button", { name: "新增方向" }).click()
  await page.getByLabel("标题").fill(title)
  await page.getByLabel("内容").fill(content)
  await page.getByRole("button", { name: "选择部门" }).click()
  await page.getByRole("checkbox", { name: departmentNameA }).check()
  await page.getByRole("checkbox", { name: departmentNameB }).check()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "保存" }).click()

  await expect(page.getByText("方向创建成功")).toBeVisible()
  const row = page.getByRole("row").filter({ hasText: title })
  await expect(row.getByText(departmentNameA)).toBeVisible()
  await expect(row.getByText(departmentNameB)).toBeVisible()
  await expect(row.getByText("启用")).toBeVisible()

  await row.getByRole("button", { name: "编辑" }).click()
  await page.getByLabel("标题").fill(updatedTitle)
  await page.getByLabel("内容").fill(updatedContent)
  await page.getByRole("button", { name: "保存" }).click()

  await expect(page.getByText("方向更新成功")).toBeVisible()
  const updatedRow = page.getByRole("row").filter({ hasText: updatedTitle })
  await expect(updatedRow.getByText(updatedContent)).toBeVisible()

  await updatedRow.getByRole("button", { name: "停用" }).click()
  await expect(page.getByText("方向已停用")).toBeVisible()
  await expect(updatedRow.getByText("停用")).toBeVisible()

  await updatedRow.getByRole("button", { name: "删除" }).click()
  await page.getByRole("button", { name: "确认删除" }).click()

  await expect(page.getByText("方向删除成功")).toBeVisible()
  await expect(
    page.getByRole("row").filter({ hasText: updatedTitle }),
  ).not.toBeVisible()
})

test("Admin can settle usage stat into review focus direction", async ({
  page,
}) => {
  await page.goto("/admin/review-focus-directions")
  await page.getByRole("tab", { name: "用户输入统计" }).click()

  const statsSection = page.getByTestId("review-focus-usage-stats")
  await expect(statsSection).toBeVisible()

  const settleButtons = statsSection.getByRole("button", { name: "沉淀" })
  const count = await settleButtons.count()
  test.skip(count === 0, "当前测试环境暂无用户输入统计")
  await expect(
    statsSection.getByRole("button", { name: "沉淀为方向" }),
  ).toHaveCount(0)

  const statRow = statsSection.getByRole("row").nth(1)
  const content = (await statRow.getByRole("cell").first().innerText()).trim()

  await statRow.getByRole("button", { name: "沉淀" }).click()
  await page.getByRole("button", { name: "保存" }).click()

  await expect(page.getByText("方向创建成功")).toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: content })).toBeVisible()
})

test("Admin can mark usage stat used and unused", async ({ page }) => {
  await page.goto("/admin/review-focus-directions")
  await page.getByRole("tab", { name: "用户输入统计" }).click()

  const statsSection = page.getByTestId("review-focus-usage-stats")
  const markButtons = statsSection.getByRole("button", { name: "标记已使用" })
  const count = await markButtons.count()
  test.skip(count === 0, "当前测试环境暂无未使用统计")

  const firstRow = statsSection.getByRole("row").nth(1)
  await firstRow.getByRole("button", { name: "标记已使用" }).click()
  await expect(page.getByText("使用状态更新成功")).toBeVisible()
  await expect(firstRow.getByText("已使用")).toBeVisible()

  await firstRow.getByRole("button", { name: "标记未使用" }).click()
  await expect(page.getByText("使用状态更新成功")).toBeVisible()
  await expect(firstRow.getByText("未使用")).toBeVisible()
})

test("Admin can trigger usage stats Excel export", async ({ page }) => {
  await page.goto("/admin/review-focus-directions")
  await page.getByRole("tab", { name: "用户输入统计" }).click()

  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 Excel" }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain("重点审查方向用户输入统计_")
  expect(download.suggestedFilename()).toContain(".xlsx")
})
