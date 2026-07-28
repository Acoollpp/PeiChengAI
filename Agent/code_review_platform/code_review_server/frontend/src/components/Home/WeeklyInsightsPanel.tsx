import { useQuery } from "@tanstack/react-query"
import {
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  Eye,
  FileDown,
  FileText,
  ListChecks,
  Loader2,
  MessageSquareWarning,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { OpenAPI, type ReviewTaskPublic } from "@/client"
import { formatReviewTaskDateTime } from "@/components/Tasks/task-display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

type WeeklyDailyPoint = {
  date: string
  success: number
  helpful: number
  not_helpful: number
  no_feedback: number
}

type WeeklyCategoryStats = {
  category: string
  subcategory: string
  useful_count: number
  high_risk_count: number
  medium_risk_count: number
  low_risk_count: number
}

type WeeklyDepartmentStats = {
  department_name: string
  success: number
  helpful: number
  not_helpful: number
  no_feedback: number
}

type WeeklyRepresentativeIssue = {
  task_id: string
  task_date: string
  department_name: string
  description: string
  category: string
  subcategory: string
  risk_level: string
}

type WeeklyInsights = {
  period_start: string
  period_end: string
  generated_at: string
  scope_label: string
  taxonomy_version: string
  success_tasks: number
  helpful: number
  not_helpful: number
  no_feedback: number
  feedback_coverage_rate: number
  explicit_useful_rate: number
  valid_useful_tasks: number
  cleaning_tasks: number
  valid_issue_count: number
  risk_counts: Record<string, number>
  attention_points: string[]
  daily: WeeklyDailyPoint[]
  categories: WeeklyCategoryStats[]
  departments: WeeklyDepartmentStats[]
  representative_issues: WeeklyRepresentativeIssue[]
}

const categoryOrder = [
  "日常提交审核",
  "品质风险审核",
  "重点项目发布审核",
  "协议专项审核",
  "驱动专项审核",
  "控制逻辑专项审核",
]

const categoryAccentClasses: Record<string, string> = {
  日常提交审核: "border-t-sky-500",
  品质风险审核: "border-t-rose-500",
  重点项目发布审核: "border-t-amber-500",
  协议专项审核: "border-t-cyan-500",
  驱动专项审核: "border-t-violet-500",
  控制逻辑专项审核: "border-t-emerald-500",
}

const riskLabels: Record<string, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险",
  recommendation: "建议/检查结果",
  unspecified: "未标注",
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function formatShortDate(value: string) {
  const [, month, day] = value.split("-")
  return `${month}-${day}`
}

function formatGeneratedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

async function readWeeklyInsights(): Promise<WeeklyInsights> {
  const token = localStorage.getItem("access_token")
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks/weekly-insights`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )
  if (!response.ok) {
    throw new Error("Failed to load weekly insights")
  }
  return response.json() as Promise<WeeklyInsights>
}

async function readReviewTask(taskId: string): Promise<ReviewTaskPublic> {
  const token = localStorage.getItem("access_token")
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks/${taskId}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )
  if (!response.ok) {
    throw new Error("Failed to load review task")
  }
  return response.json() as Promise<ReviewTaskPublic>
}

async function downloadReviewTaskReport(
  task: ReviewTaskPublic,
  format: "markdown" | "pdf",
) {
  const token = localStorage.getItem("access_token")
  const action = format === "pdf" ? "pdf/download" : "download"
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks/${task.id}/${action}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )
  if (!response.ok) {
    throw new Error("Failed to download review task report")
  }

  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement("a")
  link.href = objectUrl
  link.download =
    format === "pdf"
      ? task.pdf_report_name || `review-task-${task.id}.pdf`
      : task.report_name || `review-task-${task.id}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-sm text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  )
}

