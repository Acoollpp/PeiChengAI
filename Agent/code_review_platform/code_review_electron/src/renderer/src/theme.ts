export type ClientTheme = 'light' | 'dark'

export const CLIENT_THEME_STORAGE_KEY = 'codeReview.clientTheme'

export const DEFAULT_CLIENT_THEME: ClientTheme = 'light'

export const isClientTheme = (value: unknown): value is ClientTheme =>
  value === 'light' || value === 'dark'

export const normalizeClientTheme = (value: unknown): ClientTheme =>
  isClientTheme(value) ? value : DEFAULT_CLIENT_THEME

export const nextClientTheme = (theme: ClientTheme): ClientTheme =>
  theme === 'light' ? 'dark' : 'light'

const getLocalStorage = (): Storage | undefined => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export const readStoredClientTheme = (storage: Storage | undefined = getLocalStorage()): ClientTheme => {
  try {
    return normalizeClientTheme(storage?.getItem(CLIENT_THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_CLIENT_THEME
  }
}

export const saveClientTheme = (
  theme: ClientTheme,
  storage: Storage | undefined = getLocalStorage()
): void => {
  try {
    storage?.setItem(CLIENT_THEME_STORAGE_KEY, theme)
  } catch {
    // 主题是本机偏好，保存失败不能影响认证、任务创建或报告查看主流程。
  }
}

export const applyClientTheme = (
  theme: ClientTheme,
  root: HTMLElement = document.documentElement
): void => {
  try {
    root.dataset.theme = normalizeClientTheme(theme)
  } catch {
    try {
      root.dataset.theme = DEFAULT_CLIENT_THEME
    } catch {
      // DOM 写入失败时保持静默，避免阻断主流程。
    }
  }
}
