import { createFileRoute, Outlet } from "@tanstack/react-router"

import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin")({
  component: AdminLayout,
  beforeLoad: async () => {
    await requireAdminUser()
  },
})

function AdminLayout() {
  return <Outlet />
}
