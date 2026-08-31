export const REPORT_IMAGE_INVALID_UTF8 = 'REPORT_IMAGE_INVALID_UTF8' as const

export const REPORT_IMAGE_DECRYPTION_REQUIRED_MESSAGE =
  '图片可能被 IPGSD 加密，请解密后重试'

export interface ReportUploadRecovery {
  failureCode: typeof REPORT_IMAGE_INVALID_UTF8
  stage: 'uploading_report'
  assetPaths: string[]
  availability: 'ready' | 'source_missing' | 'other_client'
}
