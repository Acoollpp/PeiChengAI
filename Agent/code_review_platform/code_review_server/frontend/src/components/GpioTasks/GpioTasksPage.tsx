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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { cn } from "@/lib/utils"

type GpioTaskStatus =
  | "created"
  | "uploaded"
  | "analyzing"
  | "exporting_svn"
  | "running_codex"
  | "needs_confirmation"
  | "success"
  | "failed"

type GpioUploadedFile = {
  file_name: string
  file_path: string
  content_type?: string | null
  file_size: number
}

type GpioTask = {
  id: string
  user_id: string
  user_name?: string | null
  svn_username?: string | null
  project_no: string
  chip_model: string
  package_name?: string | null
  manual_file_name?: string | null
  code_svn_url: string
  code_revision: string
  svn_export_path?: string | null
  status: GpioTaskStatus
  uploaded_files: GpioUploadedFile[]
  recognition_summary?: Record<string, unknown> | null
  result_path?: string | null
  result_name?: string | null
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  updated_at?: string | null
}

type GpioTaskStats = {
  total: number
  success: number
  running: number
  failed_or_error: number
  by_status: Record<GpioTaskStatus, number>
  workbooks_by_user: Array<{
    user_name?: string | null
    svn_username?: string | null
    workbook_count: number
  }>
}

type GpioTasksResponse = {
  data: GpioTask[]
  count: number
}

type TaskScope = "mine" | "all"

const statusLabels: Record<GpioTaskStatus, string> = {
  created: "已创建",
  uploaded: "已上传",
  analyzing: "生成中",
  exporting_svn: "拉取SVN",
  running_codex: "Codex生成",
  needs_confirmation: "需确认",
  success: "已完成",
  failed: "失败",
}

const runningStatuses: GpioTaskStatus[] = [
  "uploaded",
  "analyzing",
  "exporting_svn",
  "running_codex",
  "needs_confirmation",
]

function authHeaders() {
  const token = localStorage.getItem("access_token")
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

function scopeQuery(scope: TaskScope) {
  return scope === "all" ? "&scope=all" : ""
}

async function readGpioTasks(scope: TaskScope): Promise<GpioTasksResponse> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/gpio-tasks?limit=100${scopeQuery(scope)}`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    throw new Error("Failed to load GPIO tasks")
  }
  return response.json()
}

async function readGpioTaskStats(scope: TaskScope): Promise<GpioTaskStats> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/gpio-tasks/stats?scope=${scope}`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    throw new Error("Failed to load GPIO task stats")
  }
  const stats = (await response.json()) as GpioTaskStats
  const defaultStatusCounts: Record<GpioTaskStatus, number> = {
    created: 0,
    uploaded: 0,
    analyzing: 0,
    exporting_svn: 0,
    running_codex: 0,
    needs_confirmation: 0,
    success: 0,
    failed: 0,
  }
  return {
    ...stats,
    by_status: { ...defaultStatusCounts, ...stats.by_status },
    workbooks_by_user: stats.workbooks_by_user ?? [],
  }
}

type CreateGpioTaskInput = {
  codeSvnUrl: string
  codeRevision: string
  manualFiles: File[]
}

type SvnCredentialInput = {
  svnUsername: string
  svnPassword: string
}

const SVN_CREDENTIAL_REQUIRED_MESSAGE = "Bind SVN credential before generation"

function isSvnCredentialRequiredError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === SVN_CREDENTIAL_REQUIRED_MESSAGE
  )
}

async function createGpioTask(input: CreateGpioTaskInput): Promise<GpioTask> {
  const formData = new FormData()
  formData.append("code_svn_url", input.codeSvnUrl)
  formData.append("code_revision", input.codeRevision)
  for (const file of input.manualFiles) {
    formData.append("manual_uploads", file)
  }

  const response = await fetch(`${OpenAPI.BASE}/api/v1/gpio-tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.detail || "Failed to create GPIO task")
  }
  return response.json()
}

async function updateSvnCredential(input: SvnCredentialInput) {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/me/svn-credential`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      svn_username: input.svnUsername,
      svn_password: input.svnPassword,
    }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.detail || "Failed to bind SVN credential")
  }
  return response.json()
}

async function deleteGpioTask(taskId: string): Promise<{ message: string }> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/gpio-tasks/${taskId}`, {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!response.ok) {
    throw new Error("Failed to delete GPIO task")
  }
  return response.json()
}

async function downloadGpioWorkbook(task: GpioTask) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/gpio-tasks/${task.id}/download`,
    {
      headers: authHeaders(),
    },
  )
  if (!response.ok) {
    throw new Error("Failed to download GPIO workbook")
  }
  const blob = await response.blob()
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = task.result_name || "GPIO配置表.xlsx"
  link.click()
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function GpioTaskStatusBadge({ status }: { status: GpioTaskStatus }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        status === "success" && "border-green-200 bg-green-50 text-green-700",
        status === "failed" && "border-red-200 bg-red-50 text-red-700",
        (status === "analyzing" ||
          status === "exporting_svn" ||
          status === "running_codex") &&
          "border-blue-200 bg-blue-50 text-blue-700",
        status === "needs_confirmation" &&
          "border-amber-200 bg-amber-50 text-amber-700",
        (status === "created" || status === "uploaded") &&
          "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {statusLabels[status]}
    </Badge>
  )
}

function SummaryValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">-</span>
  }
  return <span>{String(value)}</span>
}

function GpioStatsCards({ scope = "mine" }: { scope?: TaskScope }) {
  const { data: stats } = useSuspenseQuery({
    queryFn: () => readGpioTaskStats(scope),
    queryKey: ["gpio-task-stats", scope],
  })
  const cards = [
    { label: "任务总数", value: stats.total },
    { label: "已完成", value: stats.success },
    { label: "运行中", value: stats.running },
    { label: "失败", value: stats.failed_or_error },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-4">
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

function GpioStatsSection({ scope = "mine" }: { scope?: TaskScope }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground">加载统计中...</div>}>
      <GpioStatsCards scope={scope} />
    </Suspense>
  )
}

function GpioTasksTable({ scope = "mine" }: { scope?: TaskScope }) {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery({
    queryFn: () => readGpioTasks(scope),
    queryKey: ["gpio-tasks", scope],
    refetchInterval: (query) =>
      query.state.data?.data.some((task) =>
        runningStatuses.includes(task.status),
      )
        ? 5000
        : false,
  })

  const invalidateTasks = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["gpio-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["gpio-task-stats"] }),
    ])
  }

  const deleteMutation = useMutation({
    mutationFn: deleteGpioTask,
    onSuccess: async () => {
      toast.success("GPIO任务已删除")
      await invalidateTasks()
    },
    onError: () => toast.error("删除 GPIO 任务失败"),
  })

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="h-14 hover:bg-transparent">
          <TableHead className="w-[13%] px-3">创建时间</TableHead>
          <TableHead className="w-[11%] px-3">用户</TableHead>
          <TableHead className="w-[8%] px-3">状态</TableHead>
          <TableHead className="w-[22%] px-3">芯片手册</TableHead>
          <TableHead className="w-[16%] px-3">代码来源</TableHead>
          <TableHead className="w-[20%] px-3">识别摘要</TableHead>
          <TableHead className="w-[5%] px-2 text-center">结果</TableHead>
          <TableHead className="w-[5%] px-2 text-center">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.data.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
              暂无 GPIO 配置表任务
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
                <div
                  className="truncate text-xs text-muted-foreground"
                  title={task.svn_username || "-"}
                >
                  {task.svn_username || "-"}
                </div>
              </TableCell>
              <TableCell className="px-3">
                <GpioTaskStatusBadge status={task.status} />
              </TableCell>
              <TableCell className="px-3">
                <div className="grid gap-1 text-sm">
                  {task.uploaded_files.map((file) => (
                    <div
                      key={file.file_path}
                      className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
                    >
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
                <div className="grid min-w-0 gap-1 text-sm">
                  <span className="truncate" title={task.code_svn_url}>
                    {task.code_svn_url}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    版本：{task.code_revision}
                  </span>
                </div>
              </TableCell>
              <TableCell className="px-3">
                <div className="grid min-w-0 gap-1 text-sm">
                  <div className="truncate">
                    项目号：
                    <SummaryValue value={task.recognition_summary?.project} />
                  </div>
                  <div className="truncate">
                    芯片：
                    <SummaryValue value={task.recognition_summary?.chip} />
                  </div>
                  <div className="truncate">
                    封装：
                    <SummaryValue value={task.recognition_summary?.package} />
                  </div>
                </div>
              </TableCell>
              <TableCell className="px-2 text-center">
                {task.result_path ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="下载 GPIO 配置表"
                    onClick={() => void downloadGpioWorkbook(task)}
                  >
                    <Download />
                  </Button>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="px-2 text-center">
                <div className="flex items-center justify-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="删除 GPIO 任务"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(task.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function GpioTasksSection({ scope = "mine" }: { scope?: TaskScope }) {
  return (
    <Suspense fallback={<div className="text-muted-foreground">加载中...</div>}>
      <GpioTasksTable scope={scope} />
    </Suspense>
  )
}

function CreateGpioTaskForm() {
  const queryClient = useQueryClient()
  const [codeSvnUrl, setCodeSvnUrl] = useState("")
  const [codeRevision, setCodeRevision] = useState("")
  const [manualFiles, setManualFiles] = useState<File[]>([])
  const [manualInputKey, setManualInputKey] = useState(0)
  const [pendingTaskInput, setPendingTaskInput] =
    useState<CreateGpioTaskInput | null>(null)
  const [isSvnDialogOpen, setIsSvnDialogOpen] = useState(false)
  const [svnUsername, setSvnUsername] = useState("")
  const [svnPassword, setSvnPassword] = useState("")

  const mutation = useMutation({
    mutationFn: createGpioTask,
    onSuccess: async () => {
      toast.success("GPIO配置表任务已提交")
      setPendingTaskInput(null)
      setIsSvnDialogOpen(false)
      setCodeSvnUrl("")
      setCodeRevision("")
      setManualFiles([])
      setManualInputKey((current) => current + 1)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gpio-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["gpio-task-stats"] }),
      ])
    },
    onError: (error) => {
      if (isSvnCredentialRequiredError(error)) {
        setIsSvnDialogOpen(true)
        toast.info("请先填写 SVN 账号密码，保存后会继续提交当前任务")
        return
      }
      toast.error(error instanceof Error ? error.message : "提交 GPIO 任务失败")
    },
  })

  const svnCredentialMutation = useMutation({
    mutationFn: updateSvnCredential,
    onSuccess: () => {
      toast.success("SVN账号密码已保存，正在继续提交任务")
      setSvnPassword("")
      setIsSvnDialogOpen(false)
      if (pendingTaskInput) {
        mutation.mutate(pendingTaskInput)
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "保存 SVN 账号密码失败")
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (manualFiles.length === 0) {
      toast.error("请上传芯片手册或补充资料")
      return
    }
    const taskInput = {
      codeSvnUrl,
      codeRevision,
      manualFiles,
    }
    setPendingTaskInput(taskInput)
    mutation.mutate(taskInput)
  }

  const onSvnCredentialSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    svnCredentialMutation.mutate({
      svnUsername: svnUsername.trim(),
      svnPassword,
    })
  }

  return (
    <>
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4" />
            新建 GPIO 配置表任务
          </CardTitle>
          <CardDescription>
            上传芯片手册，填写项目代码 SVN 路径和版本号，服务端会统一拉取代码、识别项目和芯片信息并生成 Excel。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-3" onSubmit={onSubmit}>
            <div className="grid gap-2 lg:col-span-2">
              <Label htmlFor="code-svn-url">项目代码 SVN 路径</Label>
              <Input
                id="code-svn-url"
                value={codeSvnUrl}
                onChange={(event) => setCodeSvnUrl(event.target.value)}
                placeholder="svn://repo/project/trunk"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="code-revision">版本号</Label>
              <Input
                id="code-revision"
                value={codeRevision}
                onChange={(event) => setCodeRevision(event.target.value)}
                placeholder="12345 或 r12345"
                required
              />
            </div>
            <div className="grid gap-2 lg:col-span-2">
              <Label htmlFor="manual-upload">芯片手册/补充资料</Label>
              <Input
                key={manualInputKey}
                id="manual-upload"
                type="file"
                accept=".pdf,.doc,.docx,.csv,.txt,.zip"
                multiple
                onChange={(event) =>
                  setManualFiles(Array.from(event.target.files ?? []))
                }
                required
              />
              {manualFiles.length > 0 ? (
                <div className="text-xs text-muted-foreground">
                  已选择 {manualFiles.length} 个文件
                </div>
              ) : null}
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={mutation.isPending} className="w-full">
                {mutation.isPending ? "生成中..." : "提交生成"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={isSvnDialogOpen} onOpenChange={setIsSvnDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>填写 SVN 账号密码</DialogTitle>
            <DialogDescription>
              当前账号还没有绑定 SVN 凭据。保存后会继续提交刚才的 GPIO 任务。
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={onSvnCredentialSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="gpio-svn-username">SVN账号</Label>
              <Input
                id="gpio-svn-username"
                value={svnUsername}
                onChange={(event) => setSvnUsername(event.target.value)}
                className="font-mono"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gpio-svn-password">SVN密码</Label>
              <PasswordInput
                id="gpio-svn-password"
                value={svnPassword}
                onChange={(event) => setSvnPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={svnCredentialMutation.isPending}
                onClick={() => setIsSvnDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={svnCredentialMutation.isPending}>
                {svnCredentialMutation.isPending ? "保存中..." : "保存并继续"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function GpioTasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            GPIO配置表平台
          </h1>
          <p className="text-muted-foreground">
            上传芯片资料和 SVN 版本，生成并查看 GPIO 配置表 Excel 结果。
          </p>
        </div>
      </div>

      <CreateGpioTaskForm />

      <GpioStatsSection />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>
            登录、Key、用户、权限沿用原平台；GPIO 任务记录与资料文件独立于代码审查。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[404px] overflow-y-auto rounded-md border [scrollbar-gutter:stable]">
            <GpioTasksSection />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function GpioTaskManagementPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          GPIO配置表任务管理
        </h1>
        <p className="text-muted-foreground">
          查看 GPIO 配置表任务的提交记录、执行状态、识别摘要和输出 Excel。
        </p>
      </div>

      <GpioStatsSection scope="all" />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>任务记录</CardTitle>
          <CardDescription>
            管理员可查看所有人的 GPIO 配置表任务记录和输出，普通用户只显示自己的任务。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[640px] overflow-y-auto rounded-md border [scrollbar-gutter:stable]">
            <GpioTasksSection scope="all" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
