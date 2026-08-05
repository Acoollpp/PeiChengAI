import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const screenshotDirectory = join(projectRoot, 'docs', 'issue-37', 'screenshots')
const host = '127.0.0.1'
const port = 4317
const previewUrl = `http://${host}:${port}/preview.html`
const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 }
]

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const waitForServer = async (server, readOutput) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`预览服务器提前退出。\n${readOutput()}`)
    }
    try {
      const response = await fetch(previewUrl)
      if (response.ok) return
    } catch {
      // Vite 仍在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`等待预览服务器超时。\n${readOutput()}`)
}

const stopServer = async (server) => {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ])
  if (server.exitCode === null) server.kill('SIGKILL')
}

const assertNoDocumentOverflow = async (page, label) => {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
  assert(!hasOverflow, `${label}：页面出现横向溢出。`)
}

const captureViewport = async (browser, viewport) => {
  const label = `${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport })
  const consoleErrors = []
  page.on('console', (entry) => {
    if (entry.type() === 'error') consoleErrors.push(entry.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })

  try {
    await page.goto(previewUrl, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '填入验收样例', exact: true }).click()
    await assertNoDocumentOverflow(page, `${label} 工作台`)

    const firstViewportMetrics = await page.evaluate(() => {
      const selectors = {
        create: '.wb-create-panel',
        overview: '.wb-overview',
        execution: '.wb-execution-section',
        reports: '.wb-report-section'
      }
      return Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect()
          return [name, rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null]
        })
      )
    })
    for (const [region, rect] of Object.entries(firstViewportMetrics)) {
      assert(rect, `${label}：未找到 ${region} 区域。`)
      assert(rect.height > 0, `${label}：${region} 区域高度为 0。`)
      assert(rect.top >= 0 && rect.top < viewport.height, `${label}：${region} 区域未进入首屏。`)
    }
    assert(
      firstViewportMetrics.reports.top < viewport.height,
      `${label}：报告区 top=${firstViewportMetrics.reports.top}，未进入首屏。`
    )
    await page.screenshot({
      path: join(screenshotDirectory, `workbench-${label}.png`),
      animations: 'disabled'
    })

    await page.getByRole('button', { name: '调整', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '选择审查项', exact: true })
    await dialog.waitFor()
    await assertNoDocumentOverflow(page, `${label} 选择器`)
    const selectorMetrics = await page.evaluate(() => {
      const modal = document.querySelector('.wb-selector')
      const detail = document.querySelector('.wb-detail-scroll')
      const modalRect = modal?.getBoundingClientRect()
      const fileRows = [...document.querySelectorAll('.wb-file-row')]
      const filesDoNotOverlap = fileRows.every((row) => {
        const name = row.querySelector(':scope > span')?.getBoundingClientRect()
        const size = row.querySelector(':scope > small')?.getBoundingClientRect()
        const action = row.querySelector(':scope > button')?.getBoundingClientRect()
        return Boolean(
          name && size && action && name.right <= size.left + 1 && size.right <= action.left + 1
        )
      })
      return {
        modalWithinViewport: Boolean(
          modalRect &&
            modalRect.left >= 0 &&
            modalRect.top >= 0 &&
            modalRect.right <= innerWidth &&
            modalRect.bottom <= innerHeight
        ),
        detailScrollable: Boolean(detail && detail.scrollHeight > detail.clientHeight),
        filesDoNotOverlap,
        fileRowCount: fileRows.length
      }
    })
    assert(selectorMetrics.modalWithinViewport, `${label}：选择器超出视口。`)
    assert(selectorMetrics.detailScrollable, `${label}：右侧详情没有形成独立滚动。`)
    assert(selectorMetrics.fileRowCount === 2, `${label}：未显示两个长文件名 fixture。`)
    assert(selectorMetrics.filesDoNotOverlap, `${label}：长文件名、大小或移除按钮发生重叠。`)
    const extraRules = await page.getByLabel('DS-01 额外规则', { exact: true }).inputValue()
    assert(extraRules.length > 40, `${label}：长额外规则 fixture 未显示。`)
    await page.screenshot({
      path: join(screenshotDirectory, `selector-${label}.png`),
      animations: 'disabled'
    })

    await dialog
      .locator('.wb-selector-footer')
      .getByRole('button', { name: '取消', exact: true })
      .click()
    await page
      .getByLabel('SVN 地址')
      .fill('这是一个故意不带协议且非常长的 SVN 地址用来验证中文错误提示不会覆盖后续输入控件')
    await page.getByLabel('SVN 地址').blur()
    await page.getByLabel('旧 revision').fill('20')
    await page.getByLabel('新 revision').fill('10')
    await page.getByLabel('新 revision').blur()
    await assertNoDocumentOverflow(page, `${label} 错误态`)
    const errorMetrics = await page.evaluate(() => {
      const panel = document.querySelector('.wb-create-panel')
      const alerts = [...document.querySelectorAll('.wb-create-panel [role="alert"]')]
      const revisionRow = document.querySelector('.wb-revision-row')?.getBoundingClientRect()
      const svnError = alerts[0]?.getBoundingClientRect()
      const selection = document.querySelector('.wb-selection-summary')?.getBoundingClientRect()
      const revisionError = alerts[1]?.getBoundingClientRect()
      const alertsOverlap = alerts.some((alert, index) =>
        alerts.slice(index + 1).some((other) => {
          const first = alert.getBoundingClientRect()
          const second = other.getBoundingClientRect()
          return (
            first.left < second.right &&
            first.right > second.left &&
            first.top < second.bottom &&
            first.bottom > second.top
          )
        })
      )
      return {
        panelHorizontalOverflow: Boolean(panel && panel.scrollWidth > panel.clientWidth),
        alertCount: alerts.length,
        alertsOverlap,
        svnErrorClearsRevision: Boolean(svnError && revisionRow && svnError.bottom <= revisionRow.top),
        revisionErrorClearsSelection: Boolean(
          revisionError && selection && revisionError.bottom <= selection.top
        ),
        submitDisabled: Boolean(document.querySelector('.wb-submit-button')?.disabled)
      }
    })
    assert(!errorMetrics.panelHorizontalOverflow, `${label}：错误态创建面板横向溢出。`)
    assert(errorMetrics.alertCount === 2, `${label}：没有显示两条长中文错误。`)
    assert(!errorMetrics.alertsOverlap, `${label}：两条错误提示发生重叠。`)
    assert(errorMetrics.svnErrorClearsRevision, `${label}：SVN 错误与 revision 输入重叠。`)
    assert(errorMetrics.revisionErrorClearsSelection, `${label}：revision 错误与审查项区域重叠。`)
    assert(errorMetrics.submitDisabled, `${label}：错误态仍可提交。`)
    await page.screenshot({
      path: join(screenshotDirectory, `errors-${label}.png`),
      animations: 'disabled'
    })

    assert(consoleErrors.length === 0, `${label}：控制台错误：${consoleErrors.join('；')}`)
    console.log(`${label} 通过：四区首屏、选择器滚动、长内容和错误态均符合断言。`)
  } finally {
    await page.close()
  }
}

await mkdir(screenshotDirectory, { recursive: true })
let serverOutput = ''
const viteEntry = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const server = spawn(
  process.execPath,
  [viteEntry, 'src/renderer', '--host', host, '--port', String(port), '--strictPort'],
  { cwd: projectRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
)
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString()
})
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString()
})

let browser
try {
  await waitForServer(server, () => serverOutput)
  browser = await chromium.launch({ headless: true })
  for (const viewport of viewports) await captureViewport(browser, viewport)
  console.log(`截图已写入 ${screenshotDirectory}`)
} finally {
  await browser?.close()
  await stopServer(server)
}
