import { createFileRoute } from "@tanstack/react-router"

import { WhiteboxTaskManagementPage } from "@/components/WhiteboxTasks/WhiteboxTasksPage"

export const Route = createFileRoute("/_layout/tasks/whitebox-manage")({
  component: WhiteboxTaskManagementPage,
  head: () => ({
    meta: [
      {
        title: "白盒测试任务管理 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
