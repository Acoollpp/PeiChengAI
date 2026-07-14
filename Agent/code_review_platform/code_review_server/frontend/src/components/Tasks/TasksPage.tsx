import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  Download,
  ExternalLink,
  FileDown,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { type FormEvent, Suspense, useState } from "react"
import { toast } from "sonner"

import { OpenAPI, type ReviewTaskPublic, type ReviewTaskStatus } from "@/client"
import {
  type DisplayableReviewTaskStatus,
  formatReviewTaskDateTime,
  ReviewTaskStatusBadge,
  reviewTaskStatusLabel,
} from "@/components/Tasks/task-display"
import { formatReviewTaskErrorMessage } from "@/components/Tasks/task-error-display"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useAuth from "@/hooks/useAuth"
import { hasAdminPrivileges } from "@/lib/authz"

type ReviewTask = Omit<ReviewTaskPublic, "status"> & {
  status: DisplayableReviewTaskStatus
}

type ReviewTasksResponse = {
  data: ReviewTask[]
  count: number
}

type ReviewTaskFilters = {
  userName: string
  svnUsername: string
  status: ReviewTaskStatus | "all"
  reportFeedback: "all" | "helpful" | "not_helpful" | "none"
  startedFrom: string
}

const REVIEW_TASK_TABLE_COLUMN_COUNT = 12

const emptyFilters: ReviewTaskFilters = {
  userName: "",
  svnUsername: "",
  status: "all",
  reportFeedback: "all",
  startedFrom: "",
}

const reviewTaskStatusOptions: ReviewTaskStatus[] = [
  "created",
  "checking_environment",
  "running_codex",
  "uploading_report",
  "success",
  "failed",
  "environment_error",
  "cancelled",
]

const reportFeedbackOptions = [
  { value: "helpful", label: "有帮助" },
  { value: "not_helpful", label: "没帮助" },
  { value: "none", label: "未反馈" },
] as const

function ReportFeedbackHelpfulBadge({ helpful }: { helpful?: boolean | null }) {
  if (helpful === true) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        有帮助
      </span>
    )
  }

  if (helpful === false) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        没帮助
      </span>
    )
  }

  return (
    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      未反馈
    </span>
  )
}

function formatUsefulIssuesSummary(value?: string | null) {
  if (!value?.trim()) {
    return "-"
  }
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("；")
}

async function readReviewTasks(
  filters: ReviewTaskFilters,
  canFilterUsers: boolean,
): Promise<ReviewTasksResponse> {
  const token = localStorage.getItem("access_token")
  const searchParams = new URLSearchParams({ limit: "100" })
  const userName = filters.userName.trim()
  const svnUsername = filters.svnUsername.trim()

  if (canFilterUsers && userName) {
    searchParams.set("user_name", userName)
  }

  if (canFilterUsers && svnUsername) {
    searchParams.set("svn_username", svnUsername)
  }

  if (filters.status !== "all") {
    searchParams.set("status", filters.status)
  }

  if (filters.reportFeedback !== "all") {
    searchParams.set("report_feedback", filters.reportFeedback)
  }

  if (filters.startedFrom) {
    searchParams.set("started_from", filters.startedFrom)
  }

  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks?${searchParams}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )

  if (!response.ok) {
    throw new Error("Failed to load review tasks")
  }

  return response.json()
}

function getReviewTasksQueryOptions(
  filters: ReviewTaskFilters,
  canFilterUsers: boolean,
) {
  return {
    queryFn: () => readReviewTasks(filters, canFilterUsers),
    queryKey: ["review-tasks", canFilterUsers ? "admin" : "me", filters],
  }
}

function reportUrl(
  task: ReviewTask,
  action: "report" | "download" | "pdf/download",
) {
  return `${OpenAPI.BASE}/api/v1/review-tasks/${task.id}/${action}`
}

