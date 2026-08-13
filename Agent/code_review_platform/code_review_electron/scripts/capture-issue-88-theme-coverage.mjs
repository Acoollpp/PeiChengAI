import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const screenshotDirectory = join(projectRoot, 'docs', 'issue-88', 'screenshots')
const host = '127.0.0.1'
const port = 4322
const appUrl = `http://${host}:${port}/index.html`
const harnessUrl = `http://${host}:${port}/production-harness.html`
const clientThemeStorageKey = 'codeReview.clientTheme'
const viewports = [
  { width: 920, height: 620 },
  { width: 1180, height: 760 },
  { width: 1440, height: 900 }
]
const themes = ['light', 'dark']
const transparentPng1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
)

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const waitForServer = async (server, readOutput) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`预览服务器提前退出。\n${readOutput()}`)
    }
    try {
      const response = await fetch(appUrl)
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

const rgbToRelativeLuminance = ({ r, g, b }) => {
  const linear = [r, g, b].map((value) => {
    const channel = value / 255
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

const contrastRatio = (foreground, background) => {
  const lighter = Math.max(rgbToRelativeLuminance(foreground), rgbToRelativeLuminance(background))
  const darker = Math.min(rgbToRelativeLuminance(foreground), rgbToRelativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

const parseRgb = (value) => {
  const match = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value)
  assert(match, `无法解析颜色：${value}`)
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3])
  }
}

const assertNoDocumentOverflow = async (page, label) => {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
  assert(!hasOverflow, `${label}：页面出现横向溢出。`)
}

const assertReadable = async (page, selector, label, minimum = 4.5) => {
  const metrics = await page.locator(selector).first().evaluate((element) => {
    const parseColor = (value) => {
      const match = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(value)
      if (!match) return { r: 255, g: 255, b: 255, a: 1 }
      const alphaValue = match[4]
      const alpha = alphaValue === undefined
        ? 1
        : alphaValue.endsWith('%')
          ? Number.parseFloat(alphaValue) / 100
          : Number(alphaValue)
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: Number.isFinite(alpha) ? alpha : 1
      }
    }
    const blend = (foreground, background) => {
      const alpha = foreground.a
      return {
        r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
        g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
        b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
        a: 1
      }
    }
    const resolveBackgroundColor = (start) => {
      let resolved = { r: 255, g: 255, b: 255, a: 1 }
      const layers = []
      let current = start
      while (current) {
        const style = getComputedStyle(current)
        const color = parseColor(style.backgroundColor)
        if (color.a > 0) layers.push(color)
        current = current.parentElement
      }
      for (const layer of layers.reverse()) {
        resolved = blend(layer, resolved)
      }
      return `rgb(${resolved.r}, ${resolved.g}, ${resolved.b})`
    }
    const style = getComputedStyle(element)
    return {
      color: style.color,
      backgroundColor: resolveBackgroundColor(element),
      fontSize: Number.parseFloat(style.fontSize)
    }
  })
  const ratio = contrastRatio(parseRgb(metrics.color), parseRgb(metrics.backgroundColor))
  assert(ratio >= minimum, `${label}：对比度 ${ratio.toFixed(2)} 低于 ${minimum}。`)
  return { ...metrics, ratio }
}

const setTheme = async (page, theme) => {
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value)
    const applyTheme = () => {
      document.documentElement.dataset.theme = value
    }
    if (document.documentElement) {
      applyTheme()
    } else {
      document.addEventListener('DOMContentLoaded', applyTheme, { once: true })
    }
  }, [clientThemeStorageKey, theme])
}

