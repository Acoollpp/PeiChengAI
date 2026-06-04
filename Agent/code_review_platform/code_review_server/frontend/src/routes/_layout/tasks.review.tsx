import { createFileRoute } from "@tanstack/react-router"

import { TasksPage } from "@/components/Tasks/TasksPage"

export const Route = createFileRoute("/_layout/tasks/review")({
  component: TasksPage,
  head: () => ({
    meta: [
      {
        title: "代码审查任务管理 - 沛城科技代码审查平台",
      },
    ],
  }),
})
