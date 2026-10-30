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
import { FormEvent, Suspense, useEffect, useState } from "react"
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

type BomSpecCompareTaskStatus =
  | "created"
  | "queued"
  | "preparing"
  | "running"
  | "uploading_report"
  | "success"
  | "failed"
  | "timeout"
  | "cancelled"

type BomSpecCompareFile = {
  file_name: string
  file_path: string
  content_type?: string | null
  file_size: number
}

type BomSpecCompareTask = {
  id: string
  user_id: string
  user_name?: string | null
  svn_username?: string | null
  task_name: string
  status: BomSpecCompareTaskStatus
  input_files: BomSpecCompareFile[]
  result_files: BomSpecCompareFile[]
  project_count: number
  success_count: number
  consistent_count: number
  different_count: number
  failed_count: number
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  updated_at?: string | null
}

type BomSpecCompareTasksResponse = {
  data: BomSpecCompareTask[]
  count: number
}

type BomSpecCompareTaskStats = {
  total: number
  success: number
  running: number
  failed_or_error: number
  project_count: number
  consistent_count: number
  different_count: number
  failed_count: number
  task_total_count?: number
  task_success_count?: number
  task_running_count?: number
  task_failed_count?: number
  project_total_count?: number
  project_consistent_count?: number
  project_different_count?: number
  project_failed_count?: number
  by_status: Record<BomSpecCompareTaskStatus, number>
}

type TaskScope = "mine" | "all"

const statusLabels: Record<BomSpecCompareTaskStatus, string> = {
  created: "已创建",
  queued: "等待执行",
  preparing: "准备中",
  running: "执行中",
  uploading_report: "生成报告",
  success: "已完成",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
}

const runningStatuses: BomSpecCompareTaskStatus[] = [
  "queued",
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

async function readBomSpecCompareTasks(
  scope: TaskScope,
): Promise<BomSpecCompareTasksResponse> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-spec-compare-tasks?limit=100${scopeQuery(scope)}`,
    { headers: authHeaders() },
  )
  if (!response.ok) {
    throw new Error("加载 BOM配送检查任务失败")
  }
  return response.json()
}

async function readBomSpecCompareStats(
  scope: TaskScope,
): Promise<BomSpecCompareTaskStats> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-spec-compare-tasks/stats?scope=${scope}`,
    { headers: authHeaders() },
  )
  if (!response.ok) {
    throw new Error("加载 BOM配送检查统计失败")
  }
  return response.json()
}

type CreateBomSpecCompareTaskInput = {
  taskName: string
  projectFile: File
}