const installLoginApiMock = async (page) => {
  await page.addInitScript(() => {
    const unsubscribe = () => undefined
    window.codeReview = {
      loadServerConfig: async () => ({ server_url: 'http://127.0.0.1:8001' }),
      loadCredentials: async () => null,
      saveCredentials: async () => undefined,
      clearCredentials: async () => undefined,
      keyLogin: async () => ({ needSvnBinding: false }),
      svnLogin: async () => undefined,
      getCurrentUser: async () => ({
        id: 'visual-login-user',
        full_name: '视觉验收用户',
        svn_username: null,
        department_id: 'dept-visual',
        department_name: '视觉验收部门',
        role: 'user'
      }),
      listAvailableDepartments: async () => ({ data: [], count: 0 }),
      setDepartment: async () => ({
        id: 'visual-login-user',
        full_name: '视觉验收用户',
        svn_username: null,
        department_id: 'dept-visual',
        department_name: '视觉验收部门',
        role: 'user'
      }),
      listTasks: async () => ({ data: [], count: 0 }),
      getTodayTaskStats: async () => ({ range: 'today', total: 0, success: 0, running: 0, failed_or_error: 0 }),
      readTaskReport: async () => '',
      preflightTask: async () => ({ status: 'valid' }),
      executeTask: async () => ({ taskId: 'visual-task', status: 'created' }),
      retryTask: async () => ({ taskId: 'visual-task', status: 'created' }),
      cancelTask: async () => ({ status: 'cancelled' }),
      openTaskLog: async () => ({ status: 'ready', logPath: '/tmp/task.log' }),
      hideTask: async () => ({ status: 'hidden' }),
      selectRequirementFile: async () => ({ status: 'cancelled' }),
      selectReviewMaterialFile: async () => ({ status: 'cancelled' }),
      getPathForPastedFile: async () => ({ status: 'cancelled' }),
      onTaskProgress: () => unsubscribe,
      downloadCurrentReport: async () => true,
      openPdfReport: async () => ({ status: 'ready', pdfPath: '/tmp/report.pdf' }),
      readReportAsset: async () => ({ dataUrl: '' }),
      showTaskCompletionNotification: async () => ({ status: 'shown' }),
      onTaskCompletionNotificationClicked: () => unsubscribe,
      installCodex: async () => ({ status: 'ready' }),
      installSvn: async () => ({ status: 'ready' }),
      installSkill: async () => ({ status: 'ready' }),
      checkEnvironment: async () => ({ status: 'ready' }),
      onEnvironmentProgress: () => unsubscribe,
      submitFeedback: async () => ({ id: 'visual-feedback', status: 'pending' }),
      openReportFeedbackWindow: async () => true,
      submitNegativeReportFeedback: async () => ({ taskId: 'visual-task', helpful: false, usefulIssuesText: null }),
      onReportFeedbackFocusAnchor: () => unsubscribe,
      onReportFeedbackSubmitted: () => unsubscribe,
      onIssueFeedbackSubmitted: () => unsubscribe,
      bindSvnCredential: async () => undefined,
      checkForAppUpdate: async () => ({
        status: 'current',
        policy: {
          platform: 'win32',
          arch: 'x64',
          current_version: '1.6.0',
          active_version: '1.6.0',
          minimum_supported_version: null,
          update_available: false,
          update_required: false
        }
      }),
      downloadAppUpdate: async () => true,
      installAppUpdate: async () => true,
      quitApp: async () => true,
      onAppUpdateAvailable: () => unsubscribe,
      onAppUpdateNotAvailable: () => unsubscribe,
      onAppUpdateDownloadProgress: () => unsubscribe,
      onAppUpdateProgress: () => unsubscribe,
      onAppUpdateDownloaded: () => unsubscribe,
      onAppUpdateError: () => unsubscribe,
      onAppUpdateRequired: () => unsubscribe
    }
  })
}

const installReportFeedbackApiMock = async (page) => {
  await page.addInitScript(() => {
    window.reportFeedback = {
      getContext: async () => ({
        taskId: 'visual-feedback-task',
        options: [
          { id: 'visual-option-1', text: '状态恢复事件缺失', anchorId: 'anchor-1' },
          { id: 'visual-option-2', text: '事务边界不完整', anchorId: 'anchor-2' }
        ]
      }),
      focusAnchor: async () => true,
      submit: async () => ({
        taskId: 'visual-feedback-task',
        helpful: true,
        usefulIssuesText: '状态恢复事件缺失'
      }),
      saveIssueDraft: async (payload) => ({
        id: payload.issueId,
        task_id: payload.taskId,
        issue_text: '问题',
        description_text: '描述',
        display_snapshot: '问题',
        order: 0,
        source: 'template_1_heading',
        location: {
          start_offset: 0,
          end_offset: 1,
          feedback_insertion_offset: 1,
          anchor_line: 0,
          heading_level: 3
        },
        helpful: payload.helpful,
        feedback_text: payload.feedbackText
      }),
      submitIssueFeedback: async () => ({
        status: 'submitted',
        taskId: 'visual-feedback-task',
        feedbackSubmittedAt: '2026-08-13T00:00:00Z',
        pdfPath: '/tmp/report.pdf',
        pdfReportName: 'report.pdf'
      }),
      close: async () => true
    }
  })
}

