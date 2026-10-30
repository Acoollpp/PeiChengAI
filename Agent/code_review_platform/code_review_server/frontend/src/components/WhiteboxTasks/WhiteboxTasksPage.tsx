import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  BarChart3,
  Download,
  FileArchive,
  Plus,
  Trash2,
} from "lucide-react"
import { FormEvent, Suspense, useState } from "react"
import { toast } from "sonner"

import { OpenAPI } from "@/client"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

type WhiteboxTaskStatus =
  | "created"
  | "queued"
  | "claimed"
  | "preparing"
  | "running"
  | "uploading_report"
  | "success"
  | "failed"
  | "environment_error"
  | "timeout"
  | "cancelled"

type WhiteboxFile = {
  file_name: string
  file_path: string
  content_type?: string | null
  file_size: number
}

type WhiteboxTask = {
  id: string
  user_id: string
  user_name?: string | null
  svn_username?: string | null
  project_name: string
  source_url: string
  revision: string
  test_config?: string | null
  status: WhiteboxTaskStatus
  agent_id?: string | null
  input_files: WhiteboxFile[]
  result_files: WhiteboxFile[]
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  updated_at?: string | null
}

type WhiteboxTasksResponse = {
  data: WhiteboxTask[]
  count: number
}

type WhiteboxTaskStats = {
  total: number
  success: number
  running: number
  failed_or_error: number
  queued: number
  by_status: Record<WhiteboxTaskStatus, number>
}

type TaskScope = "mine" | "all"

const statusLabels: Record<WhiteboxTaskStatus, string> = {
  created: "已创建",
  queued: "等待执行",
  claimed: "已领取",
  preparing: "准备中",
  running: "执行中",
  uploading_report: "上传报告",
  success: "已完成",
  failed: "失败",
  environment_error: "环境异常",
  timeout: "超时",
  cancelled: "已取消",
}

const runningStatuses: WhiteboxTaskStatus[] = [
  "queued",
  "claimed",
  "preparing",
  "running",
  "uploading_report",
]

function authHeaders() {
  const token = localStorage.getItem("access_token")
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

function scopeQuery(scope: TaskScope) {
  return scope === "all" ? "&scope=all" : ""
}

async function readWhiteboxTasks(scope: TaskScope): Promise<WhiteboxTasksResponse> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/whitebox-tasks?limit=100${scopeQuery(scope)}`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    throw new Error("加载白盒测试任务失败")
  }
  return response.json()
}

async function readWhiteboxTaskStats(scope: TaskScope): Promise<WhiteboxTaskStats> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/whitebox-tasks/stats?scope=${scope}`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    throw new Error("加载白盒测试统计失败")
  }
  return response.json()
}

type CreateWhiteboxTaskInput = {
  sourceUrl: string
  revision: string
}

async function createWhiteboxTask(
  input: CreateWhiteboxTaskInput,
): Promise<WhiteboxTask> {
  const formData = new FormData()
  formData.append("source_url", input.sourceUrl)
  formData.append("revision", input.revision)

  const response = await fetch(`${OpenAPI.BASE}/api/v1/whitebox-tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.detail || "提交白盒测试任务失败")
  }
  return response.json()
}

async function deleteWhiteboxTask(taskId: string): Promise<{ message: string }> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/whitebox-tasks/${taskId}`, {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!response.ok) {
    throw new Error("删除白盒测试任务失败")
  }
  return response.json()
}

async function downloadWhiteboxReport(task: WhiteboxTask) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/whitebox-tasks/${task.id}/report`,
    { headers: authHeaders() },
  )
  if (!response.ok) {
    throw new Error("下载白盒测试报告失败")
  }
  const blob = await response.blob()
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = task.result_files[0]?.file_name || "whitebox-report"
  link.click()
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatWhiteboxTaskDuration(task: WhiteboxTask) {
  if (!task.started_at) return "-"
  const startTime = new Date(task.started_at).getTime()
  const endTime = task.finished_at ? new Date(task.finished_at).getTime() : Date.now()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return "-"
  }

  const totalSeconds = Math.floor((endTime - startTime) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}时${minutes}分${seconds}秒`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}

function WhiteboxStatusBadge({ status }: { status: WhiteboxTaskStatus }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        status === "success" && "border-green-200 bg-green-50 text-green-700",
        ["failed", "environment_error", "timeout"].includes(status) &&
          "border-red-200 bg-red-50 text-red-700",
        ["queued", "claimed", "preparing", "running", "uploading_report"].includes(status) &&
          "border-blue-200 bg-blue-50 text-blue-700",
        status === "cancelled" && "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {statusLabels[status]}
    </Badge>
  )
}

function WhiteboxStatsCards({ scope = "mine" }: { scope?: TaskScope }) {
  const { data: stats } = useSuspenseQuery({
    queryFn: () => readWhiteboxTaskStats(scope),
    queryKey: ["whitebox-task-stats", scope],
  })
  const cards = [
    { label: "任务总数", value: stats.total },
    { label: "等待执行", value: stats.queued },
    { label: "执行中", value: stats.running },
    { label: "已完成", value: stats.success },
    { label: "失败/异常", value: stats.failed_or_error },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label} className="rounded-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
            <BarChart3 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function WhiteboxStatsSection({ scope = "mine" }: { scope?: TaskScope }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground">加载统计中...</div>}>
      <WhiteboxStatsCards scope={scope} />
    </Suspense>
  )
}

