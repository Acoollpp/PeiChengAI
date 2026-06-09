import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { type FeedbackPublic, OpenAPI } from "@/client"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  feedbackStatusLabel,
  feedbackStatusVariant,
  formatFeedbackDateTime,
  formatFeedbackFileSize,
} from "./columns"

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  const headers = new Headers()

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  return headers
}

async function fetchScreenshot(feedbackId: string) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/feedback/${feedbackId}/screenshot`,
    { headers: authHeaders() },
  )

  if (!response.ok) {
    throw new Error("加载截图失败")
  }

  return response.blob()
}

export function FeedbackDetailDialog({
  feedback,
  open,
  onOpenChange,
}: {
  feedback: FeedbackPublic | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(false)
  const [screenshotError, setScreenshotError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !feedback?.has_screenshot) {
      setScreenshotUrl(null)
      setScreenshotError(null)
      return
    }

    let isMounted = true
    let objectUrl: string | null = null
    setIsLoadingScreenshot(true)
    setScreenshotUrl(null)
    setScreenshotError(null)

    fetchScreenshot(feedback.id)
      .then((blob) => {
        if (!isMounted) {
          return
        }

        objectUrl = URL.createObjectURL(blob)
        setScreenshotUrl(objectUrl)
      })
      .catch((error) => {
        if (isMounted) {
          setScreenshotUrl(null)
          setScreenshotError(
            error instanceof Error ? error.message : "加载截图失败",
          )
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingScreenshot(false)
        }
      })

    return () => {
      isMounted = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [feedback?.id, feedback?.has_screenshot, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>意见详情</DialogTitle>
          <DialogDescription>查看完整问题描述和截图。</DialogDescription>
        </DialogHeader>

        {feedback && (
          <div className="flex flex-col gap-5">
            <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground">提交人</div>
                <div className="text-sm font-medium">
                  {feedback.user_name || "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">SVN账号</div>
                <div className="text-sm font-medium">
                  {feedback.svn_username || "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">提交时间</div>
                <div className="text-sm font-medium">
                  {formatFeedbackDateTime(feedback.created_at)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">解决状态</div>
                <Badge
                  variant={feedbackStatusVariant(feedback.status)}
                  className={cn(
                    feedback.status === "processing" &&
                      "border-blue-200 bg-blue-50 text-blue-700",
                    feedback.status === "resolved" &&
                      "border-green-200 bg-green-50 text-green-700",
                  )}
                >
                  {feedbackStatusLabel(feedback.status)}
                </Badge>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">问题描述</div>
              <div className="whitespace-pre-wrap rounded-md border bg-muted/20 p-4 text-sm leading-6">
                {feedback.description}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">截图</div>
              {!feedback.has_screenshot ? (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">
                  未上传截图
                </div>
              ) : (
                <div className="rounded-md border p-3">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{feedback.screenshot_name || "截图"}</span>
                    <span>
                      {formatFeedbackFileSize(feedback.screenshot_size)}
                    </span>
                  </div>
                  {isLoadingScreenshot && (
                    <div className="flex h-48 items-center justify-center text-muted-foreground">
                      <Loader2 className="mr-2 animate-spin" />
                      加载截图中
                    </div>
                  )}
                  {screenshotError && (
                    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                      {screenshotError}
                    </div>
                  )}
                  {screenshotUrl && !isLoadingScreenshot && (
                    <img
                      src={screenshotUrl}
                      alt="意见截图预览"
                      className="max-h-[60vh] w-full rounded border object-contain"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
