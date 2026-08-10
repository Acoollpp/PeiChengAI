const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { Arch } = require('builder-util')

module.exports = async function prepareCodeGraphBeforePack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }
  if (context.arch !== Arch.x64) {
    throw new Error('内置 CodeGraph 1.4.1 仅支持 Windows x64 打包目标')
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, 'prepare-codegraph-runtime.mjs')], {
      cwd: join(__dirname, '..'),
      env: process.env,
      stdio: 'inherit',
      windowsHide: true
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`CodeGraph 资源准备失败，退出码 ${String(code)}`))
      }
    })
  })
}
