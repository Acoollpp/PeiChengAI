import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
} from "lucide-react"

import { OpenAPI } from "@/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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

type ReviewTaskStats = {
  total: number
  success: number
  running: number
  failed_or_error: number
  by_status: Record<ReviewTaskStatus, number>
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

async function readReviewTaskStats(): Promise<ReviewTaskStats> {
  const token = localStorage.getItem("access_token")
  const response = await fetch(`${OpenAPI.BASE}/api/v1/review-tasks/stats`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })

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
  }
}

export function TaskStatsPanel() {
  const {
    data: stats,
    isError,
    isLoading,
  } = useQuery({
    queryFn: readReviewTaskStats,
    queryKey: ["review-task-stats"],
  })

  if (isLoading) {
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
      icon: Activity,
      label: "运行中数",
      value: stats.running,
      iconClassName: "text-blue-600",
    },
  ]
  const maxStatusCount = Math.max(
    1,
    ...statusLabels.map(({ key }) => stats.by_status[key] ?? 0),
  )

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">任务统计</h2>
        <p className="text-sm text-muted-foreground">
          当前权限范围内的代码审查任务数量。
        </p>
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
                className="grid grid-cols-[6rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm"
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
