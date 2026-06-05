import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { PaginationState } from "@tanstack/react-table"
import { Loader2, RefreshCw, Search, X } from "lucide-react"
import { type FormEvent, Suspense, useState } from "react"

import { CchSyncService, type UserPublic, UsersService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { DataTable } from "../Common/DataTable"
import PendingUsers from "../Pending/PendingUsers"
import AddUser from "./AddUser"
import { columns, type UserTableData } from "./columns"

function getUsersQueryOptions(pagination: PaginationState, search: string) {
  return {
    queryFn: () =>
      UsersService.readUsers({
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
        search: search || undefined,
      }),
    queryKey: ["users", pagination, search],
  }
}

function SyncCchUsersButton() {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => CchSyncService.syncCchUsers(),
    onSuccess: (result) => {
      showSuccessToast(
        `同步完成：新增 ${result.created}，更新 ${result.updated}，禁用 ${result.disabled}`,
      )
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      {mutation.isPending ? (
        <Loader2 className="mr-2 animate-spin" />
      ) : (
        <RefreshCw className="mr-2" />
      )}
      同步 CCH 用户
    </Button>
  )
}

function UsersTableContent({
  pagination,
  search,
  setPagination,
}: {
  pagination: PaginationState
  search: string
  setPagination: (pagination: PaginationState) => void
}) {
  const { user: currentUser } = useAuth()
  const { data: users } = useSuspenseQuery(
    getUsersQueryOptions(pagination, search),
  )

  const tableData: UserTableData[] = users.data.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return (
    <DataTable
      columns={columns}
      data={tableData}
      manualPagination
      onPaginationChange={setPagination}
      pageCount={Math.max(1, Math.ceil(users.count / pagination.pageSize))}
      pagination={pagination}
      totalCount={users.count}
    />
  )
}

function UsersTable({
  pagination,
  search,
  setPagination,
}: {
  pagination: PaginationState
  search: string
  setPagination: (pagination: PaginationState) => void
}) {
  return (
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent
        pagination={pagination}
        search={search}
        setPagination={setPagination}
      />
    </Suspense>
  )
}

export function AdminUsersPage() {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPagination((current) => ({ ...current, pageIndex: 0 }))
    setSearch(searchInput.trim())
  }

  const handleClearSearch = () => {
    setSearchInput("")
    setSearch("")
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">用户管理</h1>
          <p className="text-muted-foreground">
            SVN账号和密码管理将在专用用户接口接入后启用。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncCchUsersButton />
          <AddUser />
        </div>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={handleSearch}
      >
        <Input
          aria-label="搜索用户"
          className="max-w-sm"
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="搜索姓名、CCH用户ID、SVN账号"
          value={searchInput}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            <Search />
            搜索
          </Button>
          {search && (
            <Button type="button" variant="ghost" onClick={handleClearSearch}>
              <X />
              清除
            </Button>
          )}
        </div>
      </form>
      <UsersTable
        pagination={pagination}
        search={search}
        setPagination={setPagination}
      />
    </div>
  )
}
