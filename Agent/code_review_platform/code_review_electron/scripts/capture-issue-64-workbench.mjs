import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const screenshotDirectory = join(projectRoot, 'docs', 'issue-64', 'screenshots')
const host = '127.0.0.1'
const port = 4319
const harnessUrl = `http://${host}:${port}/production-harness.html`
const viewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
]
const longFailureMessage =
  'Codex 执行失败：工作区中的状态机生成文件与规格书第五章约束不一致；请打开完整日志核对 checkout、CodeGraph 索引和审查 Skill 输出后，从头重试本任务。'
const longRepositoryName = '储能柜主控状态机与故障恢复跨模式安全降级边界条件联合审查任务-2026-Q3-最终确认版'
const longSvnUrl = `svn://192.168.100.88:3690/新能源汽车电子平台/电池管理系统/储能柜控制器/正式发布分支/${longRepositoryName}`

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const waitForServer = async (server, readOutput) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`预览服务器提前退出。\n${readOutput()}`)
    try {
      const response = await fetch(harnessUrl)
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

const createPage = async (browser, viewport) => {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('console', (entry) => {
    if (entry.type() === 'error') errors.push(entry.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return { page, errors }
}

const assertVisualFoundation = async (page, label) => {
  const metrics = await page.evaluate(() => {
    const visibleButtons = [...document.querySelectorAll('button')].filter((button) => {
      const rect = button.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    const unnamedButtons = visibleButtons.filter((button) =>
      !(button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent?.trim())
    )
    const clippedControls = [...document.querySelectorAll('button, input, textarea')].filter((control) => {
      const rect = control.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false
      const verticallyVisible = rect.bottom > 0 && rect.top < innerHeight
      const labelRect = control instanceof HTMLInputElement && control.type === 'checkbox'
        ? control.closest('label')?.getBoundingClientRect()
        : undefined
      const hasUsableCheckboxTarget = Boolean(labelRect && labelRect.width >= 24 && labelRect.height >= 24)
      return verticallyVisible && (
        rect.left < 0 || rect.right > innerWidth + 1 ||
        (!hasUsableCheckboxTarget && (rect.width < 24 || rect.height < 24))
      )
    })
    const shellStyle = getComputedStyle(document.querySelector('.wb-shell'))
    const gradientSurfaces = [...document.querySelectorAll('.wb-shell, .wb-app-header, .wb-create-panel, .wb-workspace')]
      .filter((element) => getComputedStyle(element).backgroundImage !== 'none')
    return {
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      background: shellStyle.backgroundColor,
      color: shellStyle.color,
      fontFamily: shellStyle.fontFamily,
      unnamedButtons: unnamedButtons.length,
      clippedControls: clippedControls.map((control) => {
        const rect = control.getBoundingClientRect()
        return {
          tag: control.tagName.toLowerCase(),
          type: control.getAttribute('type'),
          name: control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim(),
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
        }
      }),
      gradientSurfaces: gradientSurfaces.length
    }
  })
  assert(!metrics.horizontalOverflow, `${label}：页面存在横向溢出。`)
  assert(metrics.background === 'rgb(244, 247, 249)', `${label}：未使用冷白工作台背景。`)
  assert(metrics.color === 'rgb(24, 35, 43)', `${label}：未使用指定深色正文。`)
  assert(metrics.fontFamily.includes('Segoe UI'), `${label}：未使用 Windows 系统字体。`)
  assert(metrics.unnamedButtons === 0, `${label}：存在无可访问名称的按钮。`)
  assert(metrics.clippedControls.length === 0, `${label}：首屏存在截断或尺寸不可操作的控件：${JSON.stringify(metrics.clippedControls)}`)
  assert(metrics.gradientSurfaces === 0, `${label}：主工作台出现渐变背景。`)
}

const assertTaskTimes = async (page, label) => {
  const metrics = await page.evaluate(() =>
    [...document.querySelectorAll('.wb-task-table-row time')].map((element) => ({
      text: element.textContent?.trim() ?? '',
      title: element.getAttribute('title'),
      ariaLabel: element.getAttribute('aria-label'),
      fits: element.scrollWidth <= element.clientWidth,
      visible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
    }))
  )
  assert(metrics.length > 0, `${label}：任务列表缺少更新时间。`)
  metrics.forEach((metric) => {
    assert(metric.visible, `${label}：任务更新时间不可见。`)
    assert(metric.fits, `${label}：任务更新时间“${metric.text}”被截断。`)
    assert(metric.text.length > 0 && !metric.text.includes('…'), `${label}：任务更新时间不是完整值。`)
    assert(metric.title === metric.text, `${label}：任务更新时间缺少完整 title。`)
    assert(metric.ariaLabel === `更新时间 ${metric.text}`, `${label}：任务更新时间缺少可访问名称。`)
  })
}

const assertHeaderAndFormBounds = async (page, label) => {
  const metrics = await page.evaluate(() => {
    const navigation = document.querySelector('.wb-preview-controls')?.getBoundingClientRect()
    const user = document.querySelector('.wb-user')?.getBoundingClientRect()
    const header = document.querySelector('.wb-app-header')?.getBoundingClientRect()
    const brand = document.querySelector('.wb-brand')
    const brandLogo = document.querySelector('.wb-brand-logo')
    const brandLogoRect = brandLogo?.getBoundingClientRect()
    const userName = document.querySelector('.wb-user strong')
    const department = document.querySelector('.wb-user > div span')
    const panel = document.querySelector('.wb-create-panel')
    const svnInput = document.querySelector('.wb-form-fields > .wb-form-field input')?.getBoundingClientRect()
    const panelRect = panel?.getBoundingClientRect()
    return {
      userClearsNavigation: Boolean(navigation && user && navigation.right <= user.left + 1),
      userTextFits: Boolean(
        userName && department &&
        userName.scrollWidth <= userName.clientWidth &&
        department.scrollWidth <= department.clientWidth
      ),
      brandLogoLoaded: Boolean(brandLogo instanceof HTMLImageElement && brandLogo.complete && brandLogo.naturalWidth > 0),
      brandLogoFits: Boolean(
        header && brandLogoRect &&
        brandLogoRect.left >= header.left && brandLogoRect.right <= header.right &&
        brandLogoRect.top >= header.top && brandLogoRect.bottom <= header.bottom
      ),
      legacyBrandHidden: !brand?.textContent?.includes('AI 代码审查'),
      formHasNoHorizontalOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
      svnInputWithinPanel: Boolean(
        svnInput && panelRect && svnInput.left >= panelRect.left && svnInput.right <= panelRect.right + 1
      ),
      svnInputRect: svnInput ? { left: svnInput.left, right: svnInput.right } : null,
      panelRect: panelRect ? { left: panelRect.left, right: panelRect.right } : null
    }
  })
  assert(metrics.userClearsNavigation, `${label}：顶部用户信息与导航重叠。`)
  assert(metrics.userTextFits, `${label}：长用户名或部门名被截断。`)
  assert(metrics.brandLogoLoaded, `${label}：沛城品牌 Logo 未加载。`)
  assert(metrics.brandLogoFits, `${label}：沛城品牌 Logo 超出顶部栏。`)
  assert(metrics.legacyBrandHidden, `${label}：顶部仍显示旧的 AI 代码审查标题。`)
  assert(metrics.formHasNoHorizontalOverflow, `${label}：左侧创建任务表单横向溢出。`)
  assert(
    metrics.svnInputWithinPanel,
    `${label}：长 SVN 输入框越出左侧表单（input=${JSON.stringify(metrics.svnInputRect)}，panel=${JSON.stringify(metrics.panelRect)}）。`
  )
}

const assertKeyboardFocus = async (page, locator, label) => {
  await locator.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  const focus = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      active: element === document.activeElement,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth)
    }
  })
  assert(focus.active, `${label}：控件无法获得键盘焦点。`)
  assert(focus.outlineStyle !== 'none' && focus.outlineWidth >= 2, `${label}：控件缺少可见焦点。`)
}

const selectDs03 = async (page) => {
  await page.getByRole('button', { name: '选择', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '选择审查项', exact: true })
  await dialog.getByLabel('选择 DS-03 状态机审查', { exact: true }).check()
  await dialog.getByRole('button', { name: '完成选择（1）', exact: true }).click()
}

const captureReviewItemSelector = async (browser) => {
  const viewport = { width: 1280, height: 720 }
  const label = '1280x720 审查项选择器'
  const { page, errors } = await createPage(browser, viewport)
  try {
    await page.goto(`${harnessUrl}?scenario=multi-task`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '选择', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '选择审查项', exact: true })
    await dialog.waitFor()

    assert(await dialog.getByText('日常提交审核', { exact: true }).isVisible(), `${label}：缺少日常提交审核分组。`)
    assert(await dialog.getByText('控制逻辑专项审核', { exact: true }).isVisible(), `${label}：缺少控制逻辑专项审核分组。`)
    assert(await dialog.getByText('变更点审查', { exact: true }).first().isVisible(), `${label}：缺少变更点审查。`)
    assert(await dialog.getByText('编码规范审查', { exact: true }).isVisible(), `${label}：缺少编码规范审查。`)
    assert(await dialog.getByText('状态机审查', { exact: true }).isVisible(), `${label}：缺少状态机审查。`)
    assert(
      await dialog.getByText(
        '重点依据产品开发需求表和产品规格书，核对代码变更是否完整、准确落实需求与规格。',
        { exact: true }
      ).first().isVisible(),
      `${label}：变更点审查说明未突出需求表和规格书。`
    )

    const metrics = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const itemLabels = [...element.querySelectorAll('.wb-item-copy strong')]
      const itemSummaries = [...element.querySelectorAll('.wb-item-copy > span')]
      return {
        withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        horizontalOverflow: element.scrollWidth > element.clientWidth,
        labelsFit: itemLabels.every((labelElement) => labelElement.scrollWidth <= labelElement.clientWidth),
        summariesVisible: itemSummaries.every((summary) => summary.getBoundingClientRect().height > 0)
      }
    })
    assert(metrics.withinViewport, `${label}：弹窗超出视口。`)
    assert(!metrics.horizontalOverflow, `${label}：弹窗存在横向溢出。`)
    assert(metrics.labelsFit, `${label}：审查项名称被截断。`)
    assert(metrics.summariesVisible, `${label}：审查项说明不可见。`)
    await assertHeaderAndFormBounds(page, label)
    await assertVisualFoundation(page, label)
    await page.screenshot({
      path: join(screenshotDirectory, 'review-item-selector-1280x720.png'),
      animations: 'disabled'
    })
    assert(errors.length === 0, `${label} 控制台错误：${errors.join('；')}`)
  } finally {
    await page.close()
  }
}

