export const normalizeRevisionDigits = (value: string): string =>
  value.trim().replace(/^[rR]/, '')

export const isRevisionValue = (value: string): boolean => /^[rR]?\d+$/.test(value.trim())

export const formatRevisionLabel = (value: string): string =>
  `r${normalizeRevisionDigits(value)}`
