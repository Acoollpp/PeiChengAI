import type { ReviewTaskStatus } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type DisplayableReviewTaskStatus =
  | ReviewTaskStatus
  | (string & Record<never, never>)

const reviewTaskStatusLabels: Record<ReviewTaskStatus, string> = {
  created: "已创建",
  checking_environment: "检查环境",
  running_codex: "审查中",
  uploading_report: "上传报告",
  success: "已完成",
  failed: "失败",
  environment_error: "环境异常",
  cancelled: "已取消",
}

function isKnownReviewTaskStatus(
  status: DisplayableReviewTaskStatus,
): status is ReviewTaskStatus {
  return status in reviewTaskStatusLabels
}

export function formatReviewTaskDateTime(value?: string | null) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  const pad = (part: number) => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function reviewTaskStatusLabel(status: DisplayableReviewTaskStatus) {
  return isKnownReviewTaskStatus(status)
    ? reviewTaskStatusLabels[status]
    : status
}

export function ReviewTaskStatusBadge({
  status,
}: {
  status: DisplayableReviewTaskStatus
}) {
  const knownStatus = isKnownReviewTaskStatus(status) ? status : undefined

  return (
    <Badge
      variant={knownStatus ? "secondary" : "outline"}
      className={cn(
        knownStatus === "success" &&
          "border-green-200 bg-green-50 text-green-700",
        (knownStatus === "failed" || knownStatus === "environment_error") &&
          "border-red-200 bg-red-50 text-red-700",
        (knownStatus === "checking_environment" ||
          knownStatus === "running_codex" ||
          knownStatus === "uploading_report") &&
          "border-blue-200 bg-blue-50 text-blue-700",
        (knownStatus === "created" || knownStatus === "cancelled") &&
          "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {reviewTaskStatusLabel(status)}
    </Badge>
  )
}
