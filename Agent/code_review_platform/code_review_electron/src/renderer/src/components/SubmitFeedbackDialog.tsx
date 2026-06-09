import { useEffect, useRef, useState } from 'react'

const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024
const MAX_SCREENSHOTS = 5
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
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      resetForm()
    }
  }, [open])

  useEffect(() => {
    if (screenshots.length === 0 || !URL.createObjectURL) {
      setPreviewUrls([])
      return
    }

    const objectUrls = screenshots.map((screenshot) => URL.createObjectURL(screenshot))
    setPreviewUrls(objectUrls)

    return () => {
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL?.(objectUrl))
    }
  }, [screenshots])

  function resetFileInput(): void {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function resetForm(): void {
    setDescription('')
    setScreenshots([])
    setError('')
    setIsSubmitting(false)
    resetFileInput()
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

  const addScreenshots = (selectedFiles: File[]): void => {
    if (selectedFiles.length === 0) {
      return
    }

    const validationError = selectedFiles.map(validateScreenshot).find(Boolean)
    if (validationError) {
      resetFileInput()
      setError(validationError)
      return
    }

    setScreenshots((currentScreenshots) => {
      const availableSlots = MAX_SCREENSHOTS - currentScreenshots.length
      if (availableSlots <= 0) {
        setError(`最多只能添加 ${MAX_SCREENSHOTS} 张截图`)
        return currentScreenshots
      }

      const acceptedFiles = selectedFiles.slice(0, availableSlots)
      setError(
        acceptedFiles.length < selectedFiles.length ? `最多只能添加 ${MAX_SCREENSHOTS} 张截图` : ''
      )
      return [...currentScreenshots, ...acceptedFiles]
    })
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
    setScreenshots((currentScreenshots) =>
      currentScreenshots.filter((_screenshot, index) => index !== indexToRemove)
    )
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
        screenshots
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
                <div className="feedback-screenshot-preview" key={`${screenshot.name}-${screenshot.size}-${index}`}>
                  {previewUrls[index] && <img src={previewUrls[index]} alt={`${screenshot.name} 预览`} />}
                  <div className="feedback-screenshot-meta">
                    <strong title={screenshot.name}>{screenshot.name}</strong>
                    <span>{formatFileSize(screenshot.size)}</span>
                  </div>
                  <button
                    className="ghost-button"
                    type="button"
                    aria-label={`移除 ${screenshot.name}`}
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
