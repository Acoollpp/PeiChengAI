const ipcErrorPrefix = /^Error invoking remote method '[^']+': Error:\s*/

export const toUserFacingIpcErrorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.replace(ipcErrorPrefix, '').replace(/^Error:\s*/, '').trim() || fallback
}
