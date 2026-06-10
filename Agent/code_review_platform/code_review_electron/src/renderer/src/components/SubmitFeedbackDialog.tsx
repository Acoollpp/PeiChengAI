import { useEffect, useRef, useState } from 'react'

const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024
const MAX_SCREENSHOTS = 5
const ACCEPTED_SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp']

type ScreenshotItem = {
  id: string
  file: File
  previewUrl: string
}

type SubmitFeedbackDialogProps = {
  open: boolean
  onClose: () => void
}

export function SubmitFeedbackDialog({
  open,
  onClose
}: SubmitFeedbackDialogProps): React.JSX.Element | null {
  const [description, setDescription] = useState('')
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([])
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const screenshotsRef = useRef<ScreenshotItem[]>([])
  const nextScreenshotIdRef = useRef(0)

  useEffect(() => {
    if (!open) {
      resetForm()
    }
  }, [open])

  useEffect(() => () => revokeScreenshots(screenshotsRef.current), [])

  function resetFileInput(): void {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function resetForm(): void {
    revokeScreenshots(screenshotsRef.current)
    setDescription('')
    updateScreenshots([])
    setError('')
    setIsSubmitting(false)
    resetFileInput()
  }

  function updateScreenshots(nextScreenshots: ScreenshotItem[]): void {
    screenshotsRef.current = nextScreenshots
    setScreenshots(nextScreenshots)
  }

  const handleClose = (): void => {
    resetForm()
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

  const createScreenshotItem = (file: File): ScreenshotItem => {
    nextScreenshotIdRef.current += 1
    return {
      id: `screenshot-${nextScreenshotIdRef.current}`,
      file,
      previewUrl: URL.createObjectURL?.(file) ?? ''
    }
  }

  const addScreenshots = (selectedFiles: File[]): void => {
    if (selectedFiles.length === 0) {
      return
    }

    const availableSlots = MAX_SCREENSHOTS - screenshotsRef.current.length
    if (availableSlots <= 0) {
      setError(`最多只能添加 ${MAX_SCREENSHOTS} 张截图`)
      resetFileInput()
      return
    }

    const acceptedFiles = selectedFiles.slice(0, availableSlots)
    const validationError = acceptedFiles.map(validateScreenshot).find(Boolean)
    if (validationError) {
      setError(validationError)
      resetFileInput()
      return
    }

    updateScreenshots([...screenshotsRef.current, ...acceptedFiles.map(createScreenshotItem)])
    setError(acceptedFiles.length < selectedFiles.length ? `最多只能添加 ${MAX_SCREENSHOTS} 张截图` : '')
    resetFileInput()
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    addScreenshots(Array.from(event.target.files ?? []))
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const pastedFiles = Array.from(event.clipboardData.files)

    if (pastedFiles.length > 0) {
      addScreenshots(pastedFiles)
    }
  }

  const handleRemoveScreenshot = (indexToRemove: number): void => {
    const removedScreenshot = screenshotsRef.current[indexToRemove]
    if (removedScreenshot) {
      URL.revokeObjectURL?.(removedScreenshot.previewUrl)
    }

    updateScreenshots(screenshotsRef.current.filter((_screenshot, index) => index !== indexToRemove))
    setError('')
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
        screenshots: screenshots.map((screenshot) => screenshot.file)
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
        <div className="submit-feedback-scroll">
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
                multiple
                onChange={handleFileChange}
              />
            </label>
            <p className="feedback-paste-hint">
              支持 PNG、JPG、WEBP，最多 {MAX_SCREENSHOTS} 张，每张最大 5MB；可直接在描述框粘贴截图。
            </p>

            {screenshots.length > 0 && (
              <div className="feedback-screenshot-grid" aria-label="已选择截图">
                {screenshots.map((screenshot, index) => (
                  <div className="feedback-screenshot-preview" key={screenshot.id}>
                    {screenshot.previewUrl && (
                      <img src={screenshot.previewUrl} alt={`${screenshot.file.name} 预览`} />
                    )}
                    <div className="feedback-screenshot-meta">
                      <strong title={screenshot.file.name}>{screenshot.file.name}</strong>
                      <span>{formatFileSize(screenshot.file.size)}</span>
                    </div>
                    <button
                      className="ghost-button"
                      type="button"
                      aria-label={`移除 ${screenshot.file.name}`}
                      onClick={() => handleRemoveScreenshot(index)}
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="form-error feedback-error">{error}</p>}
        </div>

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

const revokeScreenshots = (screenshots: ScreenshotItem[]): void => {
  screenshots.forEach((screenshot) => {
    URL.revokeObjectURL?.(screenshot.previewUrl)
  })
}
