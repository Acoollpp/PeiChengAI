import { useQuery } from "@tanstack/react-query"
import {
  CircleHelp,
  FileDown,
  FileText,
  Loader2,
  MessageSquareText,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import {
  OpenAPI,
  type ReviewTaskIssuePublic,
  type ReviewTaskPublic,
  ReviewTasksService,
} from "@/client"
import {
  getIssueFeedbackStatus,
  IssueFeedbackStatusBadge,
  ReportFeedbackHelpfulBadge,
} from "@/components/Tasks/feedback-display"
import {
  formatReviewTaskDateTime,
  ReviewTaskStatusBadge,
} from "@/components/Tasks/task-display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

type DetailTab = "feedback" | "report"

function formatRevisionRange(task: ReviewTaskPublic) {
  if (task.old_revision.trim().toLowerCase() === "r0") {
    return `全量审查 ${task.new_revision}`
  }

  return `${task.old_revision} → ${task.new_revision}`
}

function customReviewModeLabel(mode: ReviewTaskPublic["custom_review_mode"]) {
  switch (mode) {
    case "dual_revision":
      return "变更代码审查模式"
    case "new_revision_full":
      return "全量代码审查模式"
    default:
      return "未记录"
  }
}

function DetailField({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  )
}

function IssueEvaluationBadge({ helpful }: { helpful?: boolean | null }) {
  if (helpful === true) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-200 bg-emerald-50 text-emerald-700"
      >
        <ThumbsUp aria-hidden="true" />
        有帮助
      </Badge>
    )
  }

  if (helpful === false) {
    return (
      <Badge
        variant="outline"
        className="border-amber-200 bg-amber-50 text-amber-700"
      >
        <ThumbsDown aria-hidden="true" />
        没帮助
      </Badge>
    )
  }

  return (
    <Badge variant="secondary">
      <CircleHelp aria-hidden="true" />
      未评价
    </Badge>
  )
}