const createQueuedTasks = async (page) => {
  await selectDs03(page)
  for (let index = 1; index <= 3; index += 1) {
    await page.getByLabel('SVN 地址', { exact: true }).fill(
      `svn://production-harness/BMS/release/queue-task-with-long-repository-name-${index}`
    )
    await page.getByLabel('旧 revision', { exact: true }).fill(String(18000 + index))
    await page.getByLabel('新 revision', { exact: true }).fill(String(18100 + index))
    await page.getByRole('button', { name: '创建审查任务', exact: true }).click()
  }
}

const captureCurrentTasks = async (browser, viewport) => {
  const label = `${viewport.width}x${viewport.height}`
  const { page, errors } = await createPage(browser, viewport)
  try {
    await page.goto(`${harnessUrl}?scenario=multi-task`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '创建审查任务', exact: true }).waitFor()
    const environmentToggle = page.getByRole('button', { name: '查看本地依赖状态', exact: true })
    assert(await environmentToggle.getAttribute('aria-expanded') === 'false', `${label}：就绪环境详情未收起。`)
    assert(await page.getByText(/CodeGraph 1\.4\.1/).isVisible(), `${label}：就绪摘要缺少 CodeGraph 1.4.1。`)

    await createQueuedTasks(page)
    await page.getByText('本机等待第 1 位', { exact: true }).waitFor()
    await page.waitForTimeout(300)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const toast = page.locator('.wb-toast')
      if (!await toast.count()) break
      await toast.getByRole('button', { name: '关闭提示', exact: true }).click()
      await toast.waitFor({ state: 'detached' })
      await page.waitForTimeout(50)
    }
    assert(!await page.locator('.wb-toast').count(), `${label}：截图前队列通知仍覆盖任务操作。`)
    const currentTab = page.getByRole('tab', { name: /当前任务/ })
    assert(await currentTab.getAttribute('aria-selected') === 'true', `${label}：有当前任务时未初始选择当前任务。`)
    const metrics = await page.evaluate(() => ({
      running: document.querySelectorAll('.wb-task-table-row.is-running').length,
      waiting: document.querySelectorAll('.wb-task-table-row.is-waiting').length,
      failed: document.querySelectorAll('.wb-task-table-row.is-failed').length,
      reportTable: document.querySelectorAll('.wb-management-reports').length,
      panelScrollable: (() => {
        const panel = document.querySelector('.wb-task-table-body')
        return Boolean(panel && getComputedStyle(panel).overflowY === 'auto')
      })()
    }))
    assert(metrics.running === 2 && metrics.waiting === 1, `${label}：当前任务未显示两项运行和一项等待。`)
    assert(metrics.failed === 0, `${label}：当前任务视图混入失败任务。`)
    assert(metrics.reportTable === 0, `${label}：任务页仍存在重复报告表格。`)
    assert(metrics.panelScrollable, `${label}：任务列表未形成独立滚动区域。`)
    await assertTaskTimes(page, `${label} 当前任务`)
    await assertHeaderAndFormBounds(page, `${label} 当前任务`)
    await assertKeyboardFocus(page, currentTab, `${label} 当前任务标签`)
    await assertVisualFoundation(page, `${label} 当前任务`)
    await page.screenshot({
      path: join(screenshotDirectory, `current-tasks-${label}.png`),
      animations: 'disabled'
    })

    await page.getByRole('button', { name: /今日完成/ }).click()
    await page.getByRole('heading', { name: '报告中心', exact: true }).waitFor()
    assert(!await page.locator('.wb-create-panel').count(), `${label}：完成数量未进入独立报告中心。`)
    assert(errors.length === 0, `${label} 当前任务控制台错误：${errors.join('；')}`)
  } finally {
    await page.close()
  }
}

