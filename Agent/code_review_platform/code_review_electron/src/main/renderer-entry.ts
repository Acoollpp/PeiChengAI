export const isWorkbenchPreviewEnabled = (
  value: string | undefined = process.env.CODE_REVIEW_UI_PREVIEW
): boolean => value === '1'

export const getRendererDocumentName = (previewEnabled: boolean): 'index.html' | 'preview.html' =>
  previewEnabled ? 'preview.html' : 'index.html'

export const getDevelopmentRendererUrl = (
  baseUrl: string,
  previewEnabled: boolean
): string => {
  if (!previewEnabled) return baseUrl
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL('preview.html', normalizedBaseUrl).toString()
}