function IssueFeedbackList({ issues }: { issues: ReviewTaskIssuePublic[] }) {
  if (issues.length === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center border-y px-6 text-center text-sm text-muted-foreground">
        报告未识别到需要反馈的审查问题。
      </div>
    )
  }

  const orderedIssues = [...issues].sort(
    (left, right) => left.order - right.order,
  )

  return (
    <ol className="divide-y border-y" data-testid="issue-feedback-list">
      {orderedIssues.map((issue, index) => (
        <li
          key={issue.id}
          className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] gap-4 py-5"
          data-issue-order={issue.order}
        >
          <div className="flex flex-col items-center gap-2 border-r pr-4">
            <span className="font-mono text-lg font-semibold tabular-nums text-primary">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="h-full w-px bg-border" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-4">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <h3 className="min-w-0 flex-1 break-words text-sm font-semibold leading-6 [overflow-wrap:anywhere]">
                {issue.issue_text}
              </h3>
              <IssueEvaluationBadge helpful={issue.helpful} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                问题描述原文
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
                {issue.description_text || "未提供"}
              </p>
            </div>
            <div className="border-l-2 border-primary/30 pl-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <MessageSquareText className="size-3.5" aria-hidden="true" />
                反馈说明
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
                {issue.feedback_text?.trim() || "未填写"}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function LegacyFeedback({ task }: { task: ReviewTaskPublic }) {
  return (
    <div className="space-y-4 border-y py-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">历史报告反馈</h3>
        <ReportFeedbackHelpfulBadge helpful={task.report_feedback_helpful} />
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">有用信息</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
          {task.report_feedback_helpful
            ? task.report_feedback_useful_issues_text?.trim() || "未填写"
            : "-"}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        此任务使用历史报告级反馈，不包含逐问题反馈记录。
      </p>
    </div>
  )
}

async function downloadPdfReport(task: ReviewTaskPublic) {
  const token = localStorage.getItem("access_token")
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks/${task.id}/pdf/download`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )

  if (!response.ok) {
    throw new Error("Failed to download PDF report")
  }

  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = task.pdf_report_name || `review-task-${task.id}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

function TaskDetailContent({
  task,
  activeTab,
  setActiveTab,
}: {
  task: ReviewTaskPublic
  activeTab: DetailTab
  setActiveTab: (tab: DetailTab) => void
}) {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const isIssueFeedbackTask = task.feedback_protocol_version === 1
  const issueQuery = useQuery({
    enabled: isIssueFeedbackTask,
    queryFn: () => ReviewTasksService.readReviewTaskIssues({ taskId: task.id }),
    queryKey: ["review-task-issues", task.id],
    staleTime: 30_000,
  })
  const reportQuery = useQuery({
    enabled: activeTab === "report" && Boolean(task.report_path),
    queryFn: () => ReviewTasksService.readReviewTaskReport({ taskId: task.id }),
    queryKey: ["review-task-report", task.id],
    staleTime: 5 * 60 * 1000,
  })
  const evaluatedCount = task.evaluated_issue_count ?? 0
  const issueCount = task.issue_count ?? 0
  const feedbackPercent = issueCount
    ? Math.min(100, Math.round((evaluatedCount / issueCount) * 100))
    : task.feedback_submitted_at
      ? 100
      : 0
  const customReviewRule = task.custom_review_rule?.trim()

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true)
    try {
      await downloadPdfReport(task)
    } catch {
      toast.error("PDF 报告下载失败")
    } finally {
      setIsDownloadingPdf(false)
    }
  }

  return (
    <div className="min-h-0 overflow-y-auto px-6 pb-6">
      <section className="border-b pb-5">
        <dl className="grid gap-x-8 gap-y-4 border-y py-4 md:grid-cols-4">
          <DetailField label="提交人" value={task.user_name || "-"} />
          <DetailField label="SVN账号" value={task.svn_username || "-"} />
          <DetailField label="所属部门" value={task.department_name || "-"} />
          <div>
            <dt className="text-xs text-muted-foreground">任务状态</dt>
            <dd className="mt-1">
              <ReviewTaskStatusBadge status={task.status} />
            </dd>
          </div>
          <DetailField label="审查版本" value={formatRevisionRange(task)} />
          <DetailField
            label="开始时间"
            value={formatReviewTaskDateTime(task.started_at)}
          />
          <DetailField
            label="结束时间"
            value={formatReviewTaskDateTime(task.finished_at)}
          />
          <DetailField
            label="任务编号"
            value={task.id}
            className="font-mono text-xs"
          />
          <DetailField
            label="SVN地址"
            value={task.svn_url}
            className="md:col-span-4"
          />
        </dl>

        {customReviewRule ? (
          <section
            className="mt-5 border-l-2 border-primary/40 bg-muted/30 px-4 py-3"
            data-testid="custom-review-input-detail"
          >
            <h2 className="text-sm font-semibold">自定义审查输入</h2>
            <dl className="mt-3 grid gap-4 md:grid-cols-4">
              <DetailField
                label="审查模式"
                value={customReviewModeLabel(task.custom_review_mode)}
              />
              <div className="md:col-span-4">
                <dt className="text-xs text-muted-foreground">规则正文</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                  {customReviewRule}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[18rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">反馈进度</h2>
              {isIssueFeedbackTask ? (
                <IssueFeedbackStatusBadge
                  status={getIssueFeedbackStatus(task)}
                />
              ) : (
                <ReportFeedbackHelpfulBadge
                  helpful={task.report_feedback_helpful}
                />
              )}
            </div>
            {isIssueFeedbackTask ? (
              <>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">已评价问题</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {evaluatedCount} / {issueCount}
                  </span>
                </div>
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="问题反馈进度"
                  aria-valuemin={0}
                  aria-valuemax={issueCount}
                  aria-valuenow={evaluatedCount}
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width]",
                      task.feedback_submitted_at
                        ? "bg-emerald-500"
                        : "bg-amber-500",
                    )}
                    style={{ width: `${feedbackPercent}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                历史任务使用报告级反馈。
              </p>
            )}
          </div>
          <div className="min-w-56 text-sm">
            <p className="text-xs text-muted-foreground">反馈提交时间</p>
            <p className="mt-1 font-medium">
              {formatReviewTaskDateTime(task.feedback_submitted_at)}
            </p>
          </div>
          {task.pdf_report_path ? (
            <Button
              type="button"
              variant="outline"
              disabled={isDownloadingPdf}
              onClick={() => void handleDownloadPdf()}
            >
              {isDownloadingPdf ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <FileDown aria-hidden="true" />
              )}
              {isIssueFeedbackTask ? "下载最终 PDF" : "下载 PDF 报告"}
            </Button>
          ) : null}
        </div>
      </section>

      <Tabs
        className="mt-5 gap-4"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as DetailTab)}
      >
        <TabsList className="rounded-md" aria-label="任务详情视图">
          <TabsTrigger value="feedback">
            <MessageSquareText aria-hidden="true" />
            问题反馈
          </TabsTrigger>
          <TabsTrigger value="report">
            <FileText aria-hidden="true" />
            原始报告
          </TabsTrigger>
        </TabsList>
        <TabsContent value="feedback">
          {isIssueFeedbackTask && issueQuery.isLoading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2
                className="mr-2 size-4 animate-spin"
                aria-hidden="true"
              />
              正在加载问题反馈
            </div>
          ) : null}
          {isIssueFeedbackTask && issueQuery.isError ? (
            <div className="flex min-h-48 items-center justify-center border-y px-6 text-center text-sm text-destructive">
              问题反馈加载失败，请稍后重试。
            </div>
          ) : null}
          {isIssueFeedbackTask && issueQuery.data ? (
            <IssueFeedbackList issues={issueQuery.data.data} />
          ) : null}
          {!isIssueFeedbackTask ? <LegacyFeedback task={task} /> : null}
        </TabsContent>
        <TabsContent value="report">
          {!task.report_path ? (
            <div className="flex min-h-48 items-center justify-center border-y px-6 text-center text-sm text-muted-foreground">
              当前任务没有可查看的原始报告。
            </div>
          ) : null}
          {task.report_path && reportQuery.isLoading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2
                className="mr-2 size-4 animate-spin"
                aria-hidden="true"
              />
              正在加载原始报告
            </div>
          ) : null}
          {task.report_path && reportQuery.isError ? (
            <div className="flex min-h-48 items-center justify-center border-y px-6 text-center text-sm text-destructive">
              原始报告加载失败，请稍后重试。
            </div>
          ) : null}
          {typeof reportQuery.data === "string" ? (
            <pre className="max-w-full whitespace-pre-wrap break-words border-y bg-muted/20 p-5 font-mono text-xs leading-6 [overflow-wrap:anywhere]">
              {reportQuery.data}
            </pre>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function ReviewTaskDetailDialog({
  task,
  open,
  onOpenChange,
}: {
  task: Pick<ReviewTaskPublic, "id"> | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("feedback")
  const taskId = task?.id
  const detailQuery = useQuery({
    enabled: open && Boolean(taskId),
    queryFn: () =>
      ReviewTasksService.readReviewTask({ taskId: taskId as string }),
    queryKey: ["review-task-detail", taskId],
    staleTime: 30_000,
  })

  useEffect(() => {
    if (open) {
      setActiveTab("feedback")
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[min(88vh,900px)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:max-w-5xl"
        data-testid="review-task-detail-dialog"
      >
        <DialogHeader className="border-b px-6 pt-6 pb-4 pr-14">
          <DialogTitle>任务详情</DialogTitle>
          <DialogDescription className="font-mono">
            任务编号 {taskId || "-"}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isLoading ? (
          <div className="flex min-h-0 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            正在加载任务详情
          </div>
        ) : null}

        {detailQuery.isError ? (
          <div className="flex min-h-0 items-center justify-center px-8 text-center text-sm text-destructive">
            任务详情加载失败，任务可能已删除或当前账号无权查看。
          </div>
        ) : null}

        {detailQuery.data ? (
          <TaskDetailContent
            task={detailQuery.data}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
