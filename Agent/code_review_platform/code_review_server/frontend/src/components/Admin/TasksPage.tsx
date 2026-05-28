import { useSuspenseQuery } from "@tanstack/react-query"
import { Download, ExternalLink } from "lucide-react"
import { Suspense } from "react"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type ReviewTask = {
  id: string
  svn_url: string
  old_revision: string
  new_revision: string
  status: string
  report_path?: string | null
  client_hostname?: string | null
  client_version?: string | null
}

type ReviewTasksResponse = {
  data: ReviewTask[]
  count: number
}

async function readReviewTasks(): Promise<ReviewTasksResponse> {
  const token = localStorage.getItem("access_token")
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks?limit=100`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )

  if (!response.ok) {
    throw new Error("Failed to load review tasks")
  }

  return response.json()
}

function getReviewTasksQueryOptions() {
  return {
    queryFn: readReviewTasks,
    queryKey: ["review-tasks", "admin"],
  }
}

function reportUrl(task: ReviewTask, action: "report" | "download") {
  return `${OpenAPI.BASE}/api/v1/review-tasks/${task.id}/${action}`
}

async function fetchReport(task: ReviewTask, action: "report" | "download") {
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

function ReviewTasksTable() {
  const { data: tasks } = useSuspenseQuery(getReviewTasksQueryOptions())

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>SVN地址</TableHead>
          <TableHead>版本</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>客户端</TableHead>
          <TableHead>报告</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.data.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={5}
              className="h-32 text-center text-muted-foreground"
            >
              暂无审查任务
            </TableCell>
          </TableRow>
        ) : (
          tasks.data.map((task) => (
            <TableRow key={task.id}>
              <TableCell className="max-w-sm truncate font-medium">
                {task.svn_url}
              </TableCell>
              <TableCell>
                {task.old_revision} → {task.new_revision}
              </TableCell>
              <TableCell>{task.status}</TableCell>
              <TableCell className="text-muted-foreground">
                {[task.client_hostname, task.client_version]
                  .filter(Boolean)
                  .join(" / ") || "-"}
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
                  </div>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function ReviewTasksSection() {
  return (
    <Suspense fallback={<div className="text-muted-foreground">加载中...</div>}>
      <ReviewTasksTable />
    </Suspense>
  )
}

export function AdminTasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">任务管理</h1>
        <p className="text-muted-foreground">查看审查任务状态和报告。</p>
      </div>
      <ReviewTasksSection />
    </div>
  )
}
