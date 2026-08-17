// 最近 SVN 地址历史：记录用户成功提交过的 SVN 地址，供任务表单聚焦时快捷回填。
// 从旧 TaskForm 迁移而来；存储键保持不变，老客户端的历史地址可无缝继承。

/** localStorage 存储键。与旧 TaskForm 实现保持一致，切勿改动，否则历史丢失。 */
export const RECENT_SVN_URLS_STORAGE_KEY = 'code-review:recent-svn-urls'

/** 最多保留的最近地址条数。 */
export const MAX_RECENT_SVN_URLS = 3

/** 读取最近地址；存储缺失、损坏或结构异常时一律降级为空列表，不影响表单使用。 */
export const readRecentSvnUrls = (): string[] => {
  try {
    const value = localStorage.getItem(RECENT_SVN_URLS_STORAGE_KEY)
    if (!value) {
      return []
    }

    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((item): item is string => typeof item === 'string')
      .slice(0, MAX_RECENT_SVN_URLS)
  } catch {
    return []
  }
}

const writeRecentSvnUrls = (urls: string[]): void => {
  try {
    localStorage.setItem(RECENT_SVN_URLS_STORAGE_KEY, JSON.stringify(urls))
  } catch {
    // 写入失败（如隐私模式限制）时静默忽略：历史只是便捷功能，不应阻断任务创建。
  }
}

/** 记录一条成功提交的地址：去重后置顶，最多保留 {@link MAX_RECENT_SVN_URLS} 条；空地址不记录。 */
export const rememberRecentSvnUrl = (svnUrl: string): string[] => {
  if (!svnUrl) {
    return readRecentSvnUrls()
  }

  const nextUrls = [svnUrl, ...readRecentSvnUrls().filter((item) => item !== svnUrl)].slice(
    0,
    MAX_RECENT_SVN_URLS
  )
  writeRecentSvnUrls(nextUrls)
  return nextUrls
}
