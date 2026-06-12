import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock3,
} from "lucide-react"
import { useState } from "react"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import useAuth from "@/hooks/useAuth"
import { hasAdminPrivileges } from "@/lib/authz"
import { cn } from "@/lib/utils"

type ReviewTaskStatus =
  | "created"
  | "checking_environment"
  | "running_codex"
  | "uploading_report"
  | "success"
  | "failed"
  | "environment_error"
  | "cancelled"

type TaskStatsRange = "today" | "yesterday" | "all"

type ReviewTaskStats = {
  range: TaskStatsRange
  total: number
  success: number
  running: number
  failed_or_error: number
  average_duration_seconds: number | null
  by_status: Record<ReviewTaskStatus, number>
  reports_by_user: Array<{
    user_name: string | null
    svn_username: string | null
    report_count: number
  }>
}

const statusLabels: Array<{ key: ReviewTaskStatus; label: string }> = [
  { key: "created", label: "待处理" },
  { key: "checking_environment", label: "环境检查中" },
  { key: "running_codex", label: "运行中" },
  { key: "uploading_report", label: "上传报告中" },
  { key: "success", label: "成功" },
  { key: "failed", label: "失败" },
  { key: "environment_error", label: "环境异常" },
  { key: "cancelled", label: "已取消" },
]

const rangeOptions: Array<{ label: string; value: TaskStatsRange }> = [
  { label: "今日", value: "today" },
  { label: "昨日", value: "yesterday" },
  { label: "累计", value: "all" },
]

const emptyStatusCounts: Record<ReviewTaskStatus, number> = {
  created: 0,
  checking_environment: 0,
  running_codex: 0,
  uploading_report: 0,
  success: 0,
  failed: 0,
  environment_error: 0,
  cancelled: 0,
}

const reportBarClasses = [
  "bg-blue-500",
  "bg-cyan-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-lime-500",
  "bg-sky-500",
  "bg-fuchsia-500",
]

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) {
    return "-"
  }

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}分钟`
  }

  if (seconds < 86400) {
    return `${Math.round(seconds / 3600)}小时`
  }

  return `${Math.round(seconds / 86400)}天`
}

async function readReviewTaskStats(
  range: TaskStatsRange,
): Promise<ReviewTaskStats> {
  const token = localStorage.getItem("access_token")
  const searchParams = new URLSearchParams({ range })
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks/stats?${searchParams}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )

  if (!response.ok) {
    throw new Error("Failed to load review task stats")
  }

  const stats = (await response.json()) as ReviewTaskStats

  return {
    ...stats,
    by_status: {
      ...emptyStatusCounts,
      ...stats.by_status,
    },
    reports_by_user: stats.reports_by_user ?? [],
  }
}

export function TaskStatsPanel() {
  const { user: currentUser } = useAuth()
  const [selectedRange, setSelectedRange] = useState<TaskStatsRange>("all")
  const {
    data: stats,
    isError,
    isLoading,
  } = useQuery({
    enabled: Boolean(currentUser),
    queryFn: () => readReviewTaskStats(selectedRange),
    queryKey: [
      "review-task-stats",
      currentUser?.id,
      currentUser?.role,
      selectedRange,
    ],
  })

  if (!currentUser || isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">任务统计</h2>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            正在加载任务统计...
          </CardContent>
        </Card>
      </section>
    )
  }

  if (isError || !stats) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">任务统计</h2>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            任务统计加载失败，请稍后重试。
          </CardContent>
        </Card>
      </section>
    )
  }

  const summaryItems = [
    {
      icon: ClipboardList,
      label: "总任务数",
      value: stats.total,
    },
    {
      icon: CheckCircle2,
      label: "成功数",
      value: stats.success,
      iconClassName: "text-emerald-600",
    },
    {
      icon: AlertTriangle,
      label: "失败/异常数",
      value: stats.failed_or_error,
      iconClassName: "text-destructive",
    },
    {
      icon: Clock3,
      label: "平均运行时间",
      value: formatDuration(stats.average_duration_seconds),
      iconClassName: "text-blue-600",
    },
  ]
  const maxStatusCount = Math.max(
    1,
    ...statusLabels.map(({ key }) => stats.by_status[key] ?? 0),
  )
  const canViewUserReportStats = hasAdminPrivileges(currentUser)
  const reportsByUser = stats.reports_by_user.filter(
    (item) => item.report_count > 0,
  )
  const maxReportCount = Math.max(
    1,
    ...reportsByUser.map((item) => item.report_count),
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">任务统计</h2>
          <p className="text-sm text-muted-foreground">
            当前权限范围内的代码审查任务数量。
          </p>
        </div>
        <div className="flex w-fit rounded-lg bg-muted p-1">
          {rangeOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={selectedRange === option.value ? "secondary" : "ghost"}
              className="h-8 px-3"
              onClick={() => setSelectedRange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryItems.map((item) => (
          <Card key={item.label} className="gap-3 py-5">
            <CardContent className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {item.value}
                </p>
              </div>
              <item.icon
                className={cn(
                  "size-5 shrink-0 text-muted-foreground",
                  item.iconClassName,
                )}
                aria-hidden="true"
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {canViewUserReportStats ? (
        <Card>
          <CardHeader>
            <CardTitle>报告生成数</CardTitle>
            <CardDescription>按用户统计已生成报告的任务数。</CardDescription>
          </CardHeader>
          <CardContent>
            {reportsByUser.length > 0 ? (
              <div className="overflow-x-auto pb-2">
                <div className="flex h-72 min-w-max items-end gap-4">
                  {reportsByUser.map((item, index) => {
                    const displayName =
                      item.user_name || item.svn_username || "未命名用户"
                    const height = `${(item.report_count / maxReportCount) * 100}%`
                    const colorClass =
                      reportBarClasses[index % reportBarClasses.length]

                    return (
                      <div
                        key={`${item.user_name ?? ""}-${item.svn_username ?? ""}-${index}`}
                        className="flex h-full w-20 shrink-0 flex-col items-center justify-end gap-2 text-sm"
                      >
                        <span className="font-medium tabular-nums">
                          {item.report_count}
                        </span>
                        <div className="flex h-48 w-full items-end justify-center rounded-md bg-muted/60 px-3 py-2">
                          <div
                            className={cn(
                              "w-full rounded-t-md transition-all",
                              colorClass,
                            )}
                            style={{ height }}
                          />
                        </div>
                        <span
                          className="w-full truncate text-center text-muted-foreground"
                          title={
                            item.svn_username
                              ? `${displayName} (${item.svn_username})`
                              : displayName
                          }
                        >
                          {displayName}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                暂无已生成的报告。
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>状态分布</CardTitle>
          <CardDescription>按任务当前状态统计。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusLabels.map(({ key, label }) => {
            const count = stats.by_status[key] ?? 0
            const width = `${(count / maxStatusCount) * 100}%`

            return (
              <div
                key={key}
                className="grid grid-cols-[minmax(6rem,max-content)_minmax(0,1fr)_3rem] items-center gap-3 text-sm"
              >
                <span className="text-muted-foreground">{label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width }}
                  />
                </div>
                <span className="text-right font-medium tabular-nums">
                  {count}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </section>
  )
}
