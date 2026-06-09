import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { testApiKey, testSvnPassword } from "./config.ts"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { logInWithKey, logInWithSvn } from "./utils/user"

function countMultipartField(
  body: Buffer | null,
  contentType: string | undefined,
  fieldName: string,
) {
  if (!body || !contentType?.includes("multipart/form-data")) {
    return 0
  }

  const bodyText = body.toString("latin1")
  return bodyText.match(new RegExp(`name="${fieldName}"`, "g"))?.length ?? 0
}

const feedbackList = {
  data: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      user_id: "22222222-2222-2222-2222-222222222222",
      user_name: "测试用户",
      svn_username: "feedback_user",
      description: "任务按钮点击无响应",
      has_screenshot: true,
      screenshot_count: 2,
      screenshots: [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          file_name: "feedback-1.png",
          content_type: "image/png",
          file_size: 128,
          sort_order: 1,
          created_at: "2026-06-09T04:00:00Z",
        },
        {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          file_name: "feedback-2.png",
          content_type: "image/png",
          file_size: 256,
          sort_order: 2,
          created_at: "2026-06-09T04:00:00Z",
        },
      ],
      screenshot_name: "feedback.png",
      screenshot_content_type: "image/png",
      screenshot_size: 128,
      status: "pending",
      created_at: "2026-06-09T04:00:00Z",
      updated_at: "2026-06-09T04:00:00Z",
    },
  ],
  count: 1,
}

test.describe("意见管理", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("普通用户可以进入意见管理并提交意见", async ({ page }) => {
    const svnUsername = uniqueSvnUsername()
    const uploadDir = tmpdir()
    const firstScreenshotPath = join(uploadDir, `feedback-${Date.now()}-1.png`)
    const secondScreenshotPath = join(uploadDir, `feedback-${Date.now()}-2.png`)
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8BQDwAFgwJ/lWfJxQAAAABJRU5ErkJggg==",
      "base64",
    )
    await writeFile(firstScreenshotPath, pngBuffer)
    await writeFile(secondScreenshotPath, pngBuffer)

    await createUser({ svnUsername })
    let submittedScreenshotCount = 0
    let submittedLegacyScreenshotCount = 0
    await page.route("**/api/v1/feedback?**", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataBuffer()
        const contentType = route.request().headers()["content-type"]
        submittedScreenshotCount = countMultipartField(
          body,
          contentType,
          "screenshots",
        )
        submittedLegacyScreenshotCount = countMultipartField(
          body,
          contentType,
          "screenshot",
        )
        await route.fulfill({
          contentType: "application/json",
          json: {
            id: "33333333-3333-3333-3333-333333333333",
            user_id: "22222222-2222-2222-2222-222222222222",
            description: "页面提交意见",
            has_screenshot: true,
            screenshot_count: 2,
            screenshots: [],
            status: "pending",
            created_at: "2026-06-09T04:00:00Z",
            updated_at: "2026-06-09T04:00:00Z",
          },
        })
        return
      }

      await route.fulfill({
        contentType: "application/json",
        json: { data: [], count: 0 },
      })
    })

    await logInWithSvn(page, svnUsername, testSvnPassword)

    await expect(page.getByRole("link", { name: "意见管理" })).toBeVisible()
    await page.getByRole("link", { name: "意见管理" }).click()
    await expect(page).toHaveURL(/\/feedback/)
    await expect(page.getByRole("heading", { name: "意见管理" })).toBeVisible()

    await page.getByRole("button", { name: "提交意见" }).click()
    const dialog = page.getByRole("dialog", { name: "提交意见" })
    await dialog.getByLabel("问题描述").fill("页面提交意见")
    await dialog
      .getByLabel("截图（可选）")
      .setInputFiles([firstScreenshotPath, secondScreenshotPath])
    await dialog.getByRole("button", { name: "提交", exact: true }).click()

    await expect(page.getByText("意见已提交")).toBeVisible()
    await expect(page.getByRole("dialog")).not.toBeVisible()
    expect(submittedScreenshotCount).toBe(2)
    expect(submittedLegacyScreenshotCount).toBe(0)
  })

  test("管理员可以筛选、查看截图并修改状态", async ({ page }) => {
    let statusUpdated = false
    let legacyScreenshotRequested = false
    const requestedScreenshotUrls: string[] = []
    await page.route("**/api/v1/feedback?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: feedbackList,
      })
    })
    await page.route("**/api/v1/feedback/*/screenshot", async (route) => {
      legacyScreenshotRequested = true
      await route.fulfill({ status: 500, body: "legacy screenshot endpoint" })
    })
    await page.route("**/api/v1/feedback/*/screenshots/*", async (route) => {
      requestedScreenshotUrls.push(route.request().url())
      await route.fulfill({
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8BQDwAFgwJ/lWfJxQAAAABJRU5ErkJggg==",
          "base64",
        ),
        contentType: "image/png",
      })
    })
    await page.route("**/api/v1/feedback/*/status", async (route) => {
      statusUpdated = true
      await route.fulfill({
        contentType: "application/json",
        json: {
          ...feedbackList.data[0],
          status: "processing",
        },
      })
    })
    await logInWithKey(page, testApiKey)

    await page.getByRole("link", { name: "意见管理" }).click()
    await expect(page.getByPlaceholder("提交人姓名")).toBeVisible()
    await page.getByPlaceholder("提交人姓名").fill("测试用户")
    await page.getByRole("button", { name: "搜索" }).click()
    await expect(page.getByText("任务按钮点击无响应")).toBeVisible()
    await expect(page.getByRole("button", { name: "2 张" })).toBeVisible()

    await page.getByRole("button", { name: "详情" }).click()
    await expect(page.getByRole("dialog", { name: "意见详情" })).toBeVisible()
    await expect.poll(() => requestedScreenshotUrls.length).toBe(2)
    expect(
      requestedScreenshotUrls.every((url) => url.includes("/screenshots/")),
    ).toBe(true)
    expect(legacyScreenshotRequested).toBe(false)
    await page.keyboard.press("Escape")

    await page.getByRole("combobox").filter({ hasText: "待处理" }).click()
    await page.getByRole("option", { name: "处理中" }).click()
    await expect.poll(() => statusUpdated).toBe(true)
  })
})
