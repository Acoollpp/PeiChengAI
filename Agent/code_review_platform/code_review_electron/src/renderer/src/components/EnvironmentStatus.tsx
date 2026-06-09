import { useState } from 'react'

import type { EnvironmentCheckResult } from '../code-review-api'

type EnvironmentStatusProps = {
  result: EnvironmentCheckResult | null
  isChecking: boolean
  isInstallingSkillDuringCheck: boolean
  isInstallingCodex: boolean
  isInstallingSvn: boolean
  onRefresh: () => Promise<void>
  onInstallCodex: () => Promise<void>
  onInstallSvn: () => Promise<void>
  onInstallSkill: () => Promise<void>
}

const statusLabels: Record<NonNullable<EnvironmentCheckResult['status']>, string> = {
  ready: '环境就绪',
  missing_codex: '缺少 Codex CLI',
  missing_svn: '缺少 SVN CLI',
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
  isInstallingSkillDuringCheck,
  isInstallingCodex,
  isInstallingSvn,
  onRefresh,
  onInstallCodex,
  onInstallSvn,
  onInstallSkill
}: EnvironmentStatusProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [installingSkill, setInstallingSkill] = useState(false)
  const status = result?.status ?? 'failed'
  const hasKnownResult = result !== null
  const hasIssue = hasKnownResult && status !== 'ready'
  const hasSkillSyncIssue = Boolean(result?.skillError)
  const codexMissing = hasKnownResult && status === 'missing_codex'
  const isUnknownChecking = !hasKnownResult
  const statusClass = hasKnownResult ? status : 'checking'
  const checkingStatusText = isInstallingSkillDuringCheck ? '安装 Skill 中' : '检查中'
  const refreshText = isInstallingSkillDuringCheck ? '安装 Skill 中...' : '检查中...'
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
          missingText: result.codexError ?? 'Codex CLI 缺失，请点击安装',
          actionText: isInstallingCodex ? '安装中...' : '安装 Codex CLI'
        }
      ]
    : []
  const busy = isChecking || isInstallingCodex || isInstallingSvn || installingSkill

  if (showDownstreamDependencies) {
    items.push(
      {
        key: 'svn',
        name: 'SVN CLI',
        ok: Boolean(result?.svnVersion),
        version: result?.svnVersion,
        path: result?.svnPath,
        missingText: result?.svnError ?? 'SVN CLI 缺失，请点击安装',
        actionText: isInstallingSvn ? '安装中...' : '安装 SVN CLI'
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
          className={`dependency-alert-button ${
            isUnknownChecking ? 'is-checking' : hasIssue ? 'is-warning' : 'is-ready'
          }`}
          type="button"
          aria-label="查看本地依赖状态"
          aria-expanded={showDependencyPanel}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isUnknownChecking ? (
            <span className="button-spinner alert-spinner" aria-hidden="true" />
          ) : hasIssue ? (
            '△'
          ) : (
            '✓'
          )}
        </button>
        <div>
          <span className={`status-pill status-${statusClass}`}>
            {result ? statusLabels[status] : checkingStatusText}
          </span>
          <p className="environment-detail">
            {codexMissing
              ? `Codex ${result?.codexVersion ?? '-'}`
              : `Codex CLI ${result?.codexVersion ?? '-'} · SVN CLI ${result?.svnVersion ?? '-'}`}
          </p>
        </div>
        <button className="ghost-button" type="button" disabled={busy} onClick={() => void onRefresh()}>
          {isChecking && <span className="button-spinner" aria-hidden="true" />}
          {isChecking ? refreshText : '重新检查'}
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
                  disabled={busy}
                  onClick={() => {
                    if (item.key === 'codex') {
                      void onInstallCodex()
                      return
                    }
                    if (item.key === 'svn') {
                      void onInstallSvn()
                      return
                    }
                    if (item.key === 'skill') {
                      void handleInstallSkill()
                    }
                  }}
                >
                  {((item.key === 'codex' && isInstallingCodex) ||
                    (item.key === 'svn' && isInstallingSvn) ||
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
              如本机已安装但仍显示缺失，请点击重新检查；SVN CLI/Codex CLI 会自动搜索 Homebrew 和系统常见路径。
            </p>
          )}
        </div>
      )}
    </section>
  )
}