const captureAttentionTasks = async (browser, viewport) => {
  const label = `${viewport.width}x${viewport.height}`
  const { page, errors } = await createPage(browser, viewport)
  try {
    await page.goto(`${harnessUrl}?scenario=failed-tasks`, { waitUntil: 'networkidle' })
    const attentionTab = page.getByRole('tab', { name: /需要处理/ })
    await attentionTab.waitFor()
    assert(await attentionTab.getAttribute('aria-selected') === 'true', `${label}：仅有失败任务时未初始选择需要处理。`)
    assert(await page.locator('.wb-task-table-row.is-failed').count() === 3, `${label}：未显示三个失败任务。`)
    assert(await page.getByText(longFailureMessage, { exact: true }).isVisible(), `${label}：完整失败原因不可见。`)
    assert(await page.getByTitle(`${longRepositoryName} · r18420 → r18579`, { exact: true }).isVisible(), `${label}：长任务名不可见。`)
    assert(await page.getByTitle(longSvnUrl, { exact: true }).isVisible(), `${label}：长 SVN 不可见。`)
    assert(await page.getByRole('button', { name: '打开任务日志 failed-long-task-2026-08-09-001' }).isVisible(), `${label}：日志入口缺失。`)
    assert(await page.getByRole('button', { name: '从头重试 failed-long-task-2026-08-09-001' }).isVisible(), `${label}：重试入口缺失。`)

    const currentTab = page.getByRole('tab', { name: /当前任务/ })
    await currentTab.click()
    assert(await page.getByText('暂无当前任务', { exact: true }).isVisible(), `${label}：当前任务与失败任务未互斥。`)
    assert(await page.locator('.wb-task-table-row.is-failed').count() === 0, `${label}：当前任务空态仍显示失败行。`)
    await attentionTab.click()
    assert(await page.locator('.wb-task-table-row.is-failed').count() === 3, `${label}：返回需要处理后失败任务丢失。`)
    await assertTaskTimes(page, `${label} 需要处理`)
    await assertKeyboardFocus(page, attentionTab, `${label} 需要处理标签`)
    await assertVisualFoundation(page, `${label} 需要处理`)
    await page.screenshot({
      path: join(screenshotDirectory, `attention-tasks-${label}.png`),
      animations: 'disabled'
    })
    assert(errors.length === 0, `${label} 需要处理控制台错误：${errors.join('；')}`)
  } finally {
    await page.close()
  }
}

