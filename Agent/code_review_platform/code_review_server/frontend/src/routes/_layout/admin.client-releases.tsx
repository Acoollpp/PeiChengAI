import { createFileRoute } from "@tanstack/react-router"

import { AdminClientReleasesPage } from "@/components/Admin/ClientReleasesPage"
import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/client-releases")({
  component: AdminClientReleasesPage,
  beforeLoad: async () => {
    await requireAdminUser()
  },
  head: () => ({
    meta: [
      {
        title: "客户端版本 - 沛城科技代码审查平台",
      },
    ],
  }),
})
