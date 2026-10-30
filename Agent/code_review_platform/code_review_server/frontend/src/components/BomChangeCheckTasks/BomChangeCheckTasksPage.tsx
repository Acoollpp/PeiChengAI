import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  Plus,
  Trash2,
} from "lucide-react"
import { FormEvent, useState } from "react"
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

type BomChangeCheckTaskStatus =
  | "created"
  | "queued"
  | "preparing"
  | "running"
  | "uploading_report"
  | "success"
  | "failed"
  | "timeout"
  | "cancelled"

type BomChangeCheckFile = {
  file_name: string
  file_path: string
  content_type?: string | null
  file_size: number
  role?: string
}

type BomChangeCheckTask = {
  id: string
  user_id: string
  user_name?: string | null
  svn_username?: string | null
  task_name: string
  status: BomChangeCheckTaskStatus
  input_files: BomChangeCheckFile[]
  result_files: BomChangeCheckFile[]
  change_order_abnormal_count: number
  bom_diff_abnormal_count: number
  replacement_abnormal_count: number
  customer_restriction_abnormal_count: number
  manual_review_count: number
  skipped_count: number
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  updated_at?: string | null
}

type BomChangeCheckTasksResponse = {
  data: BomChangeCheckTask[]
  count: number
}

type BomChangeCheckTaskStats = {
  total: number
  success: number
  running: number
  failed_or_error: number
  change_order_abnormal_count: number
  bom_diff_abnormal_count: number
  replacement_abnormal_count: number
  customer_restriction_abnormal_count: number
  manual_review_count: number
  skipped_count: number
  by_status: Record<BomChangeCheckTaskStatus, number>
}

type BomChangeReplacementTable = {
  exists: boolean
  role?: string
  label?: string
  file_name?: string
  file_size?: number
  content_type?: string | null
  uploaded_at?: string | null
  uploaded_by?: string | null
  note?: string | null
}

type BomChangeReplacementTables = {
  exists: boolean
  all_exists?: boolean
  tables?: {
    key?: BomChangeReplacementTable
    no_key?: BomChangeReplacementTable
  }
}

type TaskScope = "mine" | "all"

const statusLabels: Record<BomChangeCheckTaskStatus, string> = {
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

const runningStatuses: BomChangeCheckTaskStatus[] = [
  "queued",
  "preparing",
  "running",
  "uploading_report",
]

const fileRoleLabels: Record<string, string> = {
  project_upload: "项目压缩包",
  replacement_table_used: "替代表",
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

async function readBomChangeCheckTasks(
  scope: TaskScope,
): Promise<BomChangeCheckTasksResponse> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-change-check-tasks?limit=100${scopeQuery(scope)}`,
    { headers: authHeaders() },
  )
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    throw new Error("加载 BOM改制检查任务失败")
  }
  return response.json()
}

async function readBomChangeCheckStats(
  scope: TaskScope,
): Promise<BomChangeCheckTaskStats> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-change-check-tasks/stats?scope=${scope}`,
    { headers: authHeaders() },
  )
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    throw new Error("加载 BOM改制检查统计失败")
  }
  return response.json()
}

async function readBomChangeReplacementTable(): Promise<BomChangeReplacementTables> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-change-check-tasks/replacement-table`,
    { headers: authHeaders() },
  )
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    throw new Error("加载替代表信息失败")
  }
  return response.json()
}

type CreateBomChangeCheckTaskInput = {
  taskName: string
  projectFile: File
  keyReplacementTableFile?: File | null
  noKeyReplacementTableFile?: File | null
}

async function createBomChangeCheckTask(
  input: CreateBomChangeCheckTaskInput,
): Promise<BomChangeCheckTask> {
  const formData = new FormData()
  if (input.taskName.trim()) {
    formData.append("task_name", input.taskName.trim())
  }
  formData.append("project_upload", input.projectFile)
  if (input.keyReplacementTableFile) {
    formData.append("key_replacement_table_upload", input.keyReplacementTableFile)
  }
  if (input.noKeyReplacementTableFile) {
    formData.append("no_key_replacement_table_upload", input.noKeyReplacementTableFile)
  }

  const response = await fetch(`${OpenAPI.BASE}/api/v1/bom-change-check-tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  })
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.detail || "提交 BOM改制检查任务失败")
  }
  return response.json()
}

