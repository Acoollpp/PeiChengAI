import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, ExternalLink, FileArchive, GitCompareArrows, Plus, Trash2 } from "lucide-react"
import { FormEvent, useState } from "react"
import { toast } from "sonner"

import { OpenAPI } from "@/client"
import { formatReviewTaskDateTime } from "@/components/Tasks/task-display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

type TaskStatus = "created" | "queued" | "preparing" | "running" | "uploading_report" | "success" | "failed" | "timeout" | "cancelled"
type FileInfo = { file_name: string; file_size: number; content_type?: string | null }
type Task = {
  id: string
  user_name?: string | null
  task_name: string
  status: TaskStatus
  input_files: FileInfo[]
  result_files: FileInfo[]
  pair_count: number
  image_count: number
  failed_count: number
  semantic_diff_count: number
  review_required_count: number
  ocr_page_count: number
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  updated_at?: string | null
}

const statusLabels: Record<TaskStatus, string> = {
  created: "已创建", queued: "等待执行", preparing: "准备中", running: "生成中", uploading_report: "打包结果", success: "已完成", failed: "失败", timeout: "超时", cancelled: "已取消",
}
const runningStatuses: TaskStatus[] = ["queued", "preparing", "running", "uploading_report"]

function authHeaders() {
  const token = localStorage.getItem("access_token")
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

async function readTasks(scope: "mine" | "all" = "mine"): Promise<{ data: Task[]; count: number }> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/wire-harness-compare-tasks?limit=100&scope=${scope}`, { headers: authHeaders() })
  if (!response.ok) throw new Error("加载线束图对比任务失败")
  return response.json()
}

async function createTask(input: { taskName: string; archive: File }): Promise<Task> {
  const form = new FormData()
  if (input.taskName.trim()) form.append("task_name", input.taskName.trim())
  form.append("archive_upload", input.archive)
  const response = await fetch(`${OpenAPI.BASE}/api/v1/wire-harness-compare-tasks`, { method: "POST", headers: authHeaders(), body: form })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || "提交线束图对比任务失败")
  }
  return response.json()
}

async function deleteTask(taskId: string) {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/wire-harness-compare-tasks/${taskId}`, { method: "DELETE", headers: authHeaders() })
  if (!response.ok) throw new Error("删除线束图对比任务失败")
}

async function downloadResult(task: Task) {
  const version = encodeURIComponent(task.finished_at || task.updated_at || task.id)
  const response = await fetch(`${OpenAPI.BASE}/api/v1/wire-harness-compare-tasks/${task.id}/report?v=${version}`, { headers: authHeaders(), cache: "no-store" })
  if (!response.ok) throw new Error("下载并排对比图失败")
  const link = document.createElement("a")
  link.href = URL.createObjectURL(await response.blob())
  link.download = task.result_files[0]?.file_name || "线束图对比_左右并排图.zip"
  link.click()
  URL.revokeObjectURL(link.href)
}

