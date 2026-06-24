import { createFileRoute, redirect } from "@tanstack/react-router"

import { requirePlatformAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/tasks")({
  beforeLoad: async () => {
    await requirePlatformAdminUser()

    throw redirect({
      to: "/tasks/review",
    })
  },
})
