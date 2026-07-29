import type { ReviewTaskPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type IssueFeedbackProgress = Pick<
  ReviewTaskPublic,
  | "evaluated_issue_count"
  | "feedback_submitted_at"
  | "has_issue_feedback_draft"
  | "issue_count"
>

export type IssueFeedbackStatus = "not_started" | "draft" | "submitted"

export function getIssueFeedbackStatus(
  task: IssueFeedbackProgress,
): IssueFeedbackStatus {
  if (task.feedback_submitted_at) {
    return "submitted"
  }

  return task.has_issue_feedback_draft || (task.evaluated_issue_count ?? 0) > 0
    ? "draft"
    : "not_started"
}

export function IssueFeedbackStatusBadge({
  status,
}: {
  status: IssueFeedbackStatus
}) {
  const labels: Record<IssueFeedbackStatus, string> = {
    not_started: "未开始",
    draft: "草稿",
    submitted: "已提交",
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        status === "not_started" &&
          "border-slate-200 bg-slate-50 text-slate-700",
        status === "draft" && "border-amber-200 bg-amber-50 text-amber-700",
        status === "submitted" &&
          "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {labels[status]}
    </Badge>
  )
}

export function ReportFeedbackHelpfulBadge({
  helpful,
}: {
  helpful?: boolean | null
}) {
  if (helpful === true) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-200 bg-emerald-50 text-emerald-700"
      >
        有帮助
      </Badge>
    )
  }

  if (helpful === false) {
    return <Badge variant="secondary">没帮助</Badge>
  }

  return (
    <Badge
      variant="outline"
      className="border-slate-200 bg-slate-50 text-slate-700"
    >
      未反馈
    </Badge>
  )
}
