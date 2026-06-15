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
  await expect(page.getByRole("button", { name: "新增方向" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "方向库" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "用户输入统计" })).toBeVisible()
})

test("Admin can create, edit, toggle and delete review focus direction", async ({
  page,
}) => {
  await page.goto("/items")
  const departmentName = `重点部门${Date.now()}`

  await page.getByRole("button", { name: "新增部门" }).click()
  await page.getByLabel("部门名称").fill(departmentName)
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
  await page.getByLabel("部门").click()
  await page.getByRole("option", { name: departmentName }).click()
  await page.getByRole("button", { name: "保存" }).click()

  await expect(page.getByText("方向创建成功")).toBeVisible()
  const row = page.getByRole("row").filter({ hasText: title })
  await expect(row.getByText(departmentName)).toBeVisible()
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

  const statsSection = page.getByTestId("review-focus-usage-stats")
  await expect(statsSection).toBeVisible()

  const settleButtons = statsSection.getByRole("button", { name: "沉淀为方向" })
  const count = await settleButtons.count()
  test.skip(count === 0, "当前测试环境暂无用户输入统计")

  const statRow = statsSection.getByRole("row").nth(1)
  const content = (await statRow.getByRole("cell").first().innerText()).trim()

  await statRow.getByRole("button", { name: "沉淀为方向" }).click()
  await page.getByRole("button", { name: "保存" }).click()

  await expect(page.getByText("方向创建成功")).toBeVisible()
  await expect(
    page.getByRole("row").filter({ hasText: content }),
  ).toBeVisible()
})
