import { useQuery } from "@tanstack/react-query"
import {
  CheckCircle2,
  CircleHelp,
  Clock3,
  MessageSquareText,
} from "lucide-react"
import { useState } from "react"

import { FeedbackService, type FeedbackStatsRange } from "@/client"
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

type FeedbackStatus = "pending" | "processing" | "resolved"

const rangeOptions: Array<{ label: string; value: FeedbackStatsRange }> = [
  { label: "今日", value: "today" },
  { label: "昨日", value: "yesterday" },
  { label: "累计", value: "all" },
]

const statusLabels: Array<{ key: FeedbackStatus; label: string }> = [
  { key: "pending", label: "待处理" },
  { key: "processing", label: "处理中" },
  { key: "resolved", label: "已解决" },
]

const emptyStatusCounts: Record<FeedbackStatus, number> = {
  pending: 0,
  processing: 0,
  resolved: 0,
}

const userBarClasses = [
  "bg-blue-500",
  "bg-cyan-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-lime-500",
]

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

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

export function FeedbackStatsPanel() {
  const { user: currentUser } = useAuth()
  const [selectedRange, setSelectedRange] =
    useState<FeedbackStatsRange>("today")
  const {
    data: stats,
    isError,
    isLoading,
  } = useQuery({
    enabled: Boolean(currentUser),
    queryFn: () => FeedbackService.readFeedbackStats({ range: selectedRange }),
    queryKey: [
      "feedback-stats",
      currentUser?.id,
      currentUser?.role,
      selectedRange,
    ],
  })

  if (!currentUser || isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">意见统计</h2>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            正在加载意见统计...
          </CardContent>
        </Card>
      </section>
    )
  }

  if (isError || !stats) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">意见统计</h2>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            意见统计加载失败，请稍后重试。
          </CardContent>
        </Card>
      </section>
    )
  }

  const byStatus = {
    ...emptyStatusCounts,
    ...stats.by_status,
  }
  const summaryItems = [
    {
      icon: MessageSquareText,
      label: "总意见数",
      value: stats.total,
    },
    {
      icon: CircleHelp,
      label: "待处理",
      value: stats.pending,
      iconClassName: "text-amber-600",
    },
    {
      icon: Clock3,
      label: "处理中",
      value: stats.processing,
      iconClassName: "text-blue-600",
    },
    {
      icon: CheckCircle2,
      label: "已解决",
      value: stats.resolved,
      iconClassName: "text-emerald-600",
    },
  ]
  const maxStatusCount = Math.max(
    1,
    ...statusLabels.map(({ key }) => byStatus[key] ?? 0),
  )
  const trend = stats.trend ?? []
  const maxTrendCount = Math.max(1, ...trend.map((item) => item.count))
  const canViewUserRanking = hasAdminPrivileges(currentUser)
  const feedbackByUser = (stats.feedback_by_user ?? []).filter(
    (item) => item.feedback_count > 0,
  )
  const maxFeedbackCount = Math.max(
    1,
    ...feedbackByUser.map((item) => item.feedback_count),
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">意见统计</h2>
          <p className="text-sm text-muted-foreground">
            当前权限范围内的意见反馈处理情况。
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>状态分布</CardTitle>
            <CardDescription>按意见当前处理状态统计。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusLabels.map(({ key, label }) => {
              const count = byStatus[key] ?? 0
              const width = `${(count / maxStatusCount) * 100}%`

              return (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(4rem,max-content)_minmax(0,1fr)_3rem] items-center gap-3 text-sm"
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

        <Card>
          <CardHeader>
            <CardTitle>提交趋势</CardTitle>
            <CardDescription>按当前范围展示意见提交数量。</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length > 0 ? (
              <div className="overflow-x-auto pb-2">
                <div className="flex h-64 min-w-max items-end gap-4">
                  {trend.map((item, index) => (
                    <div
                      key={`${item.label}-${index}`}
                      className="flex h-full w-20 shrink-0 flex-col items-center justify-end gap-2 text-sm"
                    >
                      <span className="font-medium tabular-nums">
                        {item.count}
                      </span>
                      <div className="flex h-44 w-full items-end justify-center rounded-md bg-muted/60 px-3 py-2">
                        <div
                          className="w-full rounded-t-md bg-primary transition-all"
                          style={{
                            height: `${(item.count / maxTrendCount) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-full truncate text-center text-muted-foreground">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无提交记录。</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>处理概览</CardTitle>
          <CardDescription>未解决数量、解决率与平均处理时长。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">未解决</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {stats.unresolved}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">解决率</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatPercent(stats.resolution_rate)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">平均处理时长</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatDuration(stats.average_resolution_seconds)}
            </p>
          </div>
        </CardContent>
      </Card>

      {canViewUserRanking ? (
        <Card>
          <CardHeader>
            <CardTitle>提交人排行</CardTitle>
            <CardDescription>按用户统计提交的意见数。</CardDescription>
          </CardHeader>
          <CardContent>
            {feedbackByUser.length > 0 ? (
              <div className="overflow-x-auto pb-2">
                <div className="flex h-72 min-w-max items-end gap-4">
                  {feedbackByUser.map((item, index) => {
                    const displayName =
                      item.user_name || item.svn_username || "未命名用户"
                    const height = `${(item.feedback_count / maxFeedbackCount) * 100}%`
                    const colorClass =
                      userBarClasses[index % userBarClasses.length]

                    return (
                      <div
                        key={`${item.user_name ?? ""}-${item.svn_username ?? ""}-${index}`}
                        className="flex h-full w-20 shrink-0 flex-col items-center justify-end gap-2 text-sm"
                      >
                        <span className="font-medium tabular-nums">
                          {item.feedback_count}
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
              <p className="text-sm text-muted-foreground">暂无提交人数据。</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