const selectStateMachineReviewItem = async (page) => {
  const trigger = page.getByRole('button', { name: '选择', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '选择审查项', exact: true })
  await dialog.waitFor()
  await dialog.getByLabel(/选择 DS-03 状态机(审核|审查)/).check()
  await dialog.getByRole('button', { name: '完成选择（1）', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}

const createRunningQueue = async (page) => {
  await selectStateMachineReviewItem(page)
  for (let taskIndex = 1; taskIndex <= 3; taskIndex += 1) {
    await page.getByLabel('SVN 地址', { exact: true }).fill(`svn://production-harness/issue-88-theme-${taskIndex}`)
    await page.getByLabel('旧 revision', { exact: true }).fill(String(taskIndex - 1))
    await page.getByLabel('新 revision', { exact: true }).fill(String(taskIndex + 100))
    await page.getByRole('button', { name: '创建审查任务', exact: true }).click()
    await page.getByRole('button', { name: '创建审查任务', exact: true }).waitFor()
  }
  await page.getByText('本机等待第 1 位', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.wb-task-table-row').length >= 3)
}

const addFeedbackScreenshot = async (page) => {
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '添加截图', exact: true }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'issue-88-theme-coverage.png',
    mimeType: 'image/png',
    buffer: transparentPng1x1
  })
  await page.locator('.wb-feedback-file-list strong').first().waitFor()
}

const focusByKeyboard = async (page, locator, label) => {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+L' : 'Control+L')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press('Tab')
    const isFocused = await locator.evaluate((element) => element === document.activeElement)
    if (isFocused) return
  }
  throw new Error(`${label}：无法通过键盘 Tab 聚焦目标控件。`)
}

const captureLogin = async (browser, viewport, theme) => {
  const label = `login-${theme}-${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport })
  await setTheme(page, theme)
  await installLoginApiMock(page)
  const consoleErrors = []
  page.on('console', (entry) => {
    if (entry.type() === 'error') consoleErrors.push(entry.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })

  try {
    await page.goto(appUrl, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '代码审查平台', exact: true }).waitFor()
    await assertNoDocumentOverflow(page, label)
    await assertReadable(page, '.auth-card .auth-field input', `${label} 服务端输入`)
    const toggleLabel = theme === 'light' ? '切换到深色模式' : '切换到浅色模式'
    const toggle = page.getByRole('button', { name: toggleLabel, exact: true })
    await toggle.focus()
    const focusStyle = await toggle.evaluate((element) => {
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) }
    })
    assert(focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth >= 2, `${label}：主题按钮焦点不可见。`)
    await page.screenshot({ path: join(screenshotDirectory, `${label}.png`), animations: 'disabled' })
    assert(consoleErrors.length === 0, `${label}：控制台错误：${consoleErrors.join('；')}`)
  } finally {
    await page.close()
  }
}

const captureTaskManagement = async (browser, viewport, theme) => {
  const label = `task-management-${theme}-${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport })
  await setTheme(page, theme)
  const consoleErrors = []
  page.on('console', (entry) => {
    if (entry.type() === 'error') consoleErrors.push(entry.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })

  try {
    await page.goto(`${harnessUrl}?scenario=multi-task`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '创建审查任务', exact: true }).waitFor()
    await createRunningQueue(page)
    await assertNoDocumentOverflow(page, label)
    await assertReadable(page, '.wb-task-identity strong', `${label} 任务标题`)
    const svn = await assertReadable(page, '.wb-row-svn', `${label} SVN 地址`)
    assert(svn.fontSize >= 13, `${label}：SVN 地址字号 ${svn.fontSize}px 低于 13px。`)
    const progress = await assertReadable(page, '.wb-task-progress > strong', `${label} 当前进度`)
    assert(progress.fontSize >= 13, `${label}：进度文字字号 ${progress.fontSize}px 低于 13px。`)
    const statusLabel = await page.locator('.wb-status-label').first().textContent()
    assert(Boolean(statusLabel?.trim()), `${label}：状态标签没有文字。`)
    assert(await page.locator('.wb-compact-stage-track li.is-current').count() > 0, `${label}：执行中任务没有阶段轨道。`)
    await page.screenshot({ path: join(screenshotDirectory, `${label}.png`), animations: 'disabled' })
    assert(consoleErrors.length === 0, `${label}：控制台错误：${consoleErrors.join('；')}`)
  } finally {
    await page.close()
  }
}