async function createBomSpecCompareTask(
  input: CreateBomSpecCompareTaskInput,
): Promise<BomSpecCompareTask> {
  const formData = new FormData()
  if (input.taskName.trim()) {
    formData.append("task_name", input.taskName.trim())
  }
  formData.append("project_upload", input.projectFile)

  const response = await fetch(`${OpenAPI.BASE}/api/v1/bom-spec-compare-tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.detail || "提交 BOM配送检查任务失败")
  }
  return response.json()
}

async function deleteBomSpecCompareTask(taskId: string): Promise<{ message: string }> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-spec-compare-tasks/${taskId}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  )
  if (!response.ok) {
    throw new Error("删除 BOM配送检查任务失败")
  }
  return response.json()
}

async function downloadBomSpecCompareReport(task: BomSpecCompareTask) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-spec-compare-tasks/${task.id}/report`,
    { headers: authHeaders() },
  )
  if (!response.ok) {
    throw new Error("下载 BOM配送检查报告失败")
  }
  const blob = await response.blob()
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = task.result_files[0]?.file_name || "BOM与规格书配件对比清单.zip"
  link.click()
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(task: BomSpecCompareTask) {
  if (!task.started_at) return "-"
  const startTime = new Date(task.started_at).getTime()
  const endTime = task.finished_at ? new Date(task.finished_at).getTime() : Date.now()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return "-"
  }
  const totalSeconds = Math.floor((endTime - startTime) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`
}

function BomSpecStatusBadge({ status }: { status: BomSpecCompareTaskStatus }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        status === "success" && "border-green-200 bg-green-50 text-green-700",
        ["failed", "timeout"].includes(status) &&
          "border-red-200 bg-red-50 text-red-700",
        ["queued", "preparing", "running", "uploading_report"].includes(status) &&
          "border-blue-200 bg-blue-50 text-blue-700",
        status === "cancelled" && "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {statusLabels[status]}
    </Badge>
  )
}

function BomSpecStatsCards({ scope = "mine" }: { scope?: TaskScope }) {
  const { data: stats } = useSuspenseQuery({
    queryFn: () => readBomSpecCompareStats(scope),
    queryKey: ["bom-spec-compare-task-stats", scope],
  })
  const cards = [
    { label: "任务总数", value: stats.task_total_count ?? stats.total },
    { label: "成功任务", value: stats.task_success_count ?? stats.success },
    { label: "失败任务", value: stats.task_failed_count ?? stats.failed_or_error },
    { label: "项目总数", value: stats.project_total_count ?? stats.project_count },
    {
      label: "一致项目",
      value: stats.project_consistent_count ?? stats.consistent_count,
    },
    {
      label: "异常项目",
      value:
        (stats.project_different_count ?? stats.different_count) +
        (stats.project_failed_count ?? stats.failed_count),
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
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

function BomSpecStatsSection({ scope = "mine" }: { scope?: TaskScope }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground">加载统计中...</div>}>
      <BomSpecStatsCards scope={scope} />
    </Suspense>
  )
}

function CreateBomSpecTaskForm() {
  const queryClient = useQueryClient()
  const [taskName, setTaskName] = useState("")
  const [projectFile, setProjectFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)

  const mutation = useMutation({
    mutationFn: createBomSpecCompareTask,
    onSuccess: async () => {
      toast.success("BOM配送检查任务已提交")
      setTaskName("")
      setProjectFile(null)
      setFileInputKey((current) => current + 1)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bom-spec-compare-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["bom-spec-compare-task-stats"] }),
      ])
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "提交任务失败")
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!projectFile) {
      toast.error("请上传项目压缩包")
      return
    }
    mutation.mutate({ taskName, projectFile })
  }

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-4" />
          新建 BOM配送检查任务
        </CardTitle>
        <CardDescription>
          上传单项目或批量项目压缩包（zip、rar、7z），服务端会调用 Codex 按固定规则生成对比清单。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 lg:grid-cols-[260px_1fr_180px]" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="bom-spec-task-name">任务名称</Label>
            <Input
              id="bom-spec-task-name"
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
              placeholder="例如：7-3 批量检查"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bom-spec-upload">项目压缩包</Label>
            <Input
              key={fileInputKey}
              id="bom-spec-upload"
              type="file"
              accept=".zip,.rar,.7z"
              onChange={(event) => setProjectFile(event.target.files?.[0] ?? null)}
              required
            />
            {projectFile ? (
              <div className="text-xs text-muted-foreground">
                已选择 {projectFile.name}（{formatFileSize(projectFile.size)}）
              </div>
            ) : null}
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={mutation.isPending} className="w-full">
              {mutation.isPending ? "执行中..." : "提交检查"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function BomSpecTasksTable({ scope = "mine" }: { scope?: TaskScope }) {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery({
    queryFn: () => readBomSpecCompareTasks(scope),
    queryKey: ["bom-spec-compare-tasks", scope],
    refetchInterval: (query) =>
      query.state.data?.data.some((task) => runningStatuses.includes(task.status))
        ? 5000
        : false,
  })
  const hasRunningTasks = data.data.some((task) =>
    runningStatuses.includes(task.status),
  )
  const [, setElapsedTick] = useState(0)

  useEffect(() => {
    if (!hasRunningTasks) return
    const timer = window.setInterval(() => {
      setElapsedTick((current) => current + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hasRunningTasks])

  const invalidateTasks = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bom-spec-compare-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["bom-spec-compare-task-stats"] }),
    ])
  }

  const deleteMutation = useMutation({
    mutationFn: deleteBomSpecCompareTask,
    onSuccess: async () => {
      toast.success("BOM配送检查任务已删除")
      await invalidateTasks()
    },
    onError: () => toast.error("删除 BOM配送检查任务失败"),
  })

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="h-14 hover:bg-transparent">
          <TableHead className="w-[12%] px-3">创建时间</TableHead>
          <TableHead className="w-[11%] px-3">用户</TableHead>
          <TableHead className="w-[9%] px-3">状态</TableHead>
          <TableHead className="w-[9%] px-3">耗时</TableHead>
          <TableHead className="w-[18%] px-3">任务</TableHead>
          <TableHead className="w-[15%] px-3">上传文件</TableHead>
          <TableHead className="w-[16%] px-3">结果统计</TableHead>
          <TableHead className="w-[5%] px-2 text-center">报告</TableHead>
          <TableHead className="w-[5%] px-2 text-center">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.data.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
              暂无 BOM配送检查任务
            </TableCell>
          </TableRow>
        ) : (
          data.data.map((task) => (
            <TableRow key={task.id} className="h-[112px]">
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
                <BomSpecStatusBadge status={task.status} />
              </TableCell>
              <TableCell className="px-3 text-sm text-muted-foreground">
                {formatDuration(task)}
              </TableCell>
              <TableCell className="px-3">
                <div className="truncate font-medium" title={task.task_name}>
                  {task.task_name}
                </div>
                {task.error_message ? (
                  <div className="mt-1 line-clamp-2 text-xs text-red-600">
                    {task.error_message}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="px-3">
                <div className="grid gap-1 text-xs text-muted-foreground">
                  {task.input_files.slice(0, 2).map((file) => (
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
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <span className="text-muted-foreground">项目</span>
                  <span>{task.project_count}</span>
                  <span className="text-muted-foreground">一致</span>
                  <span className="text-green-700">{task.consistent_count}</span>
                  <span className="text-muted-foreground">差异</span>
                  <span className={task.different_count > 0 ? "text-red-700" : ""}>
                    {task.different_count}
                  </span>
                </div>
              </TableCell>
              <TableCell className="px-2 text-center">
                {task.result_files.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="下载 BOM配送检查报告"
                    onClick={() => void downloadBomSpecCompareReport(task)}
                  >
                    <Download />
                  </Button>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="px-2 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="删除 BOM配送检查任务"
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

function BomSpecTasksSection({ scope = "mine" }: { scope?: TaskScope }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground">加载中...</div>}>
      <BomSpecTasksTable scope={scope} />
    </Suspense>
  )
}

export function BomSpecCompareTasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">BOM配送检查</h1>
        <p className="text-muted-foreground">
          上传项目资料，自动生成 BOM 配送检查清单和批量汇总报告。
        </p>
      </div>

      <CreateBomSpecTaskForm />
      <BomSpecStatsSection />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>
            匹配规则沿用 bom-spec-compare skill，报告按任务独立保存并可下载。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[460px] overflow-y-auto rounded-md border [scrollbar-gutter:stable]">
            <BomSpecTasksSection />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function BomSpecCompareTaskManagementPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          BOM配送检查任务管理
        </h1>
        <p className="text-muted-foreground">
          查看 BOM配送检查任务的提交记录、执行状态、结果统计和输出报告。
        </p>
      </div>

      <BomSpecStatsSection scope="all" />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>任务记录</CardTitle>
          <CardDescription>
            管理员可查看所有人的任务记录和输出报告，普通用户只显示自己的任务。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[640px] overflow-y-auto rounded-md border [scrollbar-gutter:stable]">
            <BomSpecTasksSection scope="all" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