const captureReportCenter = async (browser, viewport) => {
  const label = `${viewport.width}x${viewport.height}`
  const { page, errors } = await createPage(browser, viewport)
  try {
    await page.goto(`${harnessUrl}?scenario=report-center`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /今日完成/ }).click()
    await page.getByRole('heading', { name: '报告中心', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'BMS 状态机代码审查报告', exact: true }).waitFor()

    const metrics = await page.evaluate(() => {
      const style = (selector) => {
        const element = document.querySelector(selector)
        if (!element) return null
        const computed = getComputedStyle(element)
        return {
          color: computed.color,
          background: computed.backgroundColor,
          borderColor: computed.borderTopColor
        }
      }
      const preview = document.querySelector('.wb-markdown-panel .preview-scroll')
      return {
        panel: style('.wb-markdown-panel'),
        heading: style('.wb-markdown-panel .markdown-preview h1'),
        paragraph: style('.wb-markdown-panel .markdown-preview p'),
        link: style('.wb-markdown-panel .markdown-preview a'),
        inlineCode: style('.wb-markdown-panel .markdown-preview :not(pre) > code'),
        blockCode: style('.wb-markdown-panel .markdown-code-block code'),
        tableHeader: style('.wb-markdown-panel .markdown-preview th'),
        previewScrollable: Boolean(preview && getComputedStyle(preview).overflowY === 'auto'),
        horizontalOverflow: Boolean(preview && preview.scrollWidth > preview.clientWidth)
      }
    })
    assert(metrics.panel?.background === 'rgb(255, 255, 255)', `${label}：报告正文面板不是白色。`)
    assert(metrics.heading?.color === 'rgb(24, 35, 43)', `${label}：Markdown 标题对比度错误。`)
    assert(metrics.paragraph?.color === 'rgb(52, 68, 78)', `${label}：Markdown 正文对比度错误。`)
    assert(metrics.link?.color === 'rgb(8, 127, 115)', `${label}：Markdown 链接颜色错误。`)
    assert(metrics.inlineCode?.color === 'rgb(6, 95, 87)', `${label}：Markdown 行内代码颜色错误。`)
    assert(metrics.blockCode?.color === 'rgb(52, 68, 78)', `${label}：Markdown 代码块颜色错误。`)
    assert(metrics.tableHeader?.borderColor === 'rgb(201, 213, 218)', `${label}：Markdown 表格边框仍为深色主题值。`)
    assert(metrics.previewScrollable, `${label}：长报告正文没有独立滚动区域。`)
    assert(!metrics.horizontalOverflow, `${label}：报告正文产生横向溢出。`)
    await assertVisualFoundation(page, `${label} 报告中心`)
    await page.screenshot({
      path: join(screenshotDirectory, `report-center-${label}.png`),
      animations: 'disabled'
    })

    await page.getByRole('button', { name: /空报告兼容性检查/ }).click()
    const emptyState = page.getByText('审查完成后，Markdown 报告会显示在这里。', { exact: true })
    await emptyState.waitFor()
    const emptyStateMetrics = await emptyState.evaluate((element) => {
      const style = getComputedStyle(element)
      const panel = element.closest('.wb-markdown-panel')
      return {
        color: style.color,
        panelBackground: panel ? getComputedStyle(panel).backgroundColor : ''
      }
    })
    assert(emptyStateMetrics.color === 'rgb(82, 97, 105)', `${label}：空报告提示仍为深色主题浅色文字。`)
    assert(emptyStateMetrics.panelBackground === 'rgb(255, 255, 255)', `${label}：空报告提示不在亮色面板中。`)
    assert(errors.length === 0, `${label} 报告中心控制台错误：${errors.join('；')}`)
  } finally {
    await page.close()
  }
}