async function fetchReport(
  task: ReviewTask,
  action: "report" | "download" | "pdf/download",
) {
  const token = localStorage.getItem("access_token")
  const response = await fetch(reportUrl(task, action), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })

  if (!response.ok) {
    throw new Error("Failed to load report")
  }

  return response.blob()
}

async function openReport(task: ReviewTask) {
  const blob = await fetchReport(task, "report")
  window.open(URL.createObjectURL(blob), "_blank", "noreferrer")
}

async function downloadReport(task: ReviewTask) {
  const blob = await fetchReport(task, "download")
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `review-task-${task.id}.md`
  link.click()
}

async function downloadPdfReport(task: ReviewTask) {
  const blob = await fetchReport(task, "pdf/download")
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `review-task-${task.id}.pdf`
  link.click()
}

async function deleteReviewTask(task: ReviewTask) {
  const token = localStorage.getItem("access_token")
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks/${task.id}`,
    {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )

  if (!response.ok) {
    throw new Error("Failed to delete review task")
  }

  return response.json()
}

function formatReviewTaskRevisionRange(task: ReviewTask) {
  if (task.old_revision.trim().toLowerCase() === "r0") {
    return `全量审查 ${task.new_revision}`
  }

  return `${task.old_revision} → ${task.new_revision}`
}

function ReviewTasksTable({
  filters,
  canFilterUsers,
}: {
  filters: ReviewTaskFilters
  canFilterUsers: boolean
}) {
  const queryClient = useQueryClient()
  const [taskToDelete, setTaskToDelete] = useState<ReviewTask | null>(null)
  const { data: tasks } = useSuspenseQuery(
    getReviewTasksQueryOptions(filters, canFilterUsers),
  )
  const deleteMutation = useMutation({
    mutationFn: deleteReviewTask,
    onSuccess: async () => {
      toast.success("代码审查任务已删除")
      setTaskToDelete(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["review-task-stats"] }),
      ])
    },
    onError: () => {
      toast.error("删除代码审查任务失败")
    },
  })

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>用户名称</TableHead>
            <TableHead>SVN账号</TableHead>
            <TableHead>SVN地址</TableHead>
            <TableHead>版本</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>开始时间</TableHead>
            <TableHead>结束时间</TableHead>
            <TableHead>错误信息</TableHead>
            <TableHead>是否有帮助</TableHead>
            <TableHead>有用信息</TableHead>
            <TableHead>报告</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.data.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={REVIEW_TASK_TABLE_COLUMN_COUNT}
                className="h-32 text-center text-muted-foreground"
              >
                暂无审查任务
              </TableCell>
            </TableRow>
          ) : (
            tasks.data.map((task) => {
              const errorMessage = formatReviewTaskErrorMessage(
                task.error_message,
              )

              return (
                <TableRow key={task.id}>
                  <TableCell>{task.user_name || "-"}</TableCell>
                  <TableCell>{task.svn_username || "-"}</TableCell>
                  <TableCell className="max-w-sm truncate font-medium">
                    {task.svn_url}
                  </TableCell>
                  <TableCell>{formatReviewTaskRevisionRange(task)}</TableCell>
                  <TableCell>
                    <ReviewTaskStatusBadge status={task.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatReviewTaskDateTime(task.started_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatReviewTaskDateTime(task.finished_at)}
                  </TableCell>
                  <TableCell
                    className="max-w-xs truncate text-muted-foreground"
                    title={errorMessage === "-" ? undefined : errorMessage}
                  >
                    {errorMessage}
                  </TableCell>
                  <TableCell>
                    <ReportFeedbackHelpfulBadge
                      helpful={task.report_feedback_helpful}
                    />
                  </TableCell>
                  <TableCell
                    className="max-w-xs truncate text-muted-foreground"
                    title={task.report_feedback_useful_issues_text || undefined}
                  >
                    {task.report_feedback_helpful
                      ? formatUsefulIssuesSummary(
                          task.report_feedback_useful_issues_text,
                        )
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {task.report_path ? (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="打开报告"
                          onClick={() => void openReport(task)}
                        >
                          <ExternalLink />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="下载报告"
                          onClick={() => void downloadReport(task)}
                        >
                          <Download />
                        </Button>
                        {task.pdf_report_path ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="下载 PDF 报告"
                            onClick={() => void downloadPdfReport(task)}
                          >
                            <FileDown />
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="删除任务"
                      onClick={() => setTaskToDelete(task)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
      <Dialog
        open={taskToDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setTaskToDelete(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除代码审查任务</DialogTitle>
            <DialogDescription>
              此操作会同时删除任务记录和已上传报告文件，且不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending || taskToDelete === null}
              onClick={() => {
                if (taskToDelete) {
                  deleteMutation.mutate(taskToDelete)
                }
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ReviewTasksSection({
  filters,
  canFilterUsers,
}: {
  filters: ReviewTaskFilters
  canFilterUsers: boolean
}) {
  return (
    <Suspense fallback={<div className="text-muted-foreground">加载中...</div>}>
      <ReviewTasksTable filters={filters} canFilterUsers={canFilterUsers} />
    </Suspense>
  )
}

export function TasksPage() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [draftFilters, setDraftFilters] =
    useState<ReviewTaskFilters>(emptyFilters)
  const [filters, setFilters] = useState<ReviewTaskFilters>(emptyFilters)

  if (!currentUser) {
    return <div className="text-muted-foreground">加载中...</div>
  }

  const canFilterUsers = hasAdminPrivileges(currentUser)

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFilters({ ...draftFilters })
  }

  const handleReset = () => {
    setDraftFilters({ ...emptyFilters })
    setFilters({ ...emptyFilters })
    void queryClient.invalidateQueries({ queryKey: ["review-tasks"] })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">代码审查任务管理</h1>
        <p className="text-muted-foreground">
          {canFilterUsers
            ? "查看代码审查任务状态和报告。"
            : "查看自己提交的代码审查任务状态和报告。"}
        </p>
      </div>
      <form
        className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end"
        onSubmit={handleSearch}
      >
        {canFilterUsers ? (
          <>
            <Input
              className="md:max-w-56"
              placeholder="用户姓名"
              value={draftFilters.userName}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  userName: event.target.value,
                }))
              }
            />
            <Input
              className="md:max-w-56"
              placeholder="SVN账号"
              value={draftFilters.svnUsername}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  svnUsername: event.target.value,
                }))
              }
            />
          </>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-task-status-filter">状态</Label>
          <Select
            value={draftFilters.status}
            onValueChange={(value) =>
              setDraftFilters((current) => ({
                ...current,
                status: value as ReviewTaskFilters["status"],
              }))
            }
          >
            <SelectTrigger
              id="review-task-status-filter"
              className="w-full md:w-36"
              aria-label="状态"
            >
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {reviewTaskStatusOptions.map((status) => (
                <SelectItem key={status} value={status}>
                  {reviewTaskStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-task-feedback-filter">是否有帮助</Label>
          <Select
            value={draftFilters.reportFeedback}
            onValueChange={(value) =>
              setDraftFilters((current) => ({
                ...current,
                reportFeedback: value as ReviewTaskFilters["reportFeedback"],
              }))
            }
          >
            <SelectTrigger
              id="review-task-feedback-filter"
              className="w-full md:w-36"
              aria-label="是否有帮助"
            >
              <SelectValue placeholder="全部反馈" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部反馈</SelectItem>
              {reportFeedbackOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-task-started-from-filter">开始时间</Label>
          <Input
            id="review-task-started-from-filter"
            className="md:w-40"
            type="date"
            value={draftFilters.startedFrom}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                startedFrom: event.target.value,
              }))
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit">
            <Search />
            搜索
          </Button>
          <Button type="button" variant="outline" onClick={handleReset}>
            <X />
            重置
          </Button>
        </div>
      </form>
      <ReviewTasksSection filters={filters} canFilterUsers={canFilterUsers} />
    </div>
  )
}
