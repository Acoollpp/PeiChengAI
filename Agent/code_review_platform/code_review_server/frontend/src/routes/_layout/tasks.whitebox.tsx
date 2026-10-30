import { createFileRoute } from "@tanstack/react-router"

import { WhiteboxTasksPage } from "@/components/WhiteboxTasks/WhiteboxTasksPage"

export const Route = createFileRoute("/_layout/tasks/whitebox")({
  component: WhiteboxTasksPage,
  head: () => ({
    meta: [
      {
        title: "白盒测试平台 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
