import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const electronExecutable = require('electron')

const listen = (server, port = 0) =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address())
    })
  })

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const rendererServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(`<!doctype html>
<html>
  <head><title>ESM startup check</title></head>
  <body>
    <script>
      window.addEventListener('DOMContentLoaded', () => {
        if (typeof window.codeReview?.openReportFeedbackWindow !== 'function') return
        setTimeout(() => {
          window.codeReview.openReportFeedbackWindow({
            mode: 'legacy',
            taskId: 'esm-startup-check',
            options: [{ id: 'option-1', text: '启动回归检查', anchorId: 'anchor-1' }]
          }).catch((error) => {
            document.title = \`ESM startup check failed: \${error.message}\`
          })
        }, 100)
      })
    </script>
  </body>
</html>`)
})
const debugPortServer = createServer()
let electronProcess
let electronExitPromise
let userDataDir

try {
  const rendererAddress = await listen(rendererServer)
  const debugAddress = await listen(debugPortServer)
  const debugPort = debugAddress.port
  await close(debugPortServer)
  userDataDir = await mkdtemp(join(tmpdir(), 'code-review-electron-esm-startup-'))

  electronProcess = spawn(
    electronExecutable,
    [projectRoot, `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debugPort}`],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: `http://127.0.0.1:${rendererAddress.port}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let output = ''
  electronProcess.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  electronProcess.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  electronExitPromise = new Promise((resolve) => {
    electronProcess.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const deadline = Date.now() + 10_000
  let windowsCreated = false

  while (Date.now() < deadline && electronProcess.exitCode === null) {
    if (/ReferenceError:\s*__dirname is not defined/.test(output)) {
      throw new Error(`Electron 主进程仍依赖未定义的 __dirname\n${output.trim()}`)
    }

    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        windowsCreated = targets.filter((target) => target.type === 'page').length >= 2
        if (windowsCreated) {
          break
        }
      }
    } catch {
      // DevTools endpoint is unavailable until Electron creates its first window.
    }
    await delay(100)
  }

  if (!windowsCreated) {
    const exit = electronProcess.exitCode === null ? null : await electronExitPromise
    throw new Error(
      `Electron 未在限定时间内创建主窗口和反馈窗口${exit ? `（退出码 ${exit.code}，信号 ${exit.signal}）` : ''}\n${output.trim()}`
    )
  }

  console.log('Electron ESM 主进程启动成功，并已创建主窗口和反馈窗口。')
} finally {
  if (electronProcess?.exitCode === null) {
    electronProcess.kill('SIGTERM')
  }
  if (electronExitPromise) {
    const exit = await Promise.race([electronExitPromise, delay(3_000).then(() => null)])
    if (!exit && electronProcess?.exitCode === null) {
      electronProcess.kill('SIGKILL')
      await electronExitPromise
    }
  }
  await close(rendererServer).catch(() => undefined)
  if (userDataDir) {
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
