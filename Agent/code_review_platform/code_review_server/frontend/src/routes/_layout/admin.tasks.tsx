import { createFileRoute } from "@tanstack/react-router"

import { AdminTasksPage } from "@/components/Admin/TasksPage"
import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/tasks")({
  component: AdminTasksPage,
  beforeLoad: async () => {
    await requireAdminUser()
  },
  head: () => ({
    meta: [
      {
        title: "任务管理 - 沛城科技代码审查平台",
      },
    ],
  }),
})
