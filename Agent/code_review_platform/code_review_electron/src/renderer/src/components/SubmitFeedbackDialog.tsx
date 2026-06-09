import { useEffect, useRef, useState } from 'react'

const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024
const ACCEPTED_SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp']

type SubmitFeedbackDialogProps = {
  open: boolean
  onClose: () => void
}

export function SubmitFeedbackDialog({
  open,
  onClose
}: SubmitFeedbackDialogProps): React.JSX.Element | null {
  const [description, setDescription] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setDescription('')
      setScreenshot(null)
      setError('')
      setIsSubmitting(false)
      resetFileInput()
    }
  }, [open])

  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null)
      return
    }

    if (!URL.createObjectURL) {
      setPreviewUrl(null)
      return
    }

    const objectUrl = URL.createObjectURL(screenshot)
    setPreviewUrl(objectUrl)

    return () => {
      URL.revokeObjectURL?.(objectUrl)
    }
  }, [screenshot])

  function resetFileInput(): void {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleClose = (): void => {
    setDescription('')
    setScreenshot(null)
    setError('')
    setIsSubmitting(false)
    resetFileInput()
    onClose()
  }

  if (!open) {
    return null
  }

  const validateScreenshot = (file: File): string => {
    if (!ACCEPTED_SCREENSHOT_TYPES.includes(file.type)) {
      return '仅支持 PNG、JPG 或 WEBP 截图'
    }

    if (file.size > MAX_SCREENSHOT_SIZE) {
      return '截图不能超过 5MB'
    }

    return ''
  }

  const selectScreenshot = (file: File): void => {
    const validationError = validateScreenshot(file)
    if (validationError) {
      setScreenshot(null)
      resetFileInput()
      setError(validationError)
      return
    }

    setScreenshot(file)
    setError('')
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (!file) {
      setScreenshot(null)
      return
    }

    selectScreenshot(file)
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const imageFile = Array.from(event.clipboardData.files)[0]

    if (imageFile) {
      selectScreenshot(imageFile)
    }
  }

  const handleRemoveScreenshot = (): void => {
    setScreenshot(null)
    resetFileInput()
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const normalizedDescription = description.trim()
    if (!normalizedDescription) {
      setError('请填写问题描述')
      return
    }

    setError('')
    setIsSubmitting(true)

    try {
      await window.codeReview.submitFeedback({
        description: normalizedDescription,
        screenshot
      })
      handleClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '意见提交失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="submit-feedback-title">
      <form className="dialog-card submit-feedback-dialog" onSubmit={(event) => void handleSubmit(event)}>
        <button className="dialog-close" type="button" aria-label="关闭" onClick={handleClose}>
          ×
        </button>
        <h2 id="submit-feedback-title">提交意见</h2>
        <p className="dialog-desc">描述你遇到的问题，截图可通过选择文件或粘贴添加。</p>

        <label className="field submit-feedback-field">
          问题描述
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onPaste={handlePaste}
            rows={6}
            placeholder="请描述问题现象、操作步骤或期望结果"
          />
        </label>

        <div className="feedback-screenshot-block">
          <label className="feedback-screenshot-picker">
            <span>选择截图</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="选择截图"
              onChange={handleFileChange}
            />
          </label>
          <p className="feedback-paste-hint">支持 PNG、JPG、WEBP，最大 5MB；可直接在描述框粘贴截图。</p>

          {screenshot && (
            <div className="feedback-screenshot-preview">
              {previewUrl && <img src={previewUrl} alt="问题截图预览" />}
              <div>
                <strong>{screenshot.name}</strong>
                <span>{formatFileSize(screenshot.size)}</span>
              </div>
              <button className="ghost-button" type="button" onClick={handleRemoveScreenshot}>
                移除
              </button>
            </div>
          )}
        </div>

        {error && <p className="form-error feedback-error">{error}</p>}

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={handleClose} disabled={isSubmitting}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '提交中...' : '提交意见'}
          </button>
        </div>
      </form>
    </div>
  )
}

const formatFileSize = (size: number): string => {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))}KB`
  }

  return `${(size / 1024 / 1024).toFixed(1)}MB`
}