async function openInteractiveReport(task: Task) {
  const version = encodeURIComponent(task.finished_at || task.updated_at || task.id)
  const response = await fetch(`${OpenAPI.BASE}/api/v1/wire-harness-compare-tasks/${task.id}/interactive-report?v=${version}`, { headers: authHeaders(), cache: "no-store" })
  if (!response.ok) throw new Error("打开交互差异报告失败")
  const url = URL.createObjectURL(await response.blob())
  window.open(url, "_blank", "noopener,noreferrer")
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(task: Task) {
  if (!task.started_at) return "-"
  const start = new Date(task.started_at).getTime()
  const end = new Date(task.finished_at || Date.now()).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-"
  const seconds = Math.floor((end - start) / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`
}

function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant="secondary" className={cn(status === "success" && "border-green-200 bg-green-50 text-green-700", ["failed", "timeout"].includes(status) && "border-red-200 bg-red-50 text-red-700", runningStatuses.includes(status) && "border-blue-200 bg-blue-50 text-blue-700")}>{statusLabels[status]}</Badge>
}

function statusHint(task: Task) {
  if (task.status === "failed") return task.error_message || "任务执行失败，请检查压缩包内容和格式"
  if (task.status === "success") return "对比完成，可查看报告或下载结果"
  if (runningStatuses.includes(task.status)) return "任务正在处理，请稍候"
  return statusLabels[task.status]
}

function CreateForm() {
  const queryClient = useQueryClient()
  const [taskName, setTaskName] = useState("")
  const [archive, setArchive] = useState<File | null>(null)
  const [inputKey, setInputKey] = useState(0)
  const mutation = useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      toast.success("线束图对比任务已提交")
      setTaskName("")
      setArchive(null)
      setInputKey((value) => value + 1)
      await queryClient.invalidateQueries({ queryKey: ["wire-harness-compare-tasks"] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "提交失败"),
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!archive) {
      toast.error("请上传 ZIP 或 RAR 压缩包")
      return
    }
    mutation.mutate({ taskName, archive })
  }
  return <Card className="rounded-lg"><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4" />新建线束图对比</CardTitle><CardDescription>每个文件夹放一套线束图，默认包含两份 PDF；结果包括语义差异报告、红蓝批注和并排对比图。</CardDescription></CardHeader><CardContent><form className="grid gap-4 lg:grid-cols-[260px_1fr_180px]" onSubmit={submit}><div className="grid gap-2"><Label htmlFor="wire-task-name">任务名称</Label><Input id="wire-task-name" value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="可选" /></div><div className="grid gap-2"><Label htmlFor="wire-archive">线束图压缩包</Label><Input key={inputKey} id="wire-archive" type="file" accept=".zip,.rar" onChange={(event) => setArchive(event.target.files?.[0] || null)} required />{archive ? <div className="text-xs text-muted-foreground">{archive.name} · {formatSize(archive.size)}</div> : null}</div><div className="flex items-end"><Button type="submit" disabled={mutation.isPending} className="w-full">{mutation.isPending ? "提交中..." : "开始对比"}</Button></div></form></CardContent></Card>
}

function TasksTable({ scope = "mine" }: { scope?: "mine" | "all" }) {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ["wire-harness-compare-tasks", scope], queryFn: () => readTasks(scope), refetchInterval: (query) => query.state.data?.data.some((task) => runningStatuses.includes(task.status)) ? 5000 : false })
  const deleteMutation = useMutation({ mutationFn: deleteTask, onSuccess: async () => { toast.success("任务已删除"); await queryClient.invalidateQueries({ queryKey: ["wire-harness-compare-tasks"] }) }, onError: (err) => toast.error(err instanceof Error ? err.message : "删除失败") })
  if (isLoading) return <div className="p-8 text-center text-muted-foreground">加载中...</div>
  if (error) return <div className="p-8 text-center text-red-600">{error instanceof Error ? error.message : "加载失败"}</div>
  const tasks = data?.data || []
  return <Table className="table-fixed"><TableHeader><TableRow><TableHead>创建时间</TableHead><TableHead>状态</TableHead><TableHead>任务</TableHead><TableHead>输入文件</TableHead><TableHead>对比结果</TableHead><TableHead className="w-36 text-center">操作</TableHead></TableRow></TableHeader><TableBody>{tasks.length === 0 ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">暂无历史任务</TableCell></TableRow> : tasks.map((task) => <TableRow key={task.id}><TableCell className="text-muted-foreground">{formatReviewTaskDateTime(task.created_at)}</TableCell><TableCell><StatusBadge status={task.status} /><div className={cn("mt-1 text-xs", task.status === "failed" ? "text-red-500" : "text-muted-foreground")}>{statusHint(task)}</div><div className="text-xs text-muted-foreground">耗时 {formatDuration(task)}</div></TableCell><TableCell><div className="truncate font-medium" title={task.task_name}>{task.task_name}</div></TableCell><TableCell><div className="flex items-center gap-2 text-xs text-muted-foreground"><FileArchive className="size-3" />{task.input_files[0]?.file_name || "-"}</div></TableCell><TableCell><div>{task.pair_count} 套 / {task.image_count} 张</div><div className="text-xs text-muted-foreground">差异 {task.semantic_diff_count} 条 · 待确认 {task.review_required_count} 条</div>{task.ocr_page_count ? <div className="text-xs text-muted-foreground">OCR {task.ocr_page_count} 页</div> : null}{task.failed_count ? <div className="text-xs text-red-600">失败 {task.failed_count} 套</div> : null}</TableCell><TableCell className="text-center"><div className="flex justify-center gap-1"><Button variant="ghost" size="icon-sm" title="打开交互差异报告" disabled={!task.result_files.some((file) => file.content_type === "text/html")} aria-label="打开交互差异报告" onClick={() => void openInteractiveReport(task).catch((err) => toast.error(err instanceof Error ? err.message : "打开报告失败"))}><ExternalLink /></Button><Button variant="ghost" size="icon-sm" title="下载结果压缩包" disabled={!task.result_files.length} aria-label="下载结果压缩包" onClick={() => void downloadResult(task).catch((err) => toast.error(err instanceof Error ? err.message : "下载失败"))}><Download /></Button><Button variant="ghost" size="icon-sm" title="删除历史任务" aria-label="删除历史任务" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(task.id)}><Trash2 /></Button></div></TableCell></TableRow>)}</TableBody></Table>
}

export function WireHarnessComparePage() {
  return <div className="flex flex-col gap-6"><div><h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><GitCompareArrows className="size-6" />线束图对比</h1><p className="text-muted-foreground">上传包含多套线束图的 ZIP 或 RAR 压缩包，批量识别文字并生成左右联动差异报告。</p></div><CreateForm /><Card className="rounded-lg"><CardHeader><CardTitle>我的历史任务</CardTitle><CardDescription>只显示当前账号创建的线束图对比任务。</CardDescription></CardHeader><CardContent><div className="overflow-x-auto rounded-md border"><TasksTable /></div></CardContent></Card></div>
}

export function WireHarnessCompareManagementPage() {
  return <div className="flex flex-col gap-6"><div><h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><GitCompareArrows className="size-6" />线束图对比任务管理</h1><p className="text-muted-foreground">查看所有账号的历史任务状态、失败原因和已生成的对比结果。</p></div><Card className="rounded-lg"><CardHeader><CardTitle>全部历史任务</CardTitle><CardDescription>按创建时间倒序显示，包含个人页之外的其他账号任务。</CardDescription></CardHeader><CardContent><div className="overflow-x-auto rounded-md border"><TasksTable scope="all" /></div></CardContent></Card></div>
}