const captureProductionDialog = async (browser, scenario, fileName, selector) => {
  const viewport = { width: 1280, height: 720 }
  const label = `1280x720 ${fileName}`
  const { page, errors } = await createPage(browser, viewport)
  try {
    await page.goto(`${harnessUrl}?scenario=${scenario}`, { waitUntil: 'networkidle' })
    await page.locator(selector).waitFor()
    const metrics = await page.locator(selector).evaluate((element) => {
      const computed = getComputedStyle(element)
      const field = element.querySelector('input, .update-notes')
      const fieldStyle = field ? getComputedStyle(field) : null
      return {
        color: computed.color,
        background: computed.backgroundColor,
        borderColor: computed.borderTopColor,
        fieldColor: fieldStyle?.color,
        fieldBackground: fieldStyle?.backgroundColor,
        withinViewport: (() => {
          const rect = element.getBoundingClientRect()
          return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
        })()
      }
    })
    assert(metrics.color === 'rgb(24, 35, 43)', `${label}：对话框正文仍为深色主题值。`)
    assert(metrics.background === 'rgb(255, 255, 255)', `${label}：对话框背景仍为深色主题值。`)
    assert(metrics.borderColor === 'rgb(201, 213, 218)', `${label}：对话框边框未切换到亮色。`)
    assert(metrics.fieldColor === 'rgb(24, 35, 43)' || metrics.fieldColor === 'rgb(52, 68, 78)', `${label}：对话框字段文字对比度错误。`)
    assert(metrics.fieldBackground === 'rgb(255, 255, 255)' || metrics.fieldBackground === 'rgb(247, 250, 251)', `${label}：对话框字段仍为深色背景。`)
    assert(metrics.withinViewport, `${label}：对话框超出视口。`)
    await assertVisualFoundation(page, label)
    await page.screenshot({
      path: join(screenshotDirectory, `${fileName}-1280x720.png`),
      animations: 'disabled'
    })
    assert(errors.length === 0, `${label} 控制台错误：${errors.join('；')}`)
  } finally {
    await page.close()
  }
}