function WeeklyTaskDetailDialog({
  issue,
  open,
  onOpenChange,
}: {
  issue: WeeklyRepresentativeIssue | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [downloadingFormat, setDownloadingFormat] = useState<
    "markdown" | "pdf" | null
  >(null)
  const taskId = issue?.task_id
  const {
    data: task,
    isError,
    isLoading,
  } = useQuery({
    enabled: open && Boolean(taskId),
    queryFn: () => readReviewTask(taskId as string),
    queryKey: ["review-task-detail", taskId],
    staleTime: 5 * 60 * 1000,
  })

  const handleDownload = async (format: "markdown" | "pdf") => {
    if (!task) {
      return
    }
    setDownloadingFormat(format)
    try {
      await downloadReviewTaskReport(task, format)
    } catch {
      toast.error(`${format === "pdf" ? "PDF" : "Markdown"} 报告下载失败`)
    } finally {
      setDownloadingFormat(null)
    }
  }

  const revisionRange = task
    ? task.old_revision.trim().toLowerCase() === "r0"
      ? `全量审查 ${task.new_revision}`
      : `${task.old_revision} 到 ${task.new_revision}`
    : "-"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>任务详情</DialogTitle>
          <DialogDescription>
            查看该条高风险信息对应的代码审查任务。
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            正在加载任务详情
          </div>
        ) : null}

        {isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            任务详情加载失败，任务可能已删除或当前账号无权查看。
          </div>
        ) : null}

        {task ? (
          <div className="space-y-5">
            <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">提交人</p>
                <p className="mt-1 text-sm font-medium">
                  {task.user_name || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">SVN账号</p>
                <p className="mt-1 text-sm font-medium">
                  {task.svn_username || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">所属部门</p>
                <p className="mt-1 text-sm font-medium">
                  {task.department_name || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">提交时间</p>
                <p className="mt-1 text-sm font-medium">
                  {formatReviewTaskDateTime(task.created_at)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">审查版本</p>
                <p className="mt-1 text-sm font-medium">{revisionRange}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">任务编号</p>
                <p className="mt-1 break-all font-mono text-xs">{task.id}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">SVN地址</p>
                <p className="mt-1 break-all text-sm">{task.svn_url}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">完整有用信息</p>
              <div className="whitespace-pre-wrap rounded-md border bg-muted/20 p-4 text-sm leading-6">
                {task.report_feedback_useful_issues_text?.trim() ||
                  "该任务没有填写有用信息。"}
              </div>
            </div>

            <DialogFooter className="border-t pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={!task.report_path || downloadingFormat !== null}
                onClick={() => void handleDownload("markdown")}
              >
                {downloadingFormat === "markdown" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <FileText aria-hidden="true" />
                )}
                下载 Markdown
              </Button>
              <Button
                type="button"
                disabled={!task.pdf_report_path || downloadingFormat !== null}
                onClick={() => void handleDownload("pdf")}
              >
                {downloadingFormat === "pdf" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <FileDown aria-hidden="true" />
                )}
                下载 PDF
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function WeeklyInsightsPanel() {
  const { user: currentUser } = useAuth()
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false)
  const [selectedIssue, setSelectedIssue] =
    useState<WeeklyRepresentativeIssue | null>(null)
  const {
    data: stats,
    isError,
    isLoading,
  } = useQuery({
    enabled: Boolean(currentUser),
    queryFn: readWeeklyInsights,
    queryKey: [
      "review-task-weekly-insights",
      currentUser?.id,
      currentUser?.role,
      currentUser?.department_id,
    ],
    staleTime: 5 * 60 * 1000,
  })

  if (!currentUser || isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">周报统计</h2>
        <EmptyPanel message="正在生成上一周统计..." />
      </section>
    )
  }

  if (isError || !stats) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">周报统计</h2>
        <EmptyPanel message="周报统计加载失败，请稍后重试。" />
      </section>
    )
  }

  const summaryItems = [
    {
      label: "成功任务",
      value: stats.success_tasks,
      note: "上一完整自然周",
      icon: CheckCircle2,
      iconClassName: "text-blue-500",
    },
    {
      label: "有帮助",
      value: stats.helpful,
      note: `占成功任务 ${formatPercent(stats.success_tasks ? stats.helpful / stats.success_tasks : 0)}`,
      icon: ThumbsUp,
      iconClassName: "text-emerald-500",
    },
    {
      label: "没帮助",
      value: stats.not_helpful,
      note: `占成功任务 ${formatPercent(stats.success_tasks ? stats.not_helpful / stats.success_tasks : 0)}`,
      icon: ThumbsDown,
      iconClassName: "text-amber-500",
    },
    {
      label: "未反馈",
      value: stats.no_feedback,
      note: `反馈覆盖率 ${formatPercent(stats.feedback_coverage_rate)}`,
      icon: CircleHelp,
      iconClassName: "text-zinc-400",
    },
    {
      label: "明确有用率",
      value: formatPercent(stats.explicit_useful_rate),
      note: `已反馈 ${stats.helpful + stats.not_helpful} 个`,
      icon: ListChecks,
      iconClassName: "text-cyan-500",
    },
  ]
  const feedbackSegments = [
    { label: "有帮助", count: stats.helpful, className: "bg-emerald-500" },
    { label: "没帮助", count: stats.not_helpful, className: "bg-amber-500" },
    { label: "未反馈", count: stats.no_feedback, className: "bg-slate-500" },
  ]
  const helpfulEnd = stats.success_tasks
    ? (stats.helpful / stats.success_tasks) * 100
    : 0
  const notHelpfulEnd = stats.success_tasks
    ? ((stats.helpful + stats.not_helpful) / stats.success_tasks) * 100
    : 0
  const feedbackChartBackground = stats.success_tasks
    ? `conic-gradient(#10b981 0% ${helpfulEnd}%, #f59e0b ${helpfulEnd}% ${notHelpfulEnd}%, #64748b ${notHelpfulEnd}% 100%)`
    : undefined
  const dailyMax = Math.max(1, ...stats.daily.map((item) => item.success))
  const topCategories = [...stats.categories]
    .filter((item) => item.useful_count > 0)
    .sort(
      (left, right) =>
        right.useful_count - left.useful_count ||
        right.high_risk_count - left.high_risk_count,
    )
    .slice(0, 5)
  const maxCategoryCount = Math.max(
    1,
    ...stats.categories.map((item) => item.useful_count),
  )
  const groupedCategories = categoryOrder.map((category) => ({
    category,
    items: stats.categories.filter((item) => item.category === category),
  }))

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">周报统计</h2>
            <Badge variant="outline" className="gap-1.5 font-normal">
              <CalendarDays aria-hidden="true" />
              {formatShortDate(stats.period_start)} 至{" "}
              {formatShortDate(stats.period_end)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.scope_label} · 按固定审核分类规则每周自动更新
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          本次计算 {formatGeneratedAt(stats.generated_at)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {summaryItems.map((item) => (
          <Card key={item.label} className="gap-3 py-4">
            <CardContent className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                  {item.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.note}
                </p>
              </div>
              <item.icon
                aria-hidden="true"
                className={cn("mt-0.5 size-5 shrink-0", item.iconClassName)}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>成功任务反馈构成</CardTitle>
            <CardDescription>成功任务中三类反馈状态的占比。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <div
                role="img"
                aria-label={`上一周成功任务反馈饼图：有帮助 ${stats.helpful}，没帮助 ${stats.not_helpful}，未反馈 ${stats.no_feedback}`}
                className="relative size-36 shrink-0 rounded-full bg-muted sm:size-40"
                style={{ background: feedbackChartBackground }}
              >
                <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full border bg-card">
                  <span className="text-2xl font-semibold tabular-nums">
                    {stats.success_tasks}
                  </span>
                  <span className="mt-0.5 text-xs text-muted-foreground">
                    成功任务
                  </span>
                </div>
              </div>
              <div className="grid w-full min-w-0 flex-1 gap-3">
                {feedbackSegments.map((item) => (
                  <div
                    key={item.label}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 text-sm"
                  >
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-sm",
                        item.className,
                      )}
                    />
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium tabular-nums">
                      {item.count}
                    </span>
                    <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                      {formatPercent(
                        stats.success_tasks
                          ? item.count / stats.success_tasks
                          : 0,
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t pt-4 text-sm">
              <span className="text-muted-foreground">有效信息 </span>
              <span className="font-semibold tabular-nums">
                {stats.valid_issue_count} 条
              </span>
              <span className="ml-3 text-muted-foreground">需清洗 </span>
              <span className="font-semibold tabular-nums">
                {stats.cleaning_tasks} 个任务
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>每日成功任务与反馈</CardTitle>
            <CardDescription>
              柱高表示成功任务量，颜色表示反馈构成。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              role="img"
              aria-label="上一周每日成功任务与反馈柱状图"
              className="flex h-56 items-end gap-2 sm:gap-4"
            >
              {stats.daily.map((item) => {
                const totalHeight = item.success
                  ? Math.max(5, (item.success / dailyMax) * 100)
                  : 2
                return (
                  <div
                    key={item.date}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                    title={`${item.date}：成功 ${item.success}，有帮助 ${item.helpful}，没帮助 ${item.not_helpful}，未反馈 ${item.no_feedback}`}
                  >
                    <span className="text-xs font-medium tabular-nums">
                      {item.success}
                    </span>
                    <div className="flex h-36 w-full max-w-14 items-end rounded-sm bg-muted/60 px-1.5 pt-1.5">
                      <div
                        className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm"
                        style={{ height: `${totalHeight}%` }}
                      >
                        <div
                          className="bg-emerald-500"
                          style={{ flexGrow: item.helpful }}
                        />
                        <div
                          className="bg-amber-500"
                          style={{ flexGrow: item.not_helpful }}
                        />
                        <div
                          className="bg-slate-500"
                          style={{ flexGrow: item.no_feedback }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatShortDate(item.date)}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <MessageSquareWarning
              className="size-4 text-amber-500"
              aria-hidden="true"
            />
            本周关注点
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {stats.attention_points.map((point, index) => (
            <div
              key={point}
              className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 px-6 py-3 text-sm"
            >
              <span className="font-semibold text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p>{point}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>固定分类 TOP 5</CardTitle>
            <CardDescription>
              按有效信息数量排序，不生成临时主题。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>审核分类</TableHead>
                  <TableHead className="text-right">有效信息</TableHead>
                  <TableHead className="text-right">高风险</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topCategories.map((item) => (
                  <TableRow key={`${item.category}-${item.subcategory}`}>
                    <TableCell className="whitespace-normal">
                      <p className="font-medium">{item.subcategory}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.category}
                      </p>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {item.useful_count}
                    </TableCell>
                    <TableCell className="text-right font-medium text-rose-500 tabular-nums">
                      {item.high_risk_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>部门任务与反馈</CardTitle>
            <CardDescription>
              按成功任务量排序，展示前 8 个部门。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>部门</TableHead>
                  <TableHead className="text-right">成功</TableHead>
                  <TableHead className="text-right">有帮助</TableHead>
                  <TableHead className="text-right">没帮助</TableHead>
                  <TableHead className="text-right">未反馈</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.departments.slice(0, 8).map((item) => (
                  <TableRow key={item.department_name}>
                    <TableCell className="font-medium">
                      {item.department_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.success}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.helpful}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.not_helpful}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.no_feedback}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="font-semibold">审核分类覆盖</h3>
          <p className="text-sm text-muted-foreground">
            6 个大类、18 个小类固定展示，便于跨周对比。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groupedCategories.map((group) => {
            const groupTotal = group.items.reduce(
              (sum, item) => sum + item.useful_count,
              0,
            )
            const groupHigh = group.items.reduce(
              (sum, item) => sum + item.high_risk_count,
              0,
            )
            return (
              <Card
                key={group.category}
                className={cn(
                  "gap-3 border-t-2 py-4",
                  categoryAccentClasses[group.category],
                )}
              >
                <CardHeader className="gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm">{group.category}</CardTitle>
                    <span className="text-sm font-semibold tabular-nums">
                      {groupTotal}
                    </span>
                  </div>
                  <CardDescription>高风险 {groupHigh} 条</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.items.map((item) => (
                    <div key={item.subcategory} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="truncate" title={item.subcategory}>
                          {item.subcategory}
                        </span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {item.useful_count}
                          {item.high_risk_count > 0 ? (
                            <span className="ml-1 text-rose-500">
                              / 高 {item.high_risk_count}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${(item.useful_count / maxCategoryCount) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-rose-500" aria-hidden="true" />
            代表性高风险信息
          </CardTitle>
          <CardDescription>
            每个高频分类优先展示 1 条，最多 8 条。
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {stats.representative_issues.length > 0 ? (
            stats.representative_issues.map((issue) => (
              <div
                key={`${issue.task_id}-${issue.description}`}
                className="grid gap-2 px-6 py-4 lg:grid-cols-[7rem_8rem_10rem_minmax(0,1fr)_2rem] lg:items-start"
              >
                <span className="text-xs text-muted-foreground tabular-nums">
                  {issue.task_date}
                </span>
                <span className="text-xs font-medium">
                  {issue.department_name}
                </span>
                <div>
                  <Badge variant="destructive" className="mb-1">
                    {riskLabels[issue.risk_level] ?? issue.risk_level}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    {issue.subcategory}
                  </p>
                </div>
                <p className="text-sm leading-6">{issue.description}</p>
                <div className="flex justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="查看任务详情"
                        onClick={() => {
                          setSelectedIssue(issue)
                          setIsTaskDetailOpen(true)
                        }}
                      >
                        <Eye aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>查看任务详情</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))
          ) : (
            <p className="px-6 py-8 text-sm text-muted-foreground">
              上一周暂无高风险有用信息。
            </p>
          )}
        </CardContent>
      </Card>

      <WeeklyTaskDetailDialog
        issue={selectedIssue}
        open={isTaskDetailOpen}
        onOpenChange={(open) => {
          setIsTaskDetailOpen(open)
          if (!open) {
            setSelectedIssue(null)
          }
        }}
      />
    </section>
  )
}
