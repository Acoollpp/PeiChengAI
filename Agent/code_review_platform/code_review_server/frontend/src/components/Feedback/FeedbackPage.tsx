import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { PaginationState } from "@tanstack/react-table"
import { Search, X } from "lucide-react"
import { type FormEvent, Suspense, useMemo, useState } from "react"

import {
  FeedbackService,
  type FeedbackPublic,
  type FeedbackStatus,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import PendingItems from "@/components/Pending/PendingItems"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { hasAdminPrivileges } from "@/lib/authz"
import { handleError } from "@/utils"
import {
  createFeedbackColumns,
  feedbackStatusOptions,
  type FeedbackTableData,
} from "./columns"
import { FeedbackDetailDialog } from "./FeedbackDetailDialog"
import { SubmitFeedbackDialog } from "./SubmitFeedbackDialog"

type FeedbackFilters = {
  status: FeedbackStatus | "all"
  userName: string
  svnUsername: string
}

const emptyFilters: FeedbackFilters = {
  status: "all",
  userName: "",
  svnUsername: "",
}

function getFeedbackQueryOptions({
  pagination,
  filters,
  isAdmin,
}: {
  pagination: PaginationState
  filters: FeedbackFilters
  isAdmin: boolean
}) {
  return {
    queryFn: () =>
      FeedbackService.readFeedback({
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
        status:
          isAdmin && filters.status !== "all" ? filters.status : undefined,
        userName: isAdmin ? filters.userName.trim() || undefined : undefined,
        svnUsername: isAdmin
          ? filters.svnUsername.trim() || undefined
          : undefined,
      }),
    queryKey: ["feedback", isAdmin ? "admin" : "me", pagination, filters],
  }
}

function FeedbackTable({
  filters,
  isAdmin,
  pagination,
  selectedFeedback,
  setPagination,
  setSelectedFeedback,
}: {
  filters: FeedbackFilters
  isAdmin: boolean
  pagination: PaginationState
  selectedFeedback: FeedbackPublic | null
  setPagination: (pagination: PaginationState) => void
  setSelectedFeedback: (feedback: FeedbackPublic | null) => void
}) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const { data: feedback } = useSuspenseQuery(
    getFeedbackQueryOptions({ pagination, filters, isAdmin }),
  )
  const statusMutation = useMutation({
    mutationFn: ({
      feedbackId,
      status,
    }: {
      feedbackId: string
      status: FeedbackStatus
    }) =>
      FeedbackService.updateFeedbackStatus({
        feedbackId,
        requestBody: { status },
      }),
    onSuccess: (updatedFeedback) => {
      showSuccessToast("意见状态已更新")
      if (selectedFeedback?.id === updatedFeedback.id) {
        setSelectedFeedback(updatedFeedback)
      }
      queryClient.invalidateQueries({ queryKey: ["feedback"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const columns = useMemo(
    () =>
      createFeedbackColumns({
        isAdmin,
        updatingFeedbackId: statusMutation.isPending
          ? statusMutation.variables?.feedbackId
          : null,
        onOpenDetail: setSelectedFeedback,
        onStatusChange: (item, status) => {
          if (item.status === status) {
            return
          }

          statusMutation.mutate({ feedbackId: item.id, status })
        },
      }),
    [
      isAdmin,
      setSelectedFeedback,
      statusMutation.isPending,
      statusMutation.variables?.feedbackId,
    ],
  )
  const tableData: FeedbackTableData[] = feedback.data

  return (
    <DataTable
      columns={columns}
      data={tableData}
      manualPagination
      onPaginationChange={setPagination}
      pageCount={Math.max(1, Math.ceil(feedback.count / pagination.pageSize))}
      pagination={pagination}
      totalCount={feedback.count}
    />
  )
}

export function FeedbackPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isAdmin = hasAdminPrivileges(user)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [filterInput, setFilterInput] = useState<FeedbackFilters>(emptyFilters)
  const [filters, setFilters] = useState<FeedbackFilters>(emptyFilters)
  const [selectedFeedback, setSelectedFeedback] =
    useState<FeedbackPublic | null>(null)

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPagination((current) => ({ ...current, pageIndex: 0 }))
    setFilters({
      status: filterInput.status,
      userName: filterInput.userName.trim(),
      svnUsername: filterInput.svnUsername.trim(),
    })
  }

  const handleClearFilters = () => {
    setFilterInput(emptyFilters)
    setFilters(emptyFilters)
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }

  const hasActiveFilters =
    filters.status !== "all" || Boolean(filters.userName || filters.svnUsername)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">意见管理</h1>
          <p className="text-muted-foreground">
            查看意见处理进度，或提交新的问题反馈。
          </p>
        </div>
        <SubmitFeedbackDialog
          onSubmitted={() =>
            queryClient.invalidateQueries({ queryKey: ["feedback"] })
          }
        />
      </div>

      {isAdmin && (
        <form
          className="flex flex-col gap-2 lg:flex-row lg:items-center"
          onSubmit={handleSearch}
        >
          <Select
            value={filterInput.status}
            onValueChange={(value) =>
              setFilterInput((current) => ({
                ...current,
                status: value as FeedbackFilters["status"],
              }))
            }
          >
            <SelectTrigger className="w-full lg:w-36">
              <SelectValue placeholder="解决状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {feedbackStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="筛选提交人姓名"
            className="max-w-sm"
            onChange={(event) =>
              setFilterInput((current) => ({
                ...current,
                userName: event.target.value,
              }))
            }
            placeholder="提交人姓名"
            value={filterInput.userName}
          />
          <Input
            aria-label="筛选SVN账号"
            className="max-w-sm"
            onChange={(event) =>
              setFilterInput((current) => ({
                ...current,
                svnUsername: event.target.value,
              }))
            }
            placeholder="SVN账号"
            value={filterInput.svnUsername}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="outline">
              <Search />
              搜索
            </Button>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleClearFilters}
              >
                <X />
                清除
              </Button>
            )}
          </div>
        </form>
      )}

      <Suspense fallback={<PendingItems />}>
        <FeedbackTable
          filters={filters}
          isAdmin={isAdmin}
          pagination={pagination}
          selectedFeedback={selectedFeedback}
          setPagination={setPagination}
          setSelectedFeedback={setSelectedFeedback}
        />
      </Suspense>

      <FeedbackDetailDialog
        feedback={selectedFeedback}
        open={Boolean(selectedFeedback)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedFeedback(null)
          }
        }}
      />
    </div>
  )
}
