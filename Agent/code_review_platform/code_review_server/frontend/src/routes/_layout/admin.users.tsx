import { createFileRoute } from "@tanstack/react-router"

import { AdminUsersPage } from "@/components/Admin/UsersPage"
import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/users")({
  component: AdminUsersPage,
  beforeLoad: async () => {
    await requireAdminUser()
  },
  head: () => ({
    meta: [
      {
        title: "用户管理 - 沛城科技代码审查平台",
      },
    ],
  }),
})