function CreateWhiteboxTaskForm() {
  const queryClient = useQueryClient()
  const [sourceUrl, setSourceUrl] = useState("")
  const [revision, setRevision] = useState("")

  const mutation = useMutation({
    mutationFn: createWhiteboxTask,
    onSuccess: async () => {
      toast.success("白盒测试任务已提交")
      setSourceUrl("")
      setRevision("")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["whitebox-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["whitebox-task-stats"] }),
      ])
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "提交白盒测试任务失败")
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    mutation.mutate({
      sourceUrl,
      revision,
    })
  }

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-4" />
          新建白盒测试任务
        </CardTitle>
        <CardDescription>
          填写代码 SVN 路径和版本号，实际测试由白盒测试电脑上的 Agent 领取并执行。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 lg:grid-cols-[1fr_180px_180px]" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="whitebox-source-url">SVN路径</Label>
            <Input
              id="whitebox-source-url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="svn://repo/project"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="whitebox-revision">版本号</Label>
            <Input
              id="whitebox-revision"
              value={revision}
              onChange={(event) => setRevision(event.target.value)}
              placeholder="12345 或 r12345"
              required
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={mutation.isPending} className="w-full">
              {mutation.isPending ? "提交中..." : "提交白盒测试任务"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function WhiteboxTasksTable({ scope = "mine" }: { scope?: TaskScope }) {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery({
    queryFn: () => readWhiteboxTasks(scope),
    queryKey: ["whitebox-tasks", scope],
    refetchInterval: (query) =>
      query.state.data?.data.some((task) =>
        runningStatuses.includes(task.status),
      )
        ? 5000
        : false,
  })

  const invalidateTasks = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["whitebox-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["whitebox-task-stats"] }),
    ])
  }

  const deleteMutation = useMutation({
    mutationFn: deleteWhiteboxTask,
    onSuccess: async () => {
      toast.success("白盒测试任务已删除")
      await invalidateTasks()
    },
    onError: () => toast.error("删除白盒测试任务失败"),
  })

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="h-14 hover:bg-transparent">
          <TableHead className="w-[12%] px-3">创建时间</TableHead>
          <TableHead className="w-[12%] px-3">用户</TableHead>
          <TableHead className="w-[9%] px-3">状态</TableHead>
          <TableHead className="w-[9%] px-3">测试时长</TableHead>
          <TableHead className="w-[13%] px-3">项目</TableHead>
          <TableHead className="w-[22%] px-3">代码来源</TableHead>
          <TableHead className="w-[14%] px-3">附件/报告</TableHead>
          <TableHead className="w-[9%] px-3">结果</TableHead>
          <TableHead className="w-[6%] px-2 text-center">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.data.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
              暂无白盒测试任务
            </TableCell>
          </TableRow>
        ) : (
          data.data.map((task) => (
            <TableRow key={task.id} className="h-[116px]">
              <TableCell className="px-3 text-muted-foreground">
                {formatReviewTaskDateTime(task.created_at)}
              </TableCell>
              <TableCell className="px-3">
                <div className="truncate font-medium" title={task.user_name || "-"}>
                  {task.user_name || "-"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {task.svn_username || "-"}
                </div>
              </TableCell>
              <TableCell className="px-3">
                <WhiteboxStatusBadge status={task.status} />
              </TableCell>
              <TableCell className="px-3 text-sm text-muted-foreground">
                {formatWhiteboxTaskDuration(task)}
              </TableCell>
              <TableCell className="px-3">
                <div className="grid gap-1">
                  <span className="truncate font-medium" title={task.project_name}>
                    {task.project_name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {task.test_config || "-"}
                  </span>
                </div>
              </TableCell>
              <TableCell className="px-3">
                <div className="grid gap-1">
                  <span className="truncate" title={task.source_url}>
                    {task.source_url}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    版本：{task.revision}
                  </span>
                </div>
              </TableCell>
              <TableCell className="px-3">
                <div className="grid gap-1 text-xs text-muted-foreground">
                  {[...task.input_files, ...task.result_files].slice(0, 3).map((file) => (
                    <div key={file.file_path} className="flex min-w-0 items-center gap-2">
                      <FileArchive className="size-3 shrink-0" />
                      <span className="truncate" title={file.file_name}>
                        {file.file_name}
                      </span>
                      <span className="shrink-0">{formatFileSize(file.file_size)}</span>
                    </div>
                  ))}
                </div>
              </TableCell>
              <TableCell className="px-3">
                {task.result_files.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="下载白盒测试报告"
                    onClick={() => void downloadWhiteboxReport(task)}
                  >
                    <Download />
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {task.error_message || "-"}
                  </span>
                )}
              </TableCell>
              <TableCell className="px-2 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="删除白盒测试任务"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(task.id)}
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function WhiteboxTasksSection({ scope = "mine" }: { scope?: TaskScope }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground">加载中...</div>}>
      <WhiteboxTasksTable scope={scope} />
    </Suspense>
  )
}

export function WhiteboxTasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">白盒测试平台</h1>
        <p className="text-muted-foreground">
          提交白盒测试任务，由白盒测试电脑 Agent 执行并回传报告。
        </p>
      </div>

      <CreateWhiteboxTaskForm />
      <WhiteboxStatsSection />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>
            白盒测试任务与 GPIO 任务独立管理，账号和权限沿用当前平台。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[404px] overflow-y-auto rounded-md border [scrollbar-gutter:stable]">
            <WhiteboxTasksSection />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function WhiteboxTaskManagementPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          白盒测试任务管理
        </h1>
        <p className="text-muted-foreground">
          查看白盒测试任务的提交记录、执行状态、测试报告和异常信息。
        </p>
      </div>

      <WhiteboxStatsSection scope="all" />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>任务记录</CardTitle>
          <CardDescription>
            管理员可查看所有人的白盒测试任务记录和输出，普通用户只显示自己的任务。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[640px] overflow-y-auto rounded-md border [scrollbar-gutter:stable]">
            <WhiteboxTasksSection scope="all" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
