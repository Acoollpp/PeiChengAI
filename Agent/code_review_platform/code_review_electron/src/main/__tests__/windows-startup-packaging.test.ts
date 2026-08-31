import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const legacyInternalLaunchLink = '$INSTDIR\\AI代码审查客户端启动.lnk'

describe('Windows 启动兼容打包契约', () => {
  it('覆盖安装后清除标准快捷方式中的旧图形参数', async () => {
    const installer = await readFile(join(projectRoot, 'build', 'installer.nsh'), 'utf8')

    expect(installer).not.toContain('--disable-gpu')
    expect(installer).not.toContain('--disable-software-rasterizer')
    expect(installer).toContain('!macro customInstall')
    expect(installer).toContain(
      'CreateShortCut "$newStartMenuLink" "$appExe" ""'
    )
    expect(installer).toContain(
      'CreateShortCut "$newDesktopLink" "$appExe" ""'
    )
  })

  it('删除测试版内部快捷方式并恢复构建器的标准更新后启动入口', async () => {
    const installer = await readFile(join(projectRoot, 'build', 'installer.nsh'), 'utf8')

    expect(installer).toContain(`Delete "${legacyInternalLaunchLink}"`)
    expect(installer).not.toContain('StrCpy $launchLink')
    expect(installer).not.toContain('CreateShortCut "${INTERNAL_LAUNCH_LINK}"')
  })

  it('与固定 electron-builder 的 updater 启动顺序保持兼容', async () => {
    const [packageJson, installSection, common] = await Promise.all([
      readFile(join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
      readFile(
        join(
          projectRoot,
          'node_modules',
          'app-builder-lib',
          'templates',
          'nsis',
          'installSection.nsh'
        ),
        'utf8'
      ),
      readFile(
        join(projectRoot, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'common.nsh'),
        'utf8'
      )
    ])

    expect(packageJson.devDependencies['electron-builder']).toBe('22.14.13')
    expect(installSection.indexOf('StrCpy $launchLink')).toBeLessThan(
      installSection.indexOf('!insertmacro customInstall')
    )
    expect(installSection.indexOf('!insertmacro customInstall')).toBeLessThan(
      installSection.indexOf('!macro doStartApp')
    )
    expect(common).toContain(
      '${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$startAppArgs"'
    )
  })
})
