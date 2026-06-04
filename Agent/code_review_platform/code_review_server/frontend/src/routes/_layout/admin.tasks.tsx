import { createFileRoute, redirect } from "@tanstack/react-router"

import { UsersService } from "@/client"
import { hasAdminPrivileges } from "@/lib/authz"

export const Route = createFileRoute("/_layout/admin/tasks")({
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!hasAdminPrivileges(user)) {
      throw redirect({
        to: "/",
      })
    }

    throw redirect({
      to: "/tasks/review",
    })
  },
})
