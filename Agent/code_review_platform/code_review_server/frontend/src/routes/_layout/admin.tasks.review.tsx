import { createFileRoute } from "@tanstack/react-router"

import { AdminTasksPage } from "@/components/Admin/TasksPage"

export const Route = createFileRoute("/_layout/admin/tasks/review")({
  component: AdminTasksPage,
  head: () => ({
    meta: [
      {
        title: "代码审查任务管理 - 沛城科技代码审查平台",
      },
    ],
  }),
})