const captureCodeGraphError = async (browser, viewport) => {
  const label = `${viewport.width}x${viewport.height}`
  const { page, errors } = await createPage(browser, viewport)
  try {
    await page.goto(`${harnessUrl}?scenario=codegraph-error`, { waitUntil: 'networkidle' })
    const environmentToggle = page.getByRole('button', { name: '查看本地依赖状态', exact: true })
    await environmentToggle.waitFor()
    assert(await environmentToggle.getAttribute('aria-expanded') === 'true', `${label}：CodeGraph 异常详情未自动展开。`)
    assert(await page.getByText(/内置 CodeGraph 1\.4\.1 资源损坏或校验不一致/).isVisible(), `${label}：CodeGraph 损坏说明不可见。`)
    assert(await page.getByText(/Quality Engineer.*codegraph\\win32-x64\\bin\\codegraph\.cmd/).isVisible(), `${label}：CodeGraph 真实长路径不可见。`)
    assert(!await page.getByRole('button', { name: /安装 CodeGraph/ }).count(), `${label}：异常态错误提供了在线安装入口。`)
    const environmentMetrics = await page.evaluate(() => {
      const box = document.querySelector('.wb-environment-inline .environment-box')
      const cards = [...document.querySelectorAll('.wb-environment-inline .dependency-card')]
      return {
        horizontalOverflow: Boolean(box && box.scrollWidth > box.clientWidth),
        cardCount: cards.length,
        cardsOverlap: cards.some((card, index) => cards.slice(index + 1).some((other) => {
          const first = card.getBoundingClientRect()
          const second = other.getBoundingClientRect()
          return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
        }))
      }
    })
    assert(!environmentMetrics.horizontalOverflow, `${label}：CodeGraph 环境详情横向溢出。`)
    assert(environmentMetrics.cardCount === 2, `${label}：异常态依赖详情数量不正确。`)
    assert(!environmentMetrics.cardsOverlap, `${label}：环境依赖卡片发生重叠。`)
    await assertKeyboardFocus(page, environmentToggle, `${label} 环境详情按钮`)
    await assertVisualFoundation(page, `${label} CodeGraph 异常`)
    await page.screenshot({
      path: join(screenshotDirectory, `codegraph-error-${label}.png`),
      animations: 'disabled'
    })
    assert(errors.length === 0, `${label} CodeGraph 异常控制台错误：${errors.join('；')}`)
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
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })

let browser
try {
  await waitForServer(server, () => serverOutput)
  browser = await chromium.launch({ headless: true })
  await captureReviewItemSelector(browser)
  for (const viewport of viewports) {
    await captureCurrentTasks(browser, viewport)
    await captureAttentionTasks(browser, viewport)
    await captureCodeGraphError(browser, viewport)
    await captureReportCenter(browser, viewport)
    console.log(`${viewport.width}x${viewport.height} 通过：当前任务、需要处理、CodeGraph 异常和报告中心场景。`)
  }
  await captureProductionDialog(browser, 'svn-binding-dialog', 'svn-binding-dialog', '.dialog-card')
  await captureProductionDialog(browser, 'update-dialog', 'update-dialog', '.update-dialog')
  console.log('1280x720 通过：登录后 SVN 绑定与客户端更新对话框。')
  console.log('1280x720 通过：沛城品牌 Logo 与新审查项分组。')
  console.log(`Issue #64 截图已写入 ${screenshotDirectory}`)
} finally {
  await browser?.close()
  await stopServer(server)
}
