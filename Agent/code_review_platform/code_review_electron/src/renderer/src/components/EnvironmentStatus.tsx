import { useState } from 'react'

import type { EnvironmentCheckResult } from '../code-review-api'

type EnvironmentStatusProps = {
  result: EnvironmentCheckResult | null
  isChecking: boolean
  isInstallingCodex: boolean
  onRefresh: () => Promise<void>
  onInstallCodex: () => Promise<void>
  onInstallSkill: () => Promise<void>
}

const statusLabels: Record<NonNullable<EnvironmentCheckResult['status']>, string> = {
  ready: '环境就绪',
  missing_codex: '缺少 Codex',
  missing_svn: '缺少 SVN',
  missing_skill: '缺少 Skill',
  failed: '检查失败'
}

type DependencyItem = {
  key: string
  name: string
  ok: boolean
  version?: string
  path?: string
  missingText: string
  actionText: string
}

export function EnvironmentStatus({
  result,
  isChecking,
  isInstallingCodex,
  onRefresh,
  onInstallCodex,
  onInstallSkill
}: EnvironmentStatusProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [installingSkill, setInstallingSkill] = useState(false)
  const status = result?.status ?? 'failed'
  const hasKnownResult = result !== null
  const hasIssue = hasKnownResult && status !== 'ready'
  const hasSkillSyncIssue = Boolean(result?.skillError)
  const codexMissing = hasKnownResult && status === 'missing_codex'
  const statusClass = hasKnownResult ? status : 'checking'
  const showDependencyPanel = hasKnownResult && (isOpen || hasIssue || hasSkillSyncIssue)
  const showDownstreamDependencies = hasKnownResult && !codexMissing
  const items: DependencyItem[] = hasKnownResult
    ? [
        {
          key: 'codex',
          name: 'Codex CLI',
          ok: Boolean(result.codexVersion),
          version: result.codexVersion,
          path: result.codexPath,
          missingText: result.codexError ?? 'Codex 缺失，请点击安装',
          actionText: isInstallingCodex ? '安装中...' : '安装 Codex'
        }
      ]
    : []
  const busy = isChecking || isInstallingCodex || installingSkill

  if (showDownstreamDependencies) {
    items.push(
      {
        key: 'svn',
        name: 'SVN CLI',
        ok: Boolean(result?.svnVersion),
        version: result?.svnVersion,
        path: result?.svnPath,
        missingText: 'SVN 缺失，请联系管理员安装',
        actionText: '联系管理员'
      },
      {
        key: 'skill',
        name: '代码审查 Skill',
        ok: result ? result.status !== 'missing_skill' && !result.skillError : false,
        path: '通用-代码变更审查/SKILL.md',
        missingText: result?.skillError
          ? `Skill 同步失败：${result.skillError}`
          : 'Skill 缺失，请点击安装',
        actionText: installingSkill ? '安装中...' : '安装'
      }
    )
  }

  const handleInstallSkill = async (): Promise<void> => {
    setInstallingSkill(true)
    try {
      await onInstallSkill()
    } finally {
      setInstallingSkill(false)
    }
  }

  return (
    <section className="environment-box" aria-label="本地环境状态">
      <div className="environment-summary">
        <button
          className={`dependency-alert-button ${hasIssue ? 'is-warning' : 'is-ready'}`}
          type="button"
          aria-label="查看本地依赖状态"
          onClick={() => setIsOpen((current) => !current)}
        >
          {hasIssue ? '△' : '✓'}
        </button>
        <div>
          <span className={`status-pill status-${statusClass}`}>{result ? statusLabels[status] : '检查中'}</span>
          <p className="environment-detail">
            {codexMissing
              ? `Codex ${result?.codexVersion ?? '-'}`
              : `Codex ${result?.codexVersion ?? '-'} · SVN ${result?.svnVersion ?? '-'}`}
          </p>
        </div>
        <button className="ghost-button" type="button" disabled={busy} onClick={() => void onRefresh()}>
          {isChecking && <span className="button-spinner" aria-hidden="true" />}
          {isChecking ? '检查中...' : '重新检查'}
        </button>
      </div>

      {showDependencyPanel && (
        <div className="dependency-panel">
          {items.map((item) => (
            <div
              className={`dependency-card ${item.ok ? 'is-ready' : 'is-missing'}`}
              key={item.key}
            >
              <div>
                <strong>{item.ok ? `${item.name} 已就绪` : item.missingText}</strong>
                <p>{item.version ?? item.path ?? '-'}</p>
              </div>
              {!item.ok && (
                <button
                  className="install-button"
                  type="button"
                  disabled={busy || item.key === 'svn'}
                  onClick={() => {
                    if (item.key === 'codex') {
                      void onInstallCodex()
                      return
                    }
                    if (item.key === 'skill') {
                      void handleInstallSkill()
                    }
                  }}
                >
                  {((item.key === 'codex' && isInstallingCodex) ||
                    (item.key === 'skill' && installingSkill)) && (
                    <span className="button-spinner" aria-hidden="true" />
                  )}
                  {item.actionText}
                </button>
              )}
            </div>
          ))}
          {hasIssue && (
            <p className="dependency-help">
              如本机已安装但仍显示缺失，请点击重新检查；SVN/Codex 会自动搜索 Homebrew 和系统常见路径。
            </p>
          )}
        </div>
      )}
    </section>
  )
}
