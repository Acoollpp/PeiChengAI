import { useQuery } from "@tanstack/react-query"
import { Eye, FileSpreadsheet, Loader2, Search, X } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"

import {
  type CustomReviewInputPublic,
  type CustomReviewMode,
  OpenAPI,
  type ReviewTaskStatus,
  ReviewTasksService,
} from "@/client"
import {
  formatReviewTaskDateTime,
  ReviewTaskStatusBadge,
  reviewTaskStatusLabel,
} from "@/components/Tasks/task-display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import { hasPlatformAdminPrivileges } from "@/lib/authz"

type MaterialFilter = "all" | "provided" | "not_provided"

type CustomReviewInputFilters = {
  keyword: string
  createdFrom: string
  createdTo: string
  userName: string
  departmentName: string
  svnUrl: string
  revision: string
  mode: CustomReviewMode | "all"
  wordMaterial: MaterialFilter
  excelMaterial: MaterialFilter
  pdfMaterial: MaterialFilter
  status: ReviewTaskStatus | "all"
}

const emptyFilters: CustomReviewInputFilters = {
  keyword: "",
  createdFrom: "",
  createdTo: "",
  userName: "",
  departmentName: "",
  svnUrl: "",
  revision: "",
  mode: "all",
  wordMaterial: "all",
  excelMaterial: "all",
  pdfMaterial: "all",
  status: "all",
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

const materialOptions = [
  { value: "all", label: "全部" },
  { value: "provided", label: "已提供" },
  { value: "not_provided", label: "未提供" },
] as const

function materialLabel(value: boolean | null | undefined) {
  return value === true ? "已提供" : "未提供"
}

function modeLabel(value: CustomReviewMode | null | undefined) {
  if (value === "dual_revision") return "变更代码审查"
  if (value === "new_revision_full") return "全量代码审查"
  return "-"
}

function buildCustomReviewInputSearchParams(filters: CustomReviewInputFilters) {
  const params = new URLSearchParams()
  const textFilters: Array<[string, string]> = [
    ["keyword", filters.keyword],
    ["created_from", filters.createdFrom],
    ["created_to", filters.createdTo],
    ["user_name", filters.userName],
    ["department_name", filters.departmentName],
    ["svn_url", filters.svnUrl],
    ["revision", filters.revision],
  ]
  for (const [key, value] of textFilters) {
    const normalizedValue = value.trim()
    if (normalizedValue) params.set(key, normalizedValue)
  }
  if (filters.mode !== "all") params.set("mode", filters.mode)
  if (filters.status !== "all") params.set("status", filters.status)
  const materialFilters: Array<[string, MaterialFilter]> = [
    ["has_word_material", filters.wordMaterial],
    ["has_excel_material", filters.excelMaterial],
    ["has_pdf_material", filters.pdfMaterial],
  ]
  for (const [key, value] of materialFilters) {
    if (value !== "all") params.set(key, String(value === "provided"))
  }
  return params
}

async function readCustomReviewInputs(filters: CustomReviewInputFilters) {
  const materialFilterValue = (value: MaterialFilter) =>
    value === "all" ? undefined : value === "provided"
  return ReviewTasksService.readCustomReviewInputs({
    limit: 200,
    keyword: filters.keyword.trim() || undefined,
    createdFrom: filters.createdFrom || undefined,
    createdTo: filters.createdTo || undefined,
    userName: filters.userName.trim() || undefined,
    departmentName: filters.departmentName.trim() || undefined,
    svnUrl: filters.svnUrl.trim() || undefined,
    revision: filters.revision.trim() || undefined,
    mode: filters.mode === "all" ? undefined : filters.mode,
    hasWordMaterial: materialFilterValue(filters.wordMaterial),
    hasExcelMaterial: materialFilterValue(filters.excelMaterial),
    hasPdfMaterial: materialFilterValue(filters.pdfMaterial),
    status: filters.status === "all" ? undefined : filters.status,
  })
}

async function readCustomReviewInput(taskId: string) {
  return ReviewTasksService.readCustomReviewInput({ taskId })
}

function exportFileName(contentDisposition: string | null) {
  const encodedFileName = contentDisposition?.match(
    /filename\*=UTF-8''([^;]+)/i,
  )?.[1]
  if (encodedFileName) {
    try {
      return decodeURIComponent(encodedFileName)
    } catch {
      // 服务端文件名异常时使用稳定的本地兜底名称。
    }
  }
  return `自定义审查输入统计_${new Date().toISOString().slice(0, 10)}.xlsx`
}

async function exportCustomReviewInputs(filters: CustomReviewInputFilters) {
  const params = buildCustomReviewInputSearchParams(filters)
  const token = localStorage.getItem("access_token")
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks/custom-review-inputs/export?${params.toString()}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )
  if (!response.ok) throw new Error("Failed to export custom review inputs")
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = exportFileName(response.headers.get("content-disposition"))
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

function MaterialBadge({
  label,
  value,
}: {
  label: string
  value: boolean | null | undefined
}) {
  return (
    <Badge variant={value ? "default" : "secondary"}>
      {label}：{materialLabel(value)}
    </Badge>
  )
}

function CustomReviewInputDetailDialog({
  taskId,
  open,
  onOpenChange,
}: {
  taskId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const detailQuery = useQuery({
    queryKey: ["custom-review-input", taskId],
    queryFn: () => readCustomReviewInput(taskId as string),
    enabled: open && taskId !== null,
  })
  const input: CustomReviewInputPublic | undefined = detailQuery.data

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>自定义审查输入详情</DialogTitle>
          <DialogDescription>
            仅记录提交时的规则、模式和材料类型状态。
          </DialogDescription>
        </DialogHeader>
        {detailQuery.isLoading ? (
          <div className="text-muted-foreground">加载中...</div>
        ) : null}
        {detailQuery.isError ? (
          <div className="text-destructive">详情加载失败，请稍后重试。</div>
        ) : null}
        {input ? (
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">提交时间</p>
              <p>{formatReviewTaskDateTime(input.created_at)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">任务状态</p>
              <ReviewTaskStatusBadge status={input.status} />
            </div>
            <div>
              <p className="text-muted-foreground">用户</p>
              <p>{input.user_name || input.svn_username || "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">部门</p>
              <p>{input.department_name || "-"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">SVN 地址</p>
              <p className="break-all">{input.svn_url}</p>
            </div>
            <div>
              <p className="text-muted-foreground">版本</p>
              <p>
                {input.old_revision} → {input.new_revision}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">审查模式</p>
              <p>{modeLabel(input.custom_review_mode)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Word 材料</p>
              <p>{materialLabel(input.has_custom_review_word_material)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Excel 材料</p>
              <p>{materialLabel(input.has_custom_review_excel_material)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">PDF 材料</p>
              <p>{materialLabel(input.has_custom_review_pdf_material)}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">自定义审查规则</p>
              <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3">
                {input.custom_review_rule}
              </p>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function CustomReviewInputsPage() {
  const { user } = useAuth()
  const [draftFilters, setDraftFilters] = useState(emptyFilters)
  const [filters, setFilters] = useState(emptyFilters)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const inputsQuery = useQuery({
    queryKey: ["custom-review-inputs", filters],
    queryFn: () => readCustomReviewInputs(filters),
    retry: false,
  })
  const canFilterDepartment = hasPlatformAdminPrivileges(user)

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFilters({ ...draftFilters })
  }
  const handleReset = () => {
    setDraftFilters({ ...emptyFilters })
    setFilters({ ...emptyFilters })
  }
  const handleExport = async () => {
    setIsExporting(true)
    try {
      await exportCustomReviewInputs(filters)
    } catch {
      toast.error("自定义审查输入 Excel 导出失败，请稍后重试")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="custom-review-inputs-page"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            自定义审查输入统计
          </h1>
          <p className="text-muted-foreground">
            查看 DS-99 提交时保存的规则、模式和材料类型状态。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isExporting}
          onClick={() => void handleExport()}
        >
          {isExporting ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <FileSpreadsheet aria-hidden="true" />
          )}
          导出 Excel
        </Button>
      </div>
      <form
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        onSubmit={handleSearch}
      >
        <Input
          aria-label="规则关键词"
          placeholder="规则关键词"
          value={draftFilters.keyword}
          onChange={(event) =>
            setDraftFilters((current) => ({
              ...current,
              keyword: event.target.value,
            }))
          }
        />
        <Input
          aria-label="用户"
          placeholder="用户或 SVN 账号"
          value={draftFilters.userName}
          onChange={(event) =>
            setDraftFilters((current) => ({
              ...current,
              userName: event.target.value,
            }))
          }
        />
        {canFilterDepartment ? (
          <Input
            aria-label="部门"
            placeholder="部门"
            value={draftFilters.departmentName}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                departmentName: event.target.value,
              }))
            }
          />
        ) : (
          <div />
        )}
        <Input
          aria-label="SVN 地址"
          placeholder="SVN 地址"
          value={draftFilters.svnUrl}
          onChange={(event) =>
            setDraftFilters((current) => ({
              ...current,
              svnUrl: event.target.value,
            }))
          }
        />
        <Input
          aria-label="版本号"
          placeholder="旧或新 revision"
          value={draftFilters.revision}
          onChange={(event) =>
            setDraftFilters((current) => ({
              ...current,
              revision: event.target.value,
            }))
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label="开始日期"
            type="date"
            value={draftFilters.createdFrom}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                createdFrom: event.target.value,
              }))
            }
          />
          <Input
            aria-label="结束日期"
            type="date"
            value={draftFilters.createdTo}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                createdTo: event.target.value,
              }))
            }
          />
        </div>
        <Select
          value={draftFilters.mode}
          onValueChange={(value) =>
            setDraftFilters((current) => ({
              ...current,
              mode: value as CustomReviewInputFilters["mode"],
            }))
          }
        >
          <SelectTrigger aria-label="审查模式">
            <SelectValue placeholder="全部模式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部模式</SelectItem>
            <SelectItem value="dual_revision">变更代码审查</SelectItem>
            <SelectItem value="new_revision_full">全量代码审查</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={draftFilters.status}
          onValueChange={(value) =>
            setDraftFilters((current) => ({
              ...current,
              status: value as CustomReviewInputFilters["status"],
            }))
          }
        >
          <SelectTrigger aria-label="任务状态">
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
        {(["wordMaterial", "excelMaterial", "pdfMaterial"] as const).map(
          (key) => (
            <Select
              key={key}
              value={draftFilters[key]}
              onValueChange={(value) =>
                setDraftFilters((current) => ({
                  ...current,
                  [key]: value as MaterialFilter,
                }))
              }
            >
              <SelectTrigger
                aria-label={
                  {
                    wordMaterial: "Word 材料",
                    excelMaterial: "Excel 材料",
                    pdfMaterial: "PDF 材料",
                  }[key]
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {materialOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {
                      {
                        wordMaterial: "Word",
                        excelMaterial: "Excel",
                        pdfMaterial: "PDF",
                      }[key]
                    }
                    ：{option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ),
        )}
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
      {inputsQuery.isLoading ? (
        <div className="text-muted-foreground">加载中...</div>
      ) : null}
      {inputsQuery.isError ? (
        <div
          className="rounded-md border border-destructive/40 p-4 text-destructive"
          role="alert"
        >
          自定义审查输入加载失败，请稍后重试。
        </div>
      ) : null}
      {inputsQuery.data ? (
        inputsQuery.data.data.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
            没有符合当前筛选条件的自定义审查输入。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>提交时间</TableHead>
                  <TableHead>用户 / 部门</TableHead>
                  <TableHead>SVN / 版本</TableHead>
                  <TableHead>模式</TableHead>
                  <TableHead>材料</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>规则摘要</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inputsQuery.data.data.map((input) => (
                  <TableRow key={input.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatReviewTaskDateTime(input.created_at)}
                    </TableCell>
                    <TableCell>
                      <div>{input.user_name || input.svn_username || "-"}</div>
                      <div className="text-xs text-muted-foreground">
                        {input.department_name || "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-72 truncate" title={input.svn_url}>
                        {input.svn_url}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {input.old_revision} → {input.new_revision}
                      </div>
                    </TableCell>
                    <TableCell>{modeLabel(input.custom_review_mode)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <MaterialBadge
                          label="Word"
                          value={input.has_custom_review_word_material}
                        />
                        <MaterialBadge
                          label="Excel"
                          value={input.has_custom_review_excel_material}
                        />
                        <MaterialBadge
                          label="PDF"
                          value={input.has_custom_review_pdf_material}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <ReviewTaskStatusBadge status={input.status} />
                    </TableCell>
                    <TableCell>
                      <div
                        className="max-w-xs truncate"
                        title={input.custom_review_rule}
                      >
                        {input.custom_review_rule}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="查看自定义审查输入详情"
                        onClick={() => setSelectedTaskId(input.id)}
                      >
                        <Eye />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}
      {inputsQuery.data ? (
        <p className="text-sm text-muted-foreground">
          共 {inputsQuery.data.count} 条记录
        </p>
      ) : null}
      <CustomReviewInputDetailDialog
        taskId={selectedTaskId}
        open={selectedTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null)
        }}
      />
    </div>
  )
}
