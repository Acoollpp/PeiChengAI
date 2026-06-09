import { useMutation } from "@tanstack/react-query"
import { ImagePlus, Loader2, MessageSquarePlus, Trash2 } from "lucide-react"
import {
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"

const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024
const MAX_SCREENSHOT_COUNT = 5
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"]

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  const headers = new Headers()

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  return headers
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as unknown
    if (
      typeof body === "object" &&
      body !== null &&
      "detail" in body &&
      typeof body.detail === "string" &&
      body.detail.trim()
    ) {
      return body.detail
    }
  } catch {
    // Empty or non-JSON response bodies use the fallback message.
  }

  return fallback
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function validateScreenshot(file: File) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "仅支持 PNG、JPEG 或 WebP 图片"
  }

  if (file.size > MAX_SCREENSHOT_SIZE) {
    return "截图大小不能超过 5MB"
  }

  return null
}

async function createFeedback(input: {
  description: string
  screenshots: File[]
}) {
  const formData = new FormData()
  formData.append("description", input.description)

  for (const screenshot of input.screenshots) {
    formData.append("screenshots", screenshot)
  }

  const response = await fetch(`${OpenAPI.BASE}/api/v1/feedback`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "提交意见失败"))
  }

  return response.json()
}

export function SubmitFeedbackDialog({
  onSubmitted,
}: {
  onSubmitted: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState("")
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])

  const remainingScreenshotCount = useMemo(
    () => MAX_SCREENSHOT_COUNT - screenshots.length,
    [screenshots.length],
  )

  useEffect(() => {
    const nextPreviewUrls = screenshots.map((screenshot) =>
      URL.createObjectURL(screenshot),
    )
    setPreviewUrls(nextPreviewUrls)

    return () => {
      for (const previewUrl of nextPreviewUrls) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [screenshots])

  const clearScreenshotInput = () => {
    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }

  const resetForm = () => {
    setDescription("")
    setScreenshots([])
    clearScreenshotInput()
  }

  const appendScreenshots = (files: File[]) => {
    if (files.length === 0) {
      return
    }

    const nextScreenshots = [...screenshots]
    const errors: string[] = []

    for (const file of files) {
      if (nextScreenshots.length >= MAX_SCREENSHOT_COUNT) {
        errors.push("最多只能上传 5 张截图")
        break
      }

      const error = validateScreenshot(file)
      if (error) {
        errors.push(error)
        continue
      }

      nextScreenshots.push(file)
    }

    for (const error of errors) {
      showErrorToast(error)
    }

    setScreenshots(nextScreenshots)
  }

  const removeScreenshot = (index: number) => {
    setScreenshots((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    )
    clearScreenshotInput()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    appendScreenshots(Array.from(event.target.files ?? []))
    clearScreenshotInput()
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedScreenshots = Array.from(event.clipboardData.items)
      .filter((item) => ACCEPTED_IMAGE_TYPES.includes(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    if (pastedScreenshots.length > 0) {
      appendScreenshots(pastedScreenshots)
    }
  }

  const mutation = useMutation({
    mutationFn: createFeedback,
    onSuccess: () => {
      showSuccessToast("意见已提交")
      resetForm()
      setOpen(false)
      onSubmitted()
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "提交意见失败")
    },
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedDescription = description.trim()

    if (!trimmedDescription) {
      showErrorToast("请填写问题描述")
      return
    }

    mutation.mutate({
      description: trimmedDescription,
      screenshots,
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      resetForm()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button">
          <MessageSquarePlus />
          提交意见
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>提交意见</DialogTitle>
          <DialogDescription>
            描述你遇到的问题，也可以选择或粘贴最多 5 张截图。
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="feedback-description">问题描述</Label>
            <textarea
              id="feedback-description"
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-36 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              onChange={(event) => setDescription(event.target.value)}
              onPaste={handlePaste}
              placeholder="请描述问题现象、影响范围或复现步骤"
              required
              value={description}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="feedback-screenshot">截图（可选）</Label>
            <Input
              id="feedback-screenshot"
              ref={inputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              multiple
              onChange={handleFileChange}
            />
            <p className="text-xs text-muted-foreground">
              支持 PNG、JPEG、WebP，每张最大
              5MB。也可以在问题描述框中粘贴截图，还可添加{" "}
              {remainingScreenshotCount} 张。
            </p>
          </div>

          {screenshots.length > 0 && (
            <div className="flex flex-col gap-2">
              {screenshots.map((screenshot, index) => (
                <div
                  key={`${screenshot.name}-${screenshot.size}-${screenshot.lastModified}-${index}`}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  {previewUrls[index] ? (
                    <img
                      src={previewUrls[index]}
                      alt={`已选择截图 ${index + 1} 预览`}
                      className="size-16 rounded border object-cover"
                    />
                  ) : (
                    <div className="flex size-16 items-center justify-center rounded border">
                      <ImagePlus className="text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {screenshot.name || `粘贴的截图 ${index + 1}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatFileSize(screenshot.size)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`移除截图 ${index + 1}`}
                    onClick={() => removeScreenshot(index)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              提交
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
