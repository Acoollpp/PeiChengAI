import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BarChart3, Download, FileSpreadsheet, Plus, Trash2 } from "lucide-react"
import { FormEvent, useRef, useState } from "react"
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

type BomElectronicEditTaskStatus =
  | "created"
  | "queued"
  | "preparing"
  | "running"
  | "uploading_report"
  | "success"
  | "failed"
  | "timeout"
  | "cancelled"

type BomElectronicEditFile = {
  file_name: string
  file_path: string
  content_type?: string | null
  file_size: number
  role?: string
}

type BomElectronicEditTask = {
  id: string
  user_id: string
  user_name?: string | null
  svn_username?: string | null
  task_name: string
  status: BomElectronicEditTaskStatus
  input_files: BomElectronicEditFile[]
  result_files: BomElectronicEditFile[]
  modified_count: number
  abnormal_count: number
  report_count: number
  processed_sheet_count: number
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  updated_at?: string | null
}

type BomElectronicEditTasksResponse = {
  data: BomElectronicEditTask[]
  count: number
}

type BomElectronicEditTaskStats = {
  total: number
  success: number
  running: number
  failed_or_error: number
  modified_count: number
  abnormal_count: number
  report_count: number
  processed_sheet_count: number
  by_status: Record<BomElectronicEditTaskStatus, number>
}

type TaskScope = "mine" | "all"

const statusLabels: Record<BomElectronicEditTaskStatus, string> = {
  created: "已创建",
  queued: "等待执行",
  preparing: "准备中",
  running: "执行中",
  uploading_report: "生成结果",
  success: "已完成",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
}

const runningStatuses: BomElectronicEditTaskStatus[] = [
  "queued",
  "preparing",
  "running",
  "uploading_report",
]

const fileRoleLabels: Record<string, string> = {
  project_archive: "资料压缩包",
  change_notice: "工程变更通知单",
  bom: "BOM表",
  material_master: "物料主数据",
  modified_bom_bundle: "修改后BOM结果包",
}

function summarizeInputFiles(files: BomElectronicEditFile[]) {
  const visibleFiles = files.filter((file) => file.role !== "task_options")
  const bomFiles = visibleFiles.filter((file) => file.role === "bom")
  const primaryFiles = visibleFiles.filter((file) => file.role !== "bom")
  const summary = primaryFiles.map((file) => ({
    key: `${file.role || "file"}-${file.file_path || file.file_name}`,
    label: fileRoleLabels[file.role || ""] || "文件",
    name: file.file_name,
    title: file.file_name,
  }))

  if (bomFiles.length > 0) {
    summary.push({
      key: "bom-summary",
      label: "BOM表",
      name: `${bomFiles.length} 个`,
      title: bomFiles.map((file) => file.file_name).join("\n"),
    })
  }

  return summary
}

function authHeaders() {
  const token = localStorage.getItem("access_token")
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

function handleAuthFailure(response: Response) {
  if ([401, 403].includes(response.status)) {
    localStorage.removeItem("access_token")
    window.location.href = "/login"
    return true
  }
  return false
}

function scopeQuery(scope: TaskScope) {
  return scope === "all" ? "&scope=all" : ""
}

async function readBomElectronicEditTasks(
  scope: TaskScope,
): Promise<BomElectronicEditTasksResponse> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-electronic-edit-tasks?limit=100${scopeQuery(scope)}`,
    { headers: authHeaders() },
  )
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    throw new Error("加载 BOM电子档修改任务失败")
  }
  return response.json()
}

async function readBomElectronicEditStats(
  scope: TaskScope,
): Promise<BomElectronicEditTaskStats> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-electronic-edit-tasks/stats?scope=${scope}`,
    { headers: authHeaders() },
  )
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    throw new Error("加载 BOM电子档修改统计失败")
  }
  return response.json()
}

type CreateBomElectronicEditTaskInput = {
  taskName: string
  projectArchiveFile: File
}