async function deleteBomChangeCheckTask(taskId: string): Promise<{ message: string }> {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-change-check-tasks/${taskId}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  )
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    throw new Error("删除 BOM改制检查任务失败")
  }
  return response.json()
}

async function downloadBomChangeCheckResultFile(task: BomChangeCheckTask, fileIndex = 0) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/bom-change-check-tasks/${task.id}/result-files/${fileIndex}`,
    { headers: authHeaders() },
  )
  if (handleAuthFailure(response)) {
    throw new Error("登录已失效，请重新登录")
  }
  if (!response.ok) {
    throw new Error("下载 BOM改制检查报告失败")
  }
  const blob = await response.blob()
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = task.result_files[fileIndex]?.file_name || "BOM表改制检查报告.zip"
  link.click()
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(task: BomChangeCheckTask) {
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

function BomChangeStatusBadge({ status }: { status: BomChangeCheckTaskStatus }) {
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

function BomChangeStatsCards({ scope = "mine" }: { scope?: TaskScope }) {
  const { data: stats, error, isLoading } = useQuery({
    queryFn: () => readBomChangeCheckStats(scope),
    queryKey: ["bom-change-check-task-stats", scope],
    retry: false,
  })
  if (isLoading) {
    return <div className="text-muted-foreground">加载统计中...</div>
  }
  if (error || !stats) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error instanceof Error ? error.message : "加载 BOM改制检查统计失败"}
      </div>
    )
  }
  const cards = [
    { label: "任务总数", value: stats.total },
    { label: "成功任务", value: stats.success },
    { label: "失败任务", value: stats.failed_or_error },
    { label: "改制单异常", value: stats.change_order_abnormal_count },
    { label: "BOM差异异常", value: stats.bom_diff_abnormal_count },
    { label: "替代料异常", value: stats.replacement_abnormal_count },
    { label: "客户限制异常", value: stats.customer_restriction_abnormal_count },
    { label: "人工复查", value: stats.manual_review_count },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
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

function BomChangeStatsSection({ scope = "mine" }: { scope?: TaskScope }) {
  return <BomChangeStatsCards scope={scope} />
}

function CreateBomChangeTaskForm() {
  const queryClient = useQueryClient()
  const [taskName, setTaskName] = useState("")
  const [projectFile, setProjectFile] = useState<File | null>(null)
  const [keyReplacementTableFile, setKeyReplacementTableFile] = useState<File | null>(null)
  const [noKeyReplacementTableFile, setNoKeyReplacementTableFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)

  const {
    data: replacementTable,
    error: replacementTableError,
    isLoading: isReplacementTableLoading,
  } = useQuery({
    queryFn: readBomChangeReplacementTable,
    queryKey: ["bom-change-check-replacement-table"],
    retry: false,
  })

  const mutation = useMutation({
    mutationFn: createBomChangeCheckTask,
    onSuccess: async () => {
      toast.success("BOM改制检查任务已提交")
      setTaskName("")
      setProjectFile(null)
      setKeyReplacementTableFile(null)
      setNoKeyReplacementTableFile(null)
      setFileInputKey((current) => current + 1)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bom-change-check-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["bom-change-check-task-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["bom-change-check-replacement-table"] }),
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
    if (
      !keyReplacementTableFile &&
      !noKeyReplacementTableFile &&
      replacementTable?.exists === false
    ) {
      toast.error("请先上传关键物料替代表或无关键物料替代表")
      return
    }
    mutation.mutate({
      taskName,
      projectFile,
      keyReplacementTableFile,
      noKeyReplacementTableFile,
    })
  }

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-4" />
          新建 BOM改制检查任务
        </CardTitle>
        <CardDescription>
          上传压缩包（zip、rar、7z），里面按固定文件夹放改制前BOM、改制后BOM和改制表；只核对替代料组齐全的 BOM 放在更新后BOM 文件夹。关键物料/无关键物料替代表可放在压缩包公司物料表目录；下方单独上传用于更新平台保存版本。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            {isReplacementTableLoading ? (
              <span className="text-muted-foreground">正在读取当前替代表...</span>
            ) : replacementTableError ? (
              <span className="text-red-700">
                {replacementTableError instanceof Error
                  ? replacementTableError.message
                  : "加载替代表信息失败"}
              </span>
            ) : replacementTable?.exists ? (
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ["key", "当前生效关键物料替代表", replacementTable.tables?.key],
                  ["no_key", "当前生效无关键物料替代表", replacementTable.tables?.no_key],
                ].map(([role, label, table]) => {
                  const current = table as BomChangeReplacementTable | undefined
                  return (
                    <div key={role as string} className="grid gap-1">
                      <div className="font-medium">{label as string}</div>
                      {current?.exists ? (
                        <div className="text-muted-foreground">
                          {current.file_name}（{formatFileSize(current.file_size || 0)}）
                          {current.uploaded_by ? `，上传人：${current.uploaded_by}` : ""}
                          {current.uploaded_at
                            ? `，上传时间：${formatReviewTaskDateTime(current.uploaded_at)}`
                            : ""}
                        </div>
                      ) : (
                        <div className="text-red-700">当前未上传</div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <span className="text-red-700">
                当前还没有平台关键物料替代表或无关键物料替代表，本次提交必须上传。
              </span>
            )}
          </div>
          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="bom-change-task-name">任务名称</Label>
              <Input
                id="bom-change-task-name"
                value={taskName}
                onChange={(event) => setTaskName(event.target.value)}
                placeholder="例如：616291001 改制检查"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bom-change-upload">项目压缩包</Label>
              <Input
                key={fileInputKey}
                id="bom-change-upload"
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
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="bom-change-key-replacement-upload">
                关键物料替代表（可选，有更新时上传）
              </Label>
              <Input
                key={`key-replacement-${fileInputKey}`}
                id="bom-change-key-replacement-upload"
                type="file"
                accept=".xlsx,.xlsm"
                onChange={(event) => setKeyReplacementTableFile(event.target.files?.[0] ?? null)}
              />
              {keyReplacementTableFile ? (
                <div className="text-xs text-muted-foreground">
                  已选择 {keyReplacementTableFile.name}（{formatFileSize(keyReplacementTableFile.size)}）
                </div>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bom-change-no-key-replacement-upload">
                无关键物料替代表（可选，有更新时上传）
              </Label>
              <Input
                key={`no-key-replacement-${fileInputKey}`}
                id="bom-change-no-key-replacement-upload"
                type="file"
                accept=".xlsx,.xlsm"
                onChange={(event) => setNoKeyReplacementTableFile(event.target.files?.[0] ?? null)}
              />
              {noKeyReplacementTableFile ? (
                <div className="text-xs text-muted-foreground">
                  已选择 {noKeyReplacementTableFile.name}（{formatFileSize(noKeyReplacementTableFile.size)}）
                </div>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground md:col-span-2">
              上传后本次任务会优先按网页上传的对应替代表检查，并保存为全平台最新版本；不上传则优先使用压缩包公司物料表目录内的替代表，压缩包未提供时使用上方显示的当前生效版本。
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={mutation.isPending} className="w-full sm:w-40">
              {mutation.isPending ? "提交中..." : "提交检查"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function BomChangeTasksTable({ scope = "mine" }: { scope?: TaskScope }) {
  const queryClient = useQueryClient()
  const { data, error, isLoading } = useQuery({
    queryFn: () => readBomChangeCheckTasks(scope),
    queryKey: ["bom-change-check-tasks", scope],
    refetchInterval: (query) =>
      query.state.data?.data.some((task) => runningStatuses.includes(task.status))
        ? 5000
        : false,
    retry: false,
  })

  const invalidateTasks = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bom-change-check-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["bom-change-check-task-stats"] }),
    ])
  }

  const deleteMutation = useMutation({
    mutationFn: deleteBomChangeCheckTask,
    onSuccess: async () => {
      toast.success("BOM改制检查任务已删除")
      await invalidateTasks()
    },
    onError: () => toast.error("删除 BOM改制检查任务失败"),
  })

  if (isLoading) {
    return <div className="p-3 text-muted-foreground">加载中...</div>
  }
  if (error || !data) {
    return (
      <div className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error instanceof Error ? error.message : "加载 BOM改制检查任务失败"}
      </div>
    )
  }

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="h-14 hover:bg-transparent">
          <TableHead className="w-[12%] px-3">创建时间</TableHead>
          <TableHead className="w-[10%] px-3">用户</TableHead>
          <TableHead className="w-[8%] px-3">状态</TableHead>
          <TableHead className="w-[8%] px-3">耗时</TableHead>
          <TableHead className="w-[16%] px-3">任务</TableHead>
          <TableHead className="w-[18%] px-3">上传文件</TableHead>
          <TableHead className="w-[20%] px-3">结果统计</TableHead>
          <TableHead className="w-[4%] px-2 text-center">报告</TableHead>
          <TableHead className="w-[4%] px-2 text-center">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.data.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
              暂无 BOM改制检查任务
            </TableCell>
          </TableRow>
        ) : (
          data.data.map((task) => (
            <TableRow key={task.id} className="h-[128px]">
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
                <BomChangeStatusBadge status={task.status} />
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
                  {task.input_files.slice(0, 4).map((file) => (
                    <div key={file.file_path} className="flex min-w-0 items-center gap-2">
                      <FileSpreadsheet className="size-3 shrink-0" />
                      <span className="shrink-0 text-foreground">
                        {fileRoleLabels[file.role || ""] || "文件"}
                      </span>
                      <span className="truncate" title={file.file_name}>
                        {file.file_name}
                      </span>
                    </div>
                  ))}
                </div>
              </TableCell>
              <TableCell className="px-3">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <span className="text-muted-foreground">改制单异常</span>
                  <span className={task.change_order_abnormal_count > 0 ? "text-red-700" : ""}>
                    {task.change_order_abnormal_count}
                  </span>
                  <span className="text-muted-foreground">BOM差异异常</span>
                  <span className={task.bom_diff_abnormal_count > 0 ? "text-red-700" : ""}>
                    {task.bom_diff_abnormal_count}
                  </span>
                  <span className="text-muted-foreground">替代料异常</span>
                  <span className={task.replacement_abnormal_count > 0 ? "text-red-700" : ""}>
                    {task.replacement_abnormal_count}
                  </span>
                  <span className="text-muted-foreground">客户限制异常</span>
                  <span
                    className={
                      task.customer_restriction_abnormal_count > 0 ? "text-red-700" : ""
                    }
                  >
                    {task.customer_restriction_abnormal_count}
                  </span>
                  <span className="text-muted-foreground">人工复查/跳过</span>
                  <span>
                    {task.manual_review_count}/{task.skipped_count}
                  </span>
                </div>
              </TableCell>
              <TableCell className="px-2 text-center">
                {task.result_files.length > 0 ? (
                  <div className="flex max-w-64 flex-col items-start gap-1">
                    {task.result_files.map((file, fileIndex) => (
                      <Button
                        key={`${file.file_name}-${fileIndex}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto max-w-full justify-start px-2 py-1 text-left"
                        title={`${file.file_name} (${formatFileSize(file.file_size)})`}
                        onClick={() => void downloadBomChangeCheckResultFile(task, fileIndex)}
                      >
                        <Download className="mr-1 h-4 w-4 shrink-0" />
                        <span className="truncate">{file.file_name}</span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="px-2 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="删除 BOM改制检查任务"
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

function BomChangeTasksSection({ scope = "mine" }: { scope?: TaskScope }) {
  return <BomChangeTasksTable scope={scope} />
}

export function BomChangeCheckTasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">BOM改制检查</h1>
        <p className="text-muted-foreground">
          按改制表中的项目号和版本号匹配改制前后 BOM，核对改制单、替代料关系和客户限制。
        </p>
      </div>

      <CreateBomChangeTaskForm />
      <BomChangeStatsSection />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>
            报告沿用 bom-change-check skill 规则，异常和人工复查项会在 Excel 中标黄。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[520px] overflow-y-auto rounded-md border [scrollbar-gutter:stable]">
            <BomChangeTasksSection />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function BomChangeCheckTaskManagementPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          BOM改制检查任务管理
        </h1>
        <p className="text-muted-foreground">
          查看 BOM改制检查任务的提交记录、执行状态、异常统计和输出报告。
        </p>
      </div>

      <BomChangeStatsSection scope="all" />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>任务记录</CardTitle>
          <CardDescription>
            管理员可查看所有人的任务记录和输出报告，普通用户只显示自己的任务。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[680px] overflow-y-auto rounded-md border [scrollbar-gutter:stable]">
            <BomChangeTasksSection scope="all" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