const captureEnvironmentError = async (browser, viewport, theme) => {
  const label = `environment-error-${theme}-${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport })
  await setTheme(page, theme)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  try {
    await page.goto(`${harnessUrl}?scenario=codegraph-error`, { waitUntil: 'networkidle' })
    await page.getByLabel('本地环境状态').waitFor()
    const dependencyButton = page.getByRole('button', { name: '查看本地依赖状态', exact: true })
    if ((await dependencyButton.getAttribute('aria-expanded')) !== 'true') {
      await dependencyButton.click()
    }
    const missingDependency = page.locator('.wb-environment-inline .dependency-card.is-missing strong').first()
    await missingDependency.waitFor()
    assert(
      (await missingDependency.textContent())?.includes('CodeGraph'),
      `${label}：环境异常详情没有明确指出 CodeGraph 问题。`
    )
    await assertNoDocumentOverflow(page, label)
    await assertReadable(page, '.wb-environment-inline .dependency-card.is-missing strong', `${label} 依赖异常`)
    const expanded = await dependencyButton.getAttribute('aria-expanded')
    assert(expanded === 'true', `${label}：环境异常未展开详情。`)
    await page.screenshot({ path: join(screenshotDirectory, `${label}.png`), animations: 'disabled' })
  } finally {
    await page.close()
  }
}

const captureReportCenter = async (browser, viewport, theme) => {
  const label = `report-center-${theme}-${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport })
  await setTheme(page, theme)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  try {
    await page.goto(`${harnessUrl}?scenario=report-center`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '报告中心', exact: true }).click()
    await page.getByRole('heading', { name: 'BMS 状态机代码审查报告', exact: true }).waitFor()
    await assertNoDocumentOverflow(page, label)
    await assertReadable(page, '.wb-markdown-panel .markdown-preview p', `${label} Markdown 正文`)
    await assertReadable(page, '.wb-markdown-panel .markdown-preview td', `${label} Markdown 表格`)
    await assertReadable(page, '.wb-markdown-panel .markdown-code-block code', `${label} Markdown 代码块`)
    await assertReadable(page, '.wb-markdown-panel .markdown-preview blockquote', `${label} Markdown 引用`)
    await assertReadable(page, '.wb-markdown-panel .markdown-preview a', `${label} Markdown 链接`, 3)
    const markdownBg = await page.locator('.wb-markdown-panel').evaluate((element) => getComputedStyle(element).backgroundColor)
    if (theme === 'dark') {
      const { r, g, b } = parseRgb(markdownBg)
      assert(r < 40 && g < 50 && b < 60, `${label}：深色 Markdown 面板仍是浅底 ${markdownBg}。`)
    }
    await page.screenshot({ path: join(screenshotDirectory, `${label}.png`), animations: 'disabled' })
  } finally {
    await page.close()
  }
}

const captureSelector = async (browser, viewport, theme) => {
  const label = `review-selector-${theme}-${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport })
  await setTheme(page, theme)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  try {
    await page.goto(harnessUrl, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '选择', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '选择审查项', exact: true })
    await dialog.waitFor()
    await assertNoDocumentOverflow(page, label)
    await assertReadable(page, '.wb-selector-header h2', `${label} 弹窗标题`)
    await assertReadable(page, '.wb-item-copy strong', `${label} 审查项名称`)
    await assertReadable(page, '.wb-detail-heading p', `${label} 审查项说明`)
    const searchHasFocus = await dialog
      .getByPlaceholder('搜索 ID、名称或分类')
      .evaluate((element) => element === document.activeElement)
    assert(searchHasFocus, `${label}：打开弹窗后搜索框未获得焦点。`)
    await page.screenshot({ path: join(screenshotDirectory, `${label}.png`), animations: 'disabled' })
  } finally {
    await page.close()
  }
}

const captureFeedback = async (browser, viewport, theme) => {
  const label = `feedback-${theme}-${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport })
  await setTheme(page, theme)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  try {
    await page.goto(harnessUrl, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '意见反馈', exact: true }).click()
    await page.getByLabel('问题描述', { exact: true }).fill('深浅主题下反馈正文、截图列表和按钮都应清晰可读。')
    await addFeedbackScreenshot(page)
    await assertNoDocumentOverflow(page, label)
    await assertReadable(page, '.wb-feedback-description textarea', `${label} 反馈输入`)
    await assertReadable(page, '.wb-feedback-file-list strong', `${label} 截图文件名`)
    const submitButton = page.getByRole('button', { name: '提交意见', exact: true })
    await focusByKeyboard(page, submitButton, label)
    const focusStyle = await submitButton.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        isFocusVisible: element.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        boxShadow: style.boxShadow
      }
    })
    assert(focusStyle.isFocusVisible, `${label}：反馈提交按钮不是键盘可见焦点。`)
    assert(
      focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth >= 2 && focusStyle.boxShadow !== 'none',
      `${label}：反馈提交按钮焦点不可见。`
    )
    await page.screenshot({ path: join(screenshotDirectory, `${label}.png`), animations: 'disabled' })
  } finally {
    await page.close()
  }
}