async function createBomElectronicEditTask(
  input: CreateBomElectronicEditTaskInput,
): Promise<BomElectronicEditTask> {
  const formData = new FormData()
  if (input.taskName.trim()) {
    formData.append("task_name", input.taskName.trim())
  }
  formData.append("project_archive_upload", input.projectArchiveFile)

  const response = await fetch(`${OpenAPI.BASE}/api/v1/bom-electronic-edit-tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  })
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.detail || "提交 BOM电子档修改任务失败")
  }
  return response.json()
}

async function deleteBomElectronicEditTask(taskId: string): Promise<{ message: string }> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-electronic-edit-tasks/${taskId}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  )
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    throw new Error("删除 BOM电子档修改任务失败")
  }
  return response.json()
}

async function downloadBomElectronicEditReport(task: BomElectronicEditTask) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-electronic-edit-tasks/${task.id}/download-ticket`,
    { method: "POST", headers: authHeaders() },
  )
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    throw new Error("下载 BOM电子档修改结果失败")
  }
  const { url } = (await response.json()) as { url?: string }
  if (!url) {
    throw new Error("下载 BOM电子档修改结果失败")
  }
  const link = document.createElement("a")
  link.href = `${OpenAPI.BASE}${url}`
  link.download = task.result_files[0]?.file_name || "BOM电子档修改结果.zip"
  link.style.display = "none"
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    link.remove()
  }, 1000)
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatElapsedTime(startedAt?: string | null, finishedAt?: string | null) {
  if (!startedAt) return "-"
  const startTime = new Date(startedAt).getTime()
  const endTime = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return "-"
  }
  const totalSeconds = Math.floor((endTime - startTime) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`
}

function formatQueueWait(task: BomElectronicEditTask) {
  return formatElapsedTime(task.created_at, task.started_at)
}

function formatProcessingTime(task: BomElectronicEditTask) {
  return formatElapsedTime(task.started_at, task.finished_at)
}

function BomElectronicStatusBadge({ status }: { status: BomElectronicEditTaskStatus }) {
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

function BomElectronicStatsCards({ scope = "mine" }: { scope?: TaskScope }) {
  const { data: stats, error, isLoading } = useQuery({
    queryFn: () => readBomElectronicEditStats(scope),
    queryKey: ["bom-electronic-edit-task-stats", scope],
    retry: false,
  })
  if (isLoading) {
    return <div className="text-muted-foreground">加载统计中...</div>
  }
  if (error || !stats) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error instanceof Error ? error.message : "加载 BOM电子档修改统计失败"}
      </div>
    )
  }
  const cards = [
    { label: "任务总数", value: stats.total },
    { label: "成功任务", value: stats.success },
    { label: "失败任务", value: stats.failed_or_error },
    { label: "修改记录", value: stats.modified_count },
    { label: "异常记录", value: stats.abnormal_count },
    { label: "报告记录", value: stats.report_count },
    { label: "处理Sheet", value: stats.processed_sheet_count },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
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

function CreateBomElectronicEditTaskForm() {
  const queryClient = useQueryClient()
  const [taskName, setTaskName] = useState("")
  const [projectArchiveFile, setProjectArchiveFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)

  const mutation = useMutation({
    mutationFn: createBomElectronicEditTask,
    onSuccess: async () => {
      toast.success("BOM电子档修改任务已提交")
      setTaskName("")
      setProjectArchiveFile(null)
      setFileInputKey((current) => current + 1)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bom-electronic-edit-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["bom-electronic-edit-task-stats"] }),
      ])
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "提交任务失败")
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!["廖晶华", "邓如锦", "刘德媚"].some((name) => taskName.includes(name))) {
      toast.error("任务名称需包含廖晶华、邓如锦或刘德媚，用于填写变更记录人员")
      return
    }
    if (!projectArchiveFile) {
      toast.error("请上传BOM电子档修改资料压缩包")
      return
    }
    mutation.mutate({ taskName, projectArchiveFile })
  }

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-4" />
          新建 BOM电子档修改任务
        </CardTitle>
        <CardDescription>
          上传一个资料压缩包，包内放一份工程变更通知单、一份物料主数据查询 Excel，以及名为“变更BOM”的文件夹；该文件夹内可放多个待修改 BOM。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="bom-electronic-task-name">任务名称</Label>
            <Input
              id="bom-electronic-task-name"
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
              placeholder="例如：7-31修改BOM廖晶华"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(280px,520px)_1fr]">
            <FileUploadField
              key={`archive-${fileInputKey}`}
              id="bom-electronic-archive"
              label="资料压缩包"
              files={projectArchiveFile ? [projectArchiveFile] : []}
              accept=".zip,.rar,.7z"
              onChange={(files) => setProjectArchiveFile(files[0] ?? null)}
            />
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              压缩包内需包含：工程变更通知单 Excel、物料主数据查询 Excel、变更BOM文件夹。变更BOM文件夹内的所有 Excel 都会按同一份变更通知单处理。
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={mutation.isPending} className="w-full sm:w-40">
              {mutation.isPending ? "提交中..." : "提交修改"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function FileUploadField({
  id,
  label,
  files,
  accept = ".xlsx,.xlsm",
  multiple = false,
  onChange,
}: {
  id: string
  label: string
  files: File[]
  accept?: string
  multiple?: boolean
  onChange: (files: File[]) => void
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
        required
      />
      {files.length > 0 ? (
        <div className="grid gap-1 text-xs text-muted-foreground">
          {files.slice(0, 3).map((file) => (
            <div key={`${file.name}-${file.size}`}>
              已选择 {file.name}（{formatFileSize(file.size)}）
            </div>
          ))}
          {files.length > 3 ? <div>另有 {files.length - 3} 个文件</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function BomElectronicTasksTable({ scope = "mine" }: { scope?: TaskScope }) {
  const queryClient = useQueryClient()
  const [downloadingTaskId, setDownloadingTaskId] = useState<string | null>(null)
  const downloadingTaskIdsRef = useRef(new Set<string>())
  const { data, error, isLoading } = useQuery({
    queryFn: () => readBomElectronicEditTasks(scope),
    queryKey: ["bom-electronic-edit-tasks", scope],
    refetchInterval: (query) =>
      query.state.data?.data.some((task) => runningStatuses.includes(task.status))
        ? 5000
        : false,
    retry: false,
  })

  const invalidateTasks = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bom-electronic-edit-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["bom-electronic-edit-task-stats"] }),
    ])
  }

  const deleteMutation = useMutation({
    mutationFn: deleteBomElectronicEditTask,
    onSuccess: async () => {
      toast.success("BOM电子档修改任务已删除")
      await invalidateTasks()
    },
    onError: () => toast.error("删除 BOM电子档修改任务失败"),
  })

  const handleDownload = async (task: BomElectronicEditTask) => {
    if (downloadingTaskIdsRef.current.has(task.id)) return

    downloadingTaskIdsRef.current.add(task.id)
    setDownloadingTaskId(task.id)
    try {
      await downloadBomElectronicEditReport(task)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载 BOM电子档修改结果失败")
    } finally {
      downloadingTaskIdsRef.current.delete(task.id)
      setDownloadingTaskId(null)
    }
  }

  if (isLoading) {
    return <div className="p-3 text-muted-foreground">加载中...</div>
  }
  if (error || !data) {
    return (
      <div className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error instanceof Error ? error.message : "加载 BOM电子档修改任务失败"}
      </div>
    )
  }

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="h-14 hover:bg-transparent">
          <TableHead className="w-[11%] px-3">创建时间</TableHead>
          <TableHead className="w-[9%] px-3">用户</TableHead>
          <TableHead className="w-[7%] px-3">状态</TableHead>
          <TableHead className="w-[8%] px-3">排队等待</TableHead>
          <TableHead className="w-[8%] px-3">实际处理</TableHead>
          <TableHead className="w-[17%] px-3">任务</TableHead>
          <TableHead className="w-[19%] px-3">上传文件</TableHead>
          <TableHead className="w-[13%] px-3">结果统计</TableHead>
          <TableHead className="w-[4%] px-2 text-center">结果</TableHead>
          <TableHead className="w-[4%] px-2 text-center">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.data.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
              暂无 BOM电子档修改任务
            </TableCell>
          </TableRow>
        ) : (
          data.data.map((task) => (
            <TableRow key={task.id} className="h-24">
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
                <BomElectronicStatusBadge status={task.status} />
              </TableCell>
              <TableCell className="px-3 text-sm text-muted-foreground">
                {formatQueueWait(task)}
              </TableCell>
              <TableCell className="px-3 text-sm text-muted-foreground">
                {formatProcessingTime(task)}
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
                <div className="grid max-h-20 gap-1 overflow-hidden text-xs text-muted-foreground">
                  {summarizeInputFiles(task.input_files).map((file) => (
                    <div key={file.key} className="flex min-w-0 items-center gap-2">
                      <FileSpreadsheet className="size-3 shrink-0" />
                      <span className="shrink-0 text-foreground">
                        {file.label}
                      </span>
                      <span className="truncate" title={file.title}>
                        {file.name}
                      </span>
                    </div>
                  ))}
                </div>
              </TableCell>
              <TableCell className="px-3">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <span className="text-muted-foreground">修改记录</span>
                  <span>{task.modified_count}</span>
                  <span className="text-muted-foreground">异常记录</span>
                  <span className={task.abnormal_count > 0 ? "text-red-700" : ""}>
                    {task.abnormal_count}
                  </span>
                  <span className="text-muted-foreground">处理Sheet</span>
                  <span>{task.processed_sheet_count}</span>
                </div>
              </TableCell>
              <TableCell className="px-2 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={task.status !== "success" || downloadingTaskId === task.id}
                  aria-label="下载 BOM电子档修改结果"
                  onClick={() => void handleDownload(task)}
                >
                  <Download className="size-4" />
                </Button>
              </TableCell>
              <TableCell className="px-2 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="删除 BOM电子档修改任务"
                  disabled={deleteMutation.isPending && deleteMutation.variables === task.id}
                  onClick={() => deleteMutation.mutate(task.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function BomElectronicTasksSection({ scope = "mine" }: { scope?: TaskScope }) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle>任务记录</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <BomElectronicTasksTable scope={scope} />
      </CardContent>
    </Card>
  )
}

export function BomElectronicEditTasksPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">BOM电子档修改</h1>
      </div>
      <CreateBomElectronicEditTaskForm />
      <BomElectronicStatsCards />
      <BomElectronicTasksSection />
    </div>
  )
}

export function BomElectronicEditTaskManagementPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">BOM电子档修改任务管理</h1>
      </div>
      <BomElectronicStatsCards scope="all" />
      <BomElectronicTasksSection scope="all" />
    </div>
  )
}
