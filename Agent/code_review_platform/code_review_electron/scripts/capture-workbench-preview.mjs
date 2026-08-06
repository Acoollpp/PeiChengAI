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

    const taskManagementMetrics = await page.evaluate(() => {
      const selectors = {
        create: '.wb-create-panel',
        overview: '.wb-overview',
        execution: '.wb-execution-section',
        reports: '.wb-management-reports'
      }
      const regions = Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect()
          return [name, rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height } : null]
        })
      )
      const rows = [...document.querySelectorAll('.wb-task-table-row, .wb-management-report-row')]
      const executionRect = document.querySelector('.wb-execution-section')?.getBoundingClientRect()
      const failedRect = document.querySelector('.wb-task-table-row.is-failed')?.getBoundingClientRect()
      const cellsDoNotOverlap = rows.every((row) => {
        const cells = [...row.children].map((cell) => cell.getBoundingClientRect())
        return cells.every((cell, index) => index === cells.length - 1 || cell.right <= cells[index + 1].left + 1)
      })
      return {
        regions,
        cellsDoNotOverlap,
        rowCount: rows.length,
        failedTaskVisible: Boolean(
          executionRect && failedRect && failedRect.top >= executionRect.top && failedRect.bottom <= executionRect.bottom
        )
      }
    })
    for (const [region, rect] of Object.entries(taskManagementMetrics.regions)) {
      assert(rect, `${label}：未找到 ${region} 区域。`)
      assert(rect.height > 0, `${label}：${region} 区域高度为 0。`)
      assert(rect.top >= 0 && rect.top < viewport.height, `${label}：${region} 区域未进入首屏。`)
    }
    assert(
      taskManagementMetrics.regions.execution.bottom <= taskManagementMetrics.regions.reports.top,
      `${label}：执行与等待表格和报告表格发生重叠。`
    )
    assert(taskManagementMetrics.rowCount > 0, `${label}：任务管理表格没有 fixture 行。`)
    assert(taskManagementMetrics.cellsDoNotOverlap, `${label}：任务或报告表格列发生重叠。`)
    assert(taskManagementMetrics.failedTaskVisible, `${label}：失败任务和重试入口未在执行表格首屏可见。`)
    await page.screenshot({
      path: join(screenshotDirectory, `task-management-${label}.png`),
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

    await page.getByRole('button', { name: '报告中心', exact: true }).click()
    await page.getByRole('heading', { name: '报告中心', exact: true }).waitFor()
    await assertNoDocumentOverflow(page, `${label} 报告中心`)
    const reportCenterMetrics = await page.evaluate(() => {
      const layout = document.querySelector('.wb-layout')
      const grid = document.querySelector('.wb-report-center-grid')?.getBoundingClientRect()
      const index = document.querySelector('.wb-report-index')?.getBoundingClientRect()
      const markdown = document.querySelector('.wb-markdown-panel')?.getBoundingClientRect()
      const title = document.querySelector('.wb-report-center .wb-workspace-title > div')?.getBoundingClientRect()
      const actionsElement = document.querySelector('.wb-report-center .wb-report-actions')
      const actions = actionsElement?.getBoundingClientRect()
      const pdfButton = [...(actionsElement?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim().includes('查看PDF报告'))
        ?.getBoundingClientRect()
      const markdownScroll = document.querySelector('.wb-markdown-scroll')
      const navButtons = [...document.querySelectorAll('.wb-preview-controls button')].map((button) =>
        button.getBoundingClientRect()
      )
      const navButtonsDoNotOverlap = navButtons.every(
        (button, indexValue) =>
          indexValue === navButtons.length - 1 || button.right <= navButtons[indexValue + 1].left + 1
      )
      return {
        fullView: layout?.classList.contains('is-full-view') ?? false,
        createPanelAbsent: !document.querySelector('.wb-create-panel'),
        gridWithinViewport: Boolean(
          grid && grid.left >= 0 && grid.top >= 0 && grid.right <= innerWidth && grid.bottom <= innerHeight
        ),
        columnsDoNotOverlap: Boolean(index && markdown && index.right <= markdown.left + 1),
        markdownWidth: markdown?.width ?? 0,
        markdownScrollable: Boolean(markdownScroll && markdownScroll.scrollHeight > markdownScroll.clientHeight),
        markdownHeadingVisible: Boolean(document.querySelector('.wb-markdown-scroll h1')),
        titleClearsActions: Boolean(title && actions && title.right <= actions.left + 1),
        titleClearsPdfButton: Boolean(title && pdfButton && title.right <= pdfButton.left + 1),
        actionsWithinViewport: Boolean(
          actions && actions.left >= 0 && actions.top >= 0 &&
          actions.right <= innerWidth && actions.bottom <= innerHeight
        ),
        pdfButtonWithinViewport: Boolean(
          pdfButton && pdfButton.left >= 0 && pdfButton.top >= 0 &&
          pdfButton.right <= innerWidth && pdfButton.bottom <= innerHeight
        ),
        navButtonsDoNotOverlap
      }
    })
    assert(reportCenterMetrics.fullView, `${label}：报告中心未占满主内容区。`)
    assert(reportCenterMetrics.createPanelAbsent, `${label}：报告中心仍显示创建任务左栏。`)
    assert(reportCenterMetrics.gridWithinViewport, `${label}：报告中心双栏超出视口。`)
    assert(reportCenterMetrics.columnsDoNotOverlap, `${label}：报告索引与 Markdown 区发生重叠。`)
    assert(reportCenterMetrics.markdownWidth > 0, `${label}：Markdown 区宽度为 0。`)
    assert(reportCenterMetrics.markdownScrollable, `${label}：Markdown 区没有形成独立滚动。`)
    assert(reportCenterMetrics.markdownHeadingVisible, `${label}：Markdown 标题未渲染。`)
    assert(reportCenterMetrics.titleClearsActions, `${label}：报告标题与报告操作区发生重叠。`)
    assert(reportCenterMetrics.titleClearsPdfButton, `${label}：报告标题与 PDF 按钮发生重叠。`)
    assert(reportCenterMetrics.actionsWithinViewport, `${label}：报告操作区超出视口。`)
    assert(reportCenterMetrics.pdfButtonWithinViewport, `${label}：PDF 按钮超出视口。`)
    assert(reportCenterMetrics.navButtonsDoNotOverlap, `${label}：顶部三导航发生重叠。`)

    await page.locator('.wb-report-index button').filter({ hasText: 'SOC 滤波边界复查' }).click()
    await page.getByRole('heading', { name: 'SOC 滤波边界复查', exact: true }).waitFor()
    await page.screenshot({
      path: join(screenshotDirectory, `report-center-${label}.png`),
      animations: 'disabled'
    })
    await page.getByRole('button', { name: '查看PDF报告', exact: true }).click()
    await page.getByText('已打开《SOC 滤波边界复查》PDF 报告。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭提示', exact: true }).click()

    await page.getByRole('button', { name: '意见反馈', exact: true }).click()
    await page.getByLabel('问题描述', { exact: true }).fill(
      '任务在环境检查阶段停留，重新进入页面后仍未推进，请协助核对本机环境状态。'
    )
    await page.getByRole('button', { name: '添加截图', exact: true }).click()
    await page.getByRole('button', { name: '添加截图', exact: true }).click()
    await assertNoDocumentOverflow(page, `${label} 意见反馈`)
    const feedbackMetrics = await page.evaluate(() => {
      const form = document.querySelector('.wb-feedback-form')?.getBoundingClientRect()
      const actions = [...document.querySelectorAll('.wb-feedback-actions button')].map((button) =>
        button.getBoundingClientRect()
      )
      const screenshotRows = [...document.querySelectorAll('.wb-feedback-file-list > div')]
      const screenshotContentDoesNotOverlap = screenshotRows.every((row) => {
        const cells = [...row.children].map((cell) => cell.getBoundingClientRect())
        return cells.every(
          (cell, indexValue) =>
            indexValue === cells.length - 1 || cell.right <= cells[indexValue + 1].left + 1
        )
      })
      return {
        createPanelAbsent: !document.querySelector('.wb-create-panel'),
        formWithinViewport: Boolean(
          form && form.left >= 0 && form.top >= 0 && form.right <= innerWidth && form.bottom <= innerHeight
        ),
        actionsDoNotOverlap: Boolean(
          actions.length === 2 && actions[0].right <= actions[1].left + 1
        ),
        screenshotCount: screenshotRows.length,
        screenshotContentDoesNotOverlap
      }
    })
    assert(feedbackMetrics.createPanelAbsent, `${label}：意见反馈仍显示创建任务左栏。`)
    assert(feedbackMetrics.formWithinViewport, `${label}：意见反馈表单超出视口。`)
    assert(feedbackMetrics.actionsDoNotOverlap, `${label}：意见反馈操作按钮发生重叠。`)
    assert(feedbackMetrics.screenshotCount === 2, `${label}：未显示两个反馈截图 fixture。`)
    assert(
      feedbackMetrics.screenshotContentDoesNotOverlap,
      `${label}：反馈截图名称、大小或移除按钮发生重叠。`
    )
    await page.screenshot({
      path: join(screenshotDirectory, `feedback-${label}.png`),
      animations: 'disabled'
    })

    assert(consoleErrors.length === 0, `${label}：控制台错误：${consoleErrors.join('；')}`)
    console.log(`${label} 通过：三视图布局、任务表格、Markdown/PDF、反馈表单、选择器和错误态均符合断言。`)
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
