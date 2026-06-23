import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, Edit, Plus, Search, Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useMemo, useState } from "react"

import {
  OpenAPI,
  type ReviewFocusDirectionCreate,
  type ReviewFocusDirectionPublic,
  ReviewFocusDirectionsService,
  type ReviewFocusDirectionUpdate,
  type ReviewFocusDirectionUsageStatPublic,
} from "@/client"
import { DepartmentMultiSelect } from "@/components/Departments/DepartmentMultiSelect"
import { DepartmentSelect } from "@/components/Departments/DepartmentSelect"
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  hasDepartmentAdminPrivileges,
  hasPlatformAdminPrivileges,
} from "@/lib/authz"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

type DirectionFormMode = "create" | "edit" | "usage"
type DepartmentScope = "all" | "global" | "department"
type ActiveFilter = "all" | "active" | "inactive"
type UsedFilter = "all" | "used" | "unused"

type DirectionFormState = {
  title: string
  content: string
  department_ids: string[]
  is_active: boolean
}

const emptyForm: DirectionFormState = {
  title: "",
  content: "",
  department_ids: [],
  is_active: true,
}

function buildUsageExportUrl({
  search,
  departmentScope,
  departmentId,
  isUsed,
}: {
  search: string
  departmentScope: DepartmentScope
  departmentId: string | null
  isUsed: UsedFilter
}) {
  const params = new URLSearchParams()
  const normalizedSearch = search.trim()

  if (normalizedSearch) {
    params.set("search", normalizedSearch)
  }

  const effectiveDepartmentScope =
    departmentScope === "department" && !departmentId ? "all" : departmentScope

  params.set("department_scope", effectiveDepartmentScope)

  if (effectiveDepartmentScope === "department" && departmentId) {
    params.set("department_id", departmentId)
  }

  if (isUsed !== "all") {
    params.set("is_used", String(isUsed === "used"))
  }

  const query = params.toString()
  return `${OpenAPI.BASE}/api/v1/review-focus-directions/usage-stats/export${
    query ? `?${query}` : ""
  }`
}

function createTitleFromUsage(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim()
  return normalized.length > 24
    ? `统计沉淀：${normalized.slice(0, 24)}`
    : `统计沉淀：${normalized}`
}

