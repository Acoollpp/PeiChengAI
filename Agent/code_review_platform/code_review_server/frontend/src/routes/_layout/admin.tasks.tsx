import { createFileRoute, redirect } from "@tanstack/react-router"

import { UsersService } from "@/client"
import { hasAdminPrivileges } from "@/lib/authz"

export const Route = createFileRoute("/_layout/admin/tasks")({
  beforeLoad: async ({ location }) => {
    const user = await UsersService.readUserMe()
    if (!hasAdminPrivileges(user)) {
      throw redirect({
        to: "/",
      })
    }

    if (location.pathname === "/admin/tasks") {
      throw redirect({
        to: "/admin/tasks/review",
      })
    }
  },
})
