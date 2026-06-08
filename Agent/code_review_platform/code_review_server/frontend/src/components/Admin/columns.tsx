import type { ColumnDef } from "@tanstack/react-table"

import type { UserPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { UserActionsMenu } from "./UserActionsMenu"

export type UserTableData = UserPublic & {
  isCurrentUser: boolean
  svn_username?: string | null
  role?: string | null
  auth_source?: string | null
  cch_user_id?: number | null
  last_synced_at?: string | null
}

export const columns: ColumnDef<UserTableData>[] = [
  {
    accessorKey: "full_name",
    header: "姓名",
    cell: ({ row }) => {
      const fullName = row.original.full_name
      return (
        <div className="flex items-center gap-2">
          <span
            className={cn("font-medium", !fullName && "text-muted-foreground")}
          >
            {fullName || "N/A"}
          </span>
          {row.original.isCurrentUser && (
            <Badge variant="outline" className="text-xs">
              当前用户
            </Badge>
          )}
        </div>
      )
    },
  },
  {
    id: "svn_account",
    header: "SVN账号",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.svn_username || "-"}
      </span>
    ),
  },
  {
    accessorKey: "auth_source",
    header: "来源",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.auth_source === "cch" ? "CCH" : "本地"}
      </span>
    ),
  },
  {
    accessorKey: "cch_user_id",
    header: "CCH用户ID",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.cch_user_id ?? "-"}
      </span>
    ),
  },
  {
    accessorKey: "last_synced_at",
    header: "最近同步",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.last_synced_at
          ? new Date(row.original.last_synced_at).toLocaleString()
          : "-"}
      </span>
    ),
  },
  {
    accessorKey: "role",
    header: "角色",
    cell: ({ row }) => (
      <Badge variant={row.original.role === "admin" ? "default" : "secondary"}>
        {row.original.role === "admin" ? "管理员" : "用户"}
      </Badge>
    ),
  },
  {
    accessorKey: "is_active",
    header: "状态",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 rounded-full",
            row.original.is_active ? "bg-green-500" : "bg-gray-400",
          )}
        />
        <span className={row.original.is_active ? "" : "text-muted-foreground"}>
          {row.original.is_active ? "启用" : "停用"}
        </span>
      </div>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">操作</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <UserActionsMenu user={row.original} />
      </div>
    ),
  },
]