function DirectionFormDialog({
  open,
  mode,
  initialValue,
  isPending,
  canSelectDepartments,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  mode: DirectionFormMode
  initialValue: DirectionFormState
  isPending: boolean
  canSelectDepartments: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (value: DirectionFormState) => void
}) {
  const [form, setForm] = useState<DirectionFormState>(initialValue)

  useEffect(() => {
    setForm(initialValue)
  }, [initialValue])

  const title = mode === "edit" ? "编辑方向" : "新增方向"
  const description =
    mode === "usage"
      ? "将用户输入统计沉淀为可复用的重点审查方向。"
      : "维护方向库条目，可绑定部门；不绑定部门时作为全局方向。"

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit({
      ...form,
      title: form.title.trim(),
      content: form.content.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="focus-direction-title">
                标题 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="focus-direction-title"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="例如：异常处理与边界条件"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="focus-direction-content">
                内容 <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="focus-direction-content"
                className={cn(
                  "border-input bg-transparent shadow-xs placeholder:text-muted-foreground",
                  "focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]",
                )}
                value={form.content}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
                placeholder="描述代码审查时需要重点关注的方向"
                required
              />
            </div>

            {canSelectDepartments && (
              <div className="grid gap-2">
                <Label id="focus-direction-department-label">部门</Label>
                <DepartmentMultiSelect
                  id="focus-direction-department"
                  aria-labelledby="focus-direction-department-label focus-direction-department"
                  value={form.department_ids}
                  onChange={(departmentIds) =>
                    setForm((current) => ({
                      ...current,
                      department_ids: departmentIds,
                    }))
                  }
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                取消
              </Button>
            </DialogClose>
            <LoadingButton type="submit" loading={isPending}>
              保存
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DirectionRows({
  directions,
  canManageDirection,
  onEdit,
  onDelete,
  onToggle,
}: {
  directions: ReviewFocusDirectionPublic[]
  canManageDirection: (direction: ReviewFocusDirectionPublic) => boolean
  onEdit: (direction: ReviewFocusDirectionPublic) => void
  onDelete: (direction: ReviewFocusDirectionPublic) => void
  onToggle: (direction: ReviewFocusDirectionPublic) => void
}) {
  if (directions.length === 0) {
    return (
      <TableRow>
        <TableCell
          colSpan={6}
          className="h-28 text-center text-muted-foreground"
        >
          暂无重点审查方向。
        </TableCell>
      </TableRow>
    )
  }

  return directions.map((direction) => {
    const departmentNames =
      direction.departments?.map((department) => department.name) ?? []
    const departmentText = departmentNames.length
      ? departmentNames.join("、")
      : "全局"
    const canManageCurrentDirection = canManageDirection(direction)

    return (
      <TableRow key={direction.id}>
        <TableCell className="font-medium">{direction.title}</TableCell>
        <TableCell className="max-w-md text-muted-foreground">
          <span className="line-clamp-2">{direction.content}</span>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {departmentText}
        </TableCell>
        <TableCell>
          <Badge variant={direction.is_active ? "secondary" : "outline"}>
            {direction.is_active ? "启用" : "停用"}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {direction.usage_count}
        </TableCell>
        <TableCell>
          {canManageCurrentDirection && (
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onEdit(direction)}
              >
                <Edit />
                编辑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onToggle(direction)}
              >
                {direction.is_active ? "停用" : "启用"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => onDelete(direction)}
              >
                <Trash2 />
                删除
              </Button>
            </div>
          )}
        </TableCell>
      </TableRow>
    )
  })
}

function UsageStatRows({
  stats,
  onSettle,
  onToggleUsed,
}: {
  stats: ReviewFocusDirectionUsageStatPublic[]
  onSettle: (stat: ReviewFocusDirectionUsageStatPublic) => void
  onToggleUsed: (stat: ReviewFocusDirectionUsageStatPublic) => void
}) {
  if (stats.length === 0) {
    return (
      <TableRow>
        <TableCell
          colSpan={5}
          className="h-28 text-center text-muted-foreground"
        >
          暂无用户输入统计。
        </TableCell>
      </TableRow>
    )
  }

  return stats.map((stat) => (
    <TableRow key={stat.content}>
      <TableCell className="max-w-xl text-muted-foreground">
        <span className="line-clamp-2">{stat.content}</span>
      </TableCell>
      <TableCell>{stat.usage_count}</TableCell>
      <TableCell className="text-muted-foreground">
        {stat.departments?.length ? stat.departments.join("、") : "全局"}
      </TableCell>
      <TableCell>
        <Badge variant={stat.is_used ? "secondary" : "outline"}>
          {stat.is_used ? "已使用" : "未使用"}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onToggleUsed(stat)}
          >
            {stat.is_used ? "标记未使用" : "标记已使用"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onSettle(stat)}
          >
            沉淀
          </Button>
        </div>
      </TableCell>
    </TableRow>
  ))
}

export function ReviewFocusDirectionsPage() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { user: currentUser } = useAuth()
  const isPlatformAdmin = hasPlatformAdminPrivileges(currentUser)
  const isDepartmentAdmin = hasDepartmentAdminPrivileges(currentUser)
  const currentDepartmentId = currentUser?.department_id ?? null
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<DirectionFormMode>("create")
  const [editingDirection, setEditingDirection] =
    useState<ReviewFocusDirectionPublic | null>(null)
  const [formInitialValue, setFormInitialValue] =
    useState<DirectionFormState>(emptyForm)
  const [deletingDirection, setDeletingDirection] =
    useState<ReviewFocusDirectionPublic | null>(null)
  const [activeTab, setActiveTab] = useState("directions")
  const [directionSearch, setDirectionSearch] = useState("")
  const [directionDepartmentScope, setDirectionDepartmentScope] =
    useState<DepartmentScope>("all")
  const [directionDepartmentId, setDirectionDepartmentId] = useState<
    string | null
  >(null)
  const [directionActiveFilter, setDirectionActiveFilter] =
    useState<ActiveFilter>("all")
  const [usageSearch, setUsageSearch] = useState("")
  const [usageDepartmentScope, setUsageDepartmentScope] =
    useState<DepartmentScope>("all")
  const [usageDepartmentId, setUsageDepartmentId] = useState<string | null>(
    null,
  )
  const [usageUsedFilter, setUsageUsedFilter] = useState<UsedFilter>("all")
  const normalizedDirectionSearch = directionSearch.trim()
  const normalizedUsageSearch = usageSearch.trim()
  const effectiveDirectionDepartmentScope =
    isDepartmentAdmin || directionDepartmentScope === "department"
      ? "department"
      : directionDepartmentScope
  const effectiveDirectionDepartmentId = isDepartmentAdmin
    ? currentDepartmentId
    : directionDepartmentId
  const requestDirectionDepartmentScope =
    effectiveDirectionDepartmentScope === "department" &&
    !effectiveDirectionDepartmentId
      ? "all"
      : effectiveDirectionDepartmentScope
  const effectiveUsageDepartmentScope =
    usageDepartmentScope === "department" && !usageDepartmentId
      ? "all"
      : usageDepartmentScope
  const canExportUsageStats =
    isPlatformAdmin &&
    (usageDepartmentScope !== "department" || Boolean(usageDepartmentId))

  useEffect(() => {
    if (isDepartmentAdmin && activeTab === "usage-stats") {
      setActiveTab("directions")
    }
  }, [activeTab, isDepartmentAdmin])

  const directionsQuery = useQuery({
    queryFn: () =>
      ReviewFocusDirectionsService.readReviewFocusDirections({
        search: normalizedDirectionSearch || undefined,
        departmentScope: requestDirectionDepartmentScope,
        departmentId:
          requestDirectionDepartmentScope === "department"
            ? effectiveDirectionDepartmentId
            : undefined,
        isActive:
          directionActiveFilter === "all"
            ? undefined
            : directionActiveFilter === "active",
      }),
    queryKey: [
      "review-focus-directions",
      "directions",
      normalizedDirectionSearch,
      requestDirectionDepartmentScope,
      effectiveDirectionDepartmentId,
      directionActiveFilter,
    ],
    enabled: !isDepartmentAdmin || Boolean(currentDepartmentId),
  })
  const usageStatsQuery = useQuery({
    queryFn: () =>
      ReviewFocusDirectionsService.readUsageStats({
        search: normalizedUsageSearch || undefined,
        departmentScope: effectiveUsageDepartmentScope,
        departmentId:
          effectiveUsageDepartmentScope === "department"
            ? usageDepartmentId
            : undefined,
        isUsed:
          usageUsedFilter === "all" ? undefined : usageUsedFilter === "used",
      }),
    queryKey: [
      "review-focus-directions",
      "usage-stats",
      normalizedUsageSearch,
      effectiveUsageDepartmentScope,
      usageDepartmentId,
      usageUsedFilter,
    ],
    enabled: isPlatformAdmin,
  })

  const directions = directionsQuery.data?.data ?? []
  const usageStats = usageStatsQuery.data?.data ?? []

  const invalidateDirections = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["review-focus-directions"] }),
      queryClient.invalidateQueries({
        queryKey: ["review-focus-directions", "usage-stats"],
      }),
    ])
  }

  const createMutation = useMutation({
    mutationFn: (data: ReviewFocusDirectionCreate) =>
      dialogMode === "usage"
        ? ReviewFocusDirectionsService.createReviewFocusDirectionFromUsage({
            requestBody: data,
          })
        : ReviewFocusDirectionsService.createReviewFocusDirection({
            requestBody: data,
          }),
    onSuccess: async () => {
      showSuccessToast("方向创建成功")
      setDialogOpen(false)
      setEditingDirection(null)
      await invalidateDirections()
    },
    onError: handleError.bind(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: ({
      directionId,
      requestBody,
    }: {
      directionId: string
      requestBody: ReviewFocusDirectionUpdate
    }) =>
      ReviewFocusDirectionsService.updateReviewFocusDirection({
        directionId,
        requestBody,
      }),
    onSuccess: async () => {
      showSuccessToast("方向更新成功")
      setDialogOpen(false)
      setEditingDirection(null)
      await invalidateDirections()
    },
    onError: handleError.bind(showErrorToast),
  })

  const toggleMutation = useMutation({
    mutationFn: (direction: ReviewFocusDirectionPublic) => {
      if (!canManageDirection(direction)) {
        throw new Error("无权维护该方向")
      }

      return ReviewFocusDirectionsService.updateReviewFocusDirection({
        directionId: direction.id,
        requestBody: { is_active: !direction.is_active },
      })
    },
    onSuccess: async (updated) => {
      showSuccessToast(updated.is_active ? "方向已启用" : "方向已停用")
      await invalidateDirections()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (direction: ReviewFocusDirectionPublic) => {
      if (!canManageDirection(direction)) {
        throw new Error("无权维护该方向")
      }

      return ReviewFocusDirectionsService.deleteReviewFocusDirection({
        directionId: direction.id,
      })
    },
    onSuccess: async () => {
      showSuccessToast("方向删除成功")
      setDeletingDirection(null)
      await invalidateDirections()
    },
    onError: handleError.bind(showErrorToast),
  })

  const updateUsageStateMutation = useMutation({
    mutationFn: (stat: ReviewFocusDirectionUsageStatPublic) =>
      ReviewFocusDirectionsService.updateUsageState({
        requestBody: {
          content: stat.content,
          is_used: !stat.is_used,
        },
      }),
    onSuccess: async () => {
      showSuccessToast("使用状态更新成功")
      await queryClient.invalidateQueries({
        queryKey: ["review-focus-directions", "usage-stats"],
      })
    },
    onError: handleError.bind(showErrorToast),
  })

  const isSaving = createMutation.isPending || updateMutation.isPending
  const dialogInitialValue = useMemo(() => formInitialValue, [formInitialValue])
  const canManageDirection = (direction: ReviewFocusDirectionPublic) =>
    isPlatformAdmin ||
    (isDepartmentAdmin &&
      Boolean(currentDepartmentId) &&
      direction.departments?.length === 1 &&
      direction.departments[0]?.id === currentDepartmentId)

  const openCreateDialog = () => {
    setDialogMode("create")
    setEditingDirection(null)
    setFormInitialValue({
      ...emptyForm,
      department_ids:
        isDepartmentAdmin && currentDepartmentId ? [currentDepartmentId] : [],
    })
    setDialogOpen(true)
  }

  const openEditDialog = (direction: ReviewFocusDirectionPublic) => {
    if (!canManageDirection(direction)) {
      showErrorToast("无权维护该方向")
      return
    }

    setDialogMode("edit")
    setEditingDirection(direction)
    setFormInitialValue({
      title: direction.title,
      content: direction.content,
      department_ids:
        direction.departments?.map((department) => department.id) ?? [],
      is_active: direction.is_active,
    })
    setDialogOpen(true)
  }

  const openUsageDialog = (stat: ReviewFocusDirectionUsageStatPublic) => {
    if (!isPlatformAdmin) {
      return
    }

    setDialogMode("usage")
    setEditingDirection(null)
    setFormInitialValue({
      title: createTitleFromUsage(stat.content),
      content: stat.content,
      department_ids: [],
      is_active: true,
    })
    setDialogOpen(true)
  }

  const resetDirectionFilters = () => {
    setDirectionSearch("")
    setDirectionDepartmentScope("all")
    setDirectionDepartmentId(null)
    setDirectionActiveFilter("all")
  }

  const resetUsageFilters = () => {
    setUsageSearch("")
    setUsageDepartmentScope("all")
    setUsageDepartmentId(null)
    setUsageUsedFilter("all")
  }

  const exportUsageStats = async () => {
    if (!isPlatformAdmin) {
      return
    }

    try {
      const token = localStorage.getItem("access_token")
      const response = await fetch(
        buildUsageExportUrl({
          search: usageSearch,
          departmentScope: usageDepartmentScope,
          departmentId: usageDepartmentId,
          isUsed: usageUsedFilter,
        }),
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      )

      if (!response.ok) {
        throw new Error("导出失败")
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `重点审查方向用户输入统计_${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .slice(0, 13)}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      showErrorToast("导出失败，请稍后重试。")
    }
  }

  const handleSubmit = (value: DirectionFormState) => {
    if (!value.title || !value.content) {
      showErrorToast("请填写标题和内容")
      return
    }

    if (isDepartmentAdmin && !currentDepartmentId) {
      showErrorToast("当前账号未绑定部门，请联系超级管理员。")
      return
    }

    const payload: ReviewFocusDirectionCreate = {
      title: value.title,
      content: value.content,
      department_ids:
        isDepartmentAdmin && currentDepartmentId
          ? [currentDepartmentId]
          : value.department_ids,
      is_active: value.is_active,
    }

    if (dialogMode === "edit" && editingDirection) {
      if (!canManageDirection(editingDirection)) {
        showErrorToast("无权维护该方向")
        return
      }

      updateMutation.mutate({
        directionId: editingDirection.id,
        requestBody: payload,
      })
      return
    }

    createMutation.mutate(payload)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">重点审查方向</h1>
        <p className="text-muted-foreground">
          管理方向库条目，并将用户常用输入沉淀为可复用方向。
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="directions">方向库</TabsTrigger>
          {isPlatformAdmin && (
            <TabsTrigger value="usage-stats">用户输入统计</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="directions">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>方向库</CardTitle>
                {isPlatformAdmin && (
                  <CardDescription>
                    部门为空时表示全局方向，所有用户都可使用。
                  </CardDescription>
                )}
              </div>
              <Button type="button" onClick={openCreateDialog}>
                <Plus />
                新增方向
              </Button>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "mb-4 grid gap-3",
                  isPlatformAdmin
                    ? "lg:grid-cols-[minmax(0,1fr)_160px_180px_140px_auto]"
                    : "lg:grid-cols-[minmax(0,1fr)_140px_auto]",
                )}
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="方向库关键词"
                    className="pl-9"
                    placeholder="搜索标题或内容"
                    value={directionSearch}
                    onChange={(event) => setDirectionSearch(event.target.value)}
                  />
                </div>
                {isPlatformAdmin && (
                  <>
                    <Select
                      value={directionDepartmentScope}
                      onValueChange={(value) => {
                        const nextValue = value as DepartmentScope
                        setDirectionDepartmentScope(nextValue)
                        if (nextValue !== "department") {
                          setDirectionDepartmentId(null)
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-label="方向库部门范围"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部部门范围</SelectItem>
                        <SelectItem value="global">全局</SelectItem>
                        <SelectItem value="department">指定部门</SelectItem>
                      </SelectContent>
                    </Select>
                    <DepartmentSelect
                      value={directionDepartmentId}
                      onChange={setDirectionDepartmentId}
                      disabled={directionDepartmentScope !== "department"}
                    />
                  </>
                )}
                <Select
                  value={directionActiveFilter}
                  onValueChange={(value) =>
                    setDirectionActiveFilter(value as ActiveFilter)
                  }
                >
                  <SelectTrigger aria-label="方向库状态" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="active">启用</SelectItem>
                    <SelectItem value="inactive">停用</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetDirectionFilters}
                >
                  重置
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>标题</TableHead>
                    <TableHead>内容</TableHead>
                    <TableHead>部门</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>使用次数</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isDepartmentAdmin && !currentDepartmentId ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-28 text-center text-muted-foreground"
                      >
                        当前账号未绑定部门，请联系超级管理员。
                      </TableCell>
                    </TableRow>
                  ) : directionsQuery.isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-28 text-center text-muted-foreground"
                      >
                        正在加载方向库...
                      </TableCell>
                    </TableRow>
                  ) : (
                    <DirectionRows
                      directions={directions}
                      canManageDirection={canManageDirection}
                      onEdit={openEditDialog}
                      onDelete={setDeletingDirection}
                      onToggle={(direction) => toggleMutation.mutate(direction)}
                    />
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {isPlatformAdmin && (
          <TabsContent value="usage-stats">
            <Card data-testid="review-focus-usage-stats">
              <CardHeader>
                <CardTitle>用户输入统计</CardTitle>
                <CardDescription>
                  根据用户提交任务时输入的重点方向聚合统计。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_180px_140px_auto_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      aria-label="用户输入统计关键词"
                      className="pl-9"
                      placeholder="搜索用户输入内容"
                      value={usageSearch}
                      onChange={(event) => setUsageSearch(event.target.value)}
                    />
                  </div>
                  <Select
                    value={usageDepartmentScope}
                    onValueChange={(value) => {
                      const nextValue = value as DepartmentScope
                      setUsageDepartmentScope(nextValue)
                      if (nextValue !== "department") {
                        setUsageDepartmentId(null)
                      }
                    }}
                  >
                    <SelectTrigger
                      aria-label="用户输入统计部门范围"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部部门范围</SelectItem>
                      <SelectItem value="global">全局</SelectItem>
                      <SelectItem value="department">指定部门</SelectItem>
                    </SelectContent>
                  </Select>
                  <DepartmentSelect
                    value={usageDepartmentId}
                    onChange={setUsageDepartmentId}
                    disabled={usageDepartmentScope !== "department"}
                  />
                  <Select
                    value={usageUsedFilter}
                    onValueChange={(value) =>
                      setUsageUsedFilter(value as UsedFilter)
                    }
                  >
                    <SelectTrigger
                      aria-label="用户输入统计使用状态"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部使用状态</SelectItem>
                      <SelectItem value="used">已使用</SelectItem>
                      <SelectItem value="unused">未使用</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetUsageFilters}
                  >
                    重置
                  </Button>
                  <Button
                    type="button"
                    disabled={!canExportUsageStats}
                    onClick={() => void exportUsageStats()}
                  >
                    <Download />
                    导出 Excel
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>内容</TableHead>
                      <TableHead>使用次数</TableHead>
                      <TableHead>涉及部门</TableHead>
                      <TableHead>使用状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usageStatsQuery.isLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="h-28 text-center text-muted-foreground"
                        >
                          正在加载用户输入统计...
                        </TableCell>
                      </TableRow>
                    ) : (
                      <UsageStatRows
                        stats={usageStats}
                        onSettle={openUsageDialog}
                        onToggleUsed={(stat) =>
                          updateUsageStateMutation.mutate(stat)
                        }
                      />
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <DirectionFormDialog
        open={dialogOpen}
        mode={dialogMode}
        initialValue={dialogInitialValue}
        isPending={isSaving}
        canSelectDepartments={isPlatformAdmin}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
      />

      <Dialog
        open={Boolean(deletingDirection)}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingDirection(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除方向</DialogTitle>
            <DialogDescription>
              确认删除“{deletingDirection?.title}”吗？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <LoadingButton
              type="button"
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={() => {
                if (deletingDirection) {
                  deleteMutation.mutate(deletingDirection)
                }
              }}
            >
              确认删除
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
