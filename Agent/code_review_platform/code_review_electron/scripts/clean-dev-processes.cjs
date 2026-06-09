#!/usr/bin/env node

const { execFileSync } = require('node:child_process')

const dryRun = process.argv.includes('--dry-run')
const currentPid = process.pid
const parentPid = process.ppid
const patterns = [
  '/code_review_electron/node_modules/electron/dist/Electron.app',
  '/code_review_electron/node_modules/.bin/electron-vite dev'
]

function listDevProcesses() {
  const output = execFileSync('ps', ['-axo', 'pid=', '-o', 'command='], {
    encoding: 'utf8'
  })

  return output
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.*)$/)
      if (!match) {
        return null
      }

      return {
        pid: Number(match[1]),
        command: match[2]
      }
    })
    .filter(Boolean)
    .filter(({ pid, command }) => {
      if (pid === currentPid || pid === parentPid) {
        return false
      }

      return patterns.some((pattern) => command.includes(pattern))
    })
}

function signal(processes, signal) {
  for (const processInfo of processes) {
    try {
      if (dryRun) {
        console.log(`[dev cleanup] would send ${signal} to ${processInfo.pid}: ${processInfo.command}`)
      } else {
        process.kill(processInfo.pid, signal)
      }
    } catch {
      // Process already exited.
    }
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const initialProcesses = listDevProcesses()
if (initialProcesses.length === 0) {
  if (dryRun) {
    console.log('[dev cleanup] no stale Electron dev processes found')
  }
  process.exit(0)
}

signal(initialProcesses, 'SIGTERM')

if (!dryRun) {
  sleep(800)
  signal(listDevProcesses(), 'SIGKILL')
}
