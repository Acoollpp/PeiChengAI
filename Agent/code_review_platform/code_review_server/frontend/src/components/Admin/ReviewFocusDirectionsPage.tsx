import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Edit, Plus, Trash2 } from "lucide-react"
import { type FormEvent, useEffect, useMemo, useState } from "react"

import {
  type ReviewFocusDirectionCreate,
  type ReviewFocusDirectionPublic,
  type ReviewFocusDirectionUsageStatPublic,
  ReviewFocusDirectionsService,
} from "@/client"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

type DirectionFormMode = "create" | "edit" | "usage"

type DirectionFormState = {
  title: string
  content: string
  department_id: string | null
  is_active: boolean
}

const emptyForm: DirectionFormState = {
  title: "",
  content: "",
  department_id: null,
  is_active: true,
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
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  mode: DirectionFormMode
  initialValue: DirectionFormState
  isPending: boolean
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

            <div className="grid gap-2">
              <Label htmlFor="focus-direction-department">部门</Label>
              <DepartmentSelect
                id="focus-direction-department"
                value={form.department_id}
                onChange={(departmentId) =>
                  setForm((current) => ({
                    ...current,
                    department_id: departmentId,
                  }))
                }
              />
            </div>
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
  onEdit,
  onDelete,
  onToggle,
}: {
  directions: ReviewFocusDirectionPublic[]
  onEdit: (direction: ReviewFocusDirectionPublic) => void
  onDelete: (direction: ReviewFocusDirectionPublic) => void
  onToggle: (direction: ReviewFocusDirectionPublic) => void
}) {
  if (directions.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
          暂无重点审查方向。
        </TableCell>
      </TableRow>
    )
  }

  return directions.map((direction) => (
    <TableRow key={direction.id}>
      <TableCell className="font-medium">{direction.title}</TableCell>
      <TableCell className="max-w-md text-muted-foreground">
        <span className="line-clamp-2">{direction.content}</span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {direction.department_name || "全局"}
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
      </TableCell>
    </TableRow>
  ))
}

function UsageStatRows({
  stats,
  onSettle,
}: {
  stats: ReviewFocusDirectionUsageStatPublic[]
  onSettle: (stat: ReviewFocusDirectionUsageStatPublic) => void
}) {
  if (stats.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="h-28 text-center text-muted-foreground">
          暂无用户输入统计。
        </TableCell>
      </TableRow>
    )
  }

  return stats.map((stat) => (
    <TableRow key={`${stat.content}-${stat.usage_count}`}>
      <TableCell className="max-w-xl text-muted-foreground">
        <span className="line-clamp-2">{stat.content}</span>
      </TableCell>
      <TableCell>{stat.usage_count}</TableCell>
      <TableCell className="text-muted-foreground">
        {stat.departments?.length ? stat.departments.join("、") : "全局"}
      </TableCell>
      <TableCell>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onSettle(stat)}
          >
            沉淀为方向
          </Button>
        </div>
      </TableCell>
    </TableRow>
  ))
}

export function ReviewFocusDirectionsPage() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<DirectionFormMode>("create")
  const [editingDirection, setEditingDirection] =
    useState<ReviewFocusDirectionPublic | null>(null)
  const [formInitialValue, setFormInitialValue] =
    useState<DirectionFormState>(emptyForm)
  const [deletingDirection, setDeletingDirection] =
    useState<ReviewFocusDirectionPublic | null>(null)

  const directionsQuery = useQuery({
    queryFn: () => ReviewFocusDirectionsService.readReviewFocusDirections(),
    queryKey: ["review-focus-directions"],
  })
  const usageStatsQuery = useQuery({
    queryFn: () => ReviewFocusDirectionsService.readUsageStats(),
    queryKey: ["review-focus-directions", "usage-stats"],
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
      requestBody: ReviewFocusDirectionCreate
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
    mutationFn: (direction: ReviewFocusDirectionPublic) =>
      ReviewFocusDirectionsService.updateReviewFocusDirection({
        directionId: direction.id,
        requestBody: { is_active: !direction.is_active },
      }),
    onSuccess: async (updated) => {
      showSuccessToast(updated.is_active ? "方向已启用" : "方向已停用")
      await invalidateDirections()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: (directionId: string) =>
      ReviewFocusDirectionsService.deleteReviewFocusDirection({ directionId }),
    onSuccess: async () => {
      showSuccessToast("方向删除成功")
      setDeletingDirection(null)
      await invalidateDirections()
    },
    onError: handleError.bind(showErrorToast),
  })

  const isSaving = createMutation.isPending || updateMutation.isPending
  const dialogInitialValue = useMemo(
    () => formInitialValue,
    [formInitialValue],
  )

  const openCreateDialog = () => {
    setDialogMode("create")
    setEditingDirection(null)
    setFormInitialValue(emptyForm)
    setDialogOpen(true)
  }

  const openEditDialog = (direction: ReviewFocusDirectionPublic) => {
    setDialogMode("edit")
    setEditingDirection(direction)
    setFormInitialValue({
      title: direction.title,
      content: direction.content,
      department_id: direction.department_id ?? null,
      is_active: direction.is_active,
    })
    setDialogOpen(true)
  }

  const openUsageDialog = (stat: ReviewFocusDirectionUsageStatPublic) => {
    setDialogMode("usage")
    setEditingDirection(null)
    setFormInitialValue({
      title: createTitleFromUsage(stat.content),
      content: stat.content,
      department_id: null,
      is_active: true,
    })
    setDialogOpen(true)
  }

  const handleSubmit = (value: DirectionFormState) => {
    if (!value.title || !value.content) {
      showErrorToast("请填写标题和内容")
      return
    }

    const payload: ReviewFocusDirectionCreate = {
      title: value.title,
      content: value.content,
      department_id: value.department_id,
      is_active: value.is_active,
    }

    if (dialogMode === "edit" && editingDirection) {
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">重点审查方向</h1>
          <p className="text-muted-foreground">
            管理方向库条目，并将用户常用输入沉淀为可复用方向。
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus />
          新增方向
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>方向库</CardTitle>
          <CardDescription>
            部门为空时表示全局方向，所有用户都可使用。
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              {directionsQuery.isLoading ? (
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
                  onEdit={openEditDialog}
                  onDelete={setDeletingDirection}
                  onToggle={(direction) => toggleMutation.mutate(direction)}
                />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="review-focus-usage-stats">
        <CardHeader>
          <CardTitle>用户输入统计</CardTitle>
          <CardDescription>
            根据用户提交任务时输入的重点方向聚合统计。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>内容</TableHead>
                <TableHead>使用次数</TableHead>
                <TableHead>涉及部门</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usageStatsQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-28 text-center text-muted-foreground"
                  >
                    正在加载用户输入统计...
                  </TableCell>
                </TableRow>
              ) : (
                <UsageStatRows stats={usageStats} onSettle={openUsageDialog} />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DirectionFormDialog
        open={dialogOpen}
        mode={dialogMode}
        initialValue={dialogInitialValue}
        isPending={isSaving}
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
                  deleteMutation.mutate(deletingDirection.id)
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