const captureSvnBindingDialog = async (browser, viewport, theme) => {
  const label = `svn-binding-dialog-${theme}-${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport })
  await setTheme(page, theme)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  try {
    await page.goto(`${harnessUrl}?scenario=svn-binding-dialog`, { waitUntil: 'networkidle' })
    const dialog = page.getByRole('dialog', { name: '绑定 SVN 账号', exact: true })
    await dialog.waitFor()
    await assertNoDocumentOverflow(page, label)
    await assertReadable(page, '.login-dialog-card h2', `${label} 弹窗标题`)
    await assertReadable(page, '.login-dialog-card .dialog-desc', `${label} 弹窗说明`)
    await assertReadable(page, '.login-dialog-card .auth-field input', `${label} 输入框`)
    await page.getByLabel('SVN 账号', { exact: true }).fill('visual-svn-user')
    await dialog.locator('input[type="password"]').fill('visual-svn-password')
    const submitButton = dialog.getByRole('button', { name: '绑定并继续', exact: true })
    await focusByKeyboard(page, submitButton, label)
    const focusVisible = await submitButton.evaluate((element) => element.matches(':focus-visible'))
    assert(focusVisible, `${label}：绑定提交按钮不是键盘可见焦点。`)
    await page.screenshot({ path: join(screenshotDirectory, `${label}.png`), animations: 'disabled' })
  } finally {
    await page.close()
  }
}

const captureUpdateDialog = async (browser, viewport, theme) => {
  const label = `update-dialog-${theme}-${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport })
  await setTheme(page, theme)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  try {
    await page.goto(`${harnessUrl}?scenario=update-dialog`, { waitUntil: 'networkidle' })
    const dialog = page.getByRole('dialog', { name: '发现新版本 2.0.0', exact: true })
    await dialog.waitFor()
    await assertNoDocumentOverflow(page, label)
    await assertReadable(page, '.update-dialog h2', `${label} 弹窗标题`)
    await assertReadable(page, '.update-dialog p', `${label} 弹窗说明`)
    await assertReadable(page, '.update-notes', `${label} 更新说明`)
    const downloadButton = dialog.getByRole('button', { name: '现在更新', exact: true })
    await focusByKeyboard(page, downloadButton, label)
    const focusVisible = await downloadButton.evaluate((element) => element.matches(':focus-visible'))
    assert(focusVisible, `${label}：更新按钮不是键盘可见焦点。`)
    await page.screenshot({ path: join(screenshotDirectory, `${label}.png`), animations: 'disabled' })
  } finally {
    await page.close()
  }
}

const assertReportFeedbackWindowFixedLight = async (browser) => {
  const page = await browser.newPage({ viewport: { width: 920, height: 620 } })
  await setTheme(page, 'dark')
  await installReportFeedbackApiMock(page)
  try {
    await page.goto(`http://${host}:${port}/feedback.html`, { waitUntil: 'networkidle' })
    await page.locator('.report-feedback-window').waitFor()
    await page.getByText('状态恢复事件缺失', { exact: true }).waitFor()
    const bodyBg = await page.locator('.report-feedback-window').evaluate((element) => getComputedStyle(element).backgroundColor)
    const toggleCount = await page.getByRole('button', { name: /切换到/ }).count()
    assert(bodyBg === 'rgb(245, 246, 248)', `独立反馈窗口不应随深色主题变化，当前背景 ${bodyBg}。`)
    assert(toggleCount === 0, '独立反馈窗口不应显示主题按钮。')
    await page.screenshot({
      path: join(screenshotDirectory, 'report-feedback-window-fixed-light-920x620.png'),
      animations: 'disabled'
    })
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
  for (const viewport of viewports) {
    for (const theme of themes) {
      await captureLogin(browser, viewport, theme)
      await captureTaskManagement(browser, viewport, theme)
      await captureEnvironmentError(browser, viewport, theme)
      await captureReportCenter(browser, viewport, theme)
      await captureSelector(browser, viewport, theme)
      await captureFeedback(browser, viewport, theme)
      await captureSvnBindingDialog(browser, viewport, theme)
      await captureUpdateDialog(browser, viewport, theme)
    }
  }
  await assertReportFeedbackWindowFixedLight(browser)
  console.log(`Issue #88 主题覆盖视觉验收截图已写入 ${screenshotDirectory}`)
} finally {
  await browser?.close()
  await stopServer(server)
}
