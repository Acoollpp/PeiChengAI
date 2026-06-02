import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"
import { Suspense } from "react"

import { CchSyncService, type UserPublic, UsersService } from "@/client"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { DataTable } from "../Common/DataTable"
import PendingUsers from "../Pending/PendingUsers"
import AddUser from "./AddUser"
import { columns, type UserTableData } from "./columns"

function getUsersQueryOptions() {
  return {
    queryFn: () => UsersService.readUsers({ skip: 0, limit: 100 }),
    queryKey: ["users"],
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

function UsersTableContent() {
  const { user: currentUser } = useAuth()
  const { data: users } = useSuspenseQuery(getUsersQueryOptions())

  const tableData: UserTableData[] = users.data.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return <DataTable columns={columns} data={tableData} />
}

function UsersTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent />
    </Suspense>
  )
}

export function AdminUsersPage() {
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
      <UsersTable />
    </div>
  )
}
