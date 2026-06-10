import type { ColumnDef } from "@tanstack/react-table"
import { Eye, ImageIcon } from "lucide-react"

import type { FeedbackPublic, FeedbackStatus } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type FeedbackTableData = FeedbackPublic

export const feedbackStatusOptions: Array<{
  value: FeedbackStatus
  label: string
}> = [
  { value: "pending", label: "待处理" },
  { value: "processing", label: "处理中" },
  { value: "resolved", label: "已解决" },
]

export function feedbackStatusLabel(status: FeedbackStatus) {
  return (
    feedbackStatusOptions.find((option) => option.value === status)?.label ??
    status
  )
}

export function feedbackStatusVariant(status: FeedbackStatus) {
  if (status === "resolved") {
    return "outline" as const
  }

  if (status === "processing") {
    return "secondary" as const
  }

  return "default" as const
}

export function FeedbackStatusBadge({ status }: { status: FeedbackStatus }) {
  return (
    <Badge
      variant={feedbackStatusVariant(status)}
      className={cn(
        status === "processing" && "border-blue-200 bg-blue-50 text-blue-700",
        status === "resolved" && "border-green-200 bg-green-50 text-green-700",
      )}
    >
      {feedbackStatusLabel(status)}
    </Badge>
  )
}

export function formatFeedbackDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-"
}

export function formatFeedbackFileSize(size?: number | null) {
  if (!size) {
    return "-"
  }

  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function summarizeDescription(description: string) {
  const normalized = description.replace(/\s+/g, " ").trim()
  if (normalized.length <= 80) {
    return normalized
  }

  return `${normalized.slice(0, 80)}...`
}

export function createFeedbackColumns({
  isAdmin,
  updatingFeedbackId,
  onOpenDetail,
  onStatusChange,
}: {
  isAdmin: boolean
  updatingFeedbackId?: string | null
  onOpenDetail: (feedback: FeedbackPublic) => void
  onStatusChange: (feedback: FeedbackPublic, status: FeedbackStatus) => void
}): ColumnDef<FeedbackTableData>[] {
  return [
    {
      accessorKey: "user_name",
      header: "提交人",
      cell: ({ row }) => (
        <div className="min-w-32">
          <div className="font-medium">{row.original.user_name || "-"}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.svn_username || "-"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "created_at",
      header: "提交时间",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatFeedbackDateTime(row.original.created_at)}
        </span>
      ),
    },
    {
      accessorKey: "description",
      header: "问题描述摘要",
      cell: ({ row }) => (
        <span
          className="block max-w-md truncate"
          title={row.original.description}
        >
          {summarizeDescription(row.original.description)}
        </span>
      ),
    },
    {
      accessorKey: "has_screenshot",
      header: "截图",
      cell: ({ row }) => {
        const screenshotCount =
          row.original.screenshot_count ?? row.original.screenshots?.length ?? 0

        return screenshotCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenDetail(row.original)}
          >
            <ImageIcon />
            {screenshotCount} 张
          </Button>
        ) : (
          <span className="text-muted-foreground">-</span>
        )
      },
    },
    {
      accessorKey: "status",
      header: "解决状态",
      cell: ({ row }) =>
        isAdmin ? (
          <Select
            value={row.original.status}
            disabled={updatingFeedbackId === row.original.id}
            onValueChange={(value) =>
              onStatusChange(row.original, value as FeedbackStatus)
            }
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {feedbackStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <FeedbackStatusBadge status={row.original.status} />
        ),
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpenDetail(row.original)}
        >
          <Eye />
          详情
        </Button>
      ),
    },
  ]
}
