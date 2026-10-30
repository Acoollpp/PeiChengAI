import { createFileRoute } from "@tanstack/react-router"

import { BomChangeCheckTaskManagementPage } from "@/components/BomChangeCheckTasks/BomChangeCheckTasksPage"

export const Route = createFileRoute("/_layout/tasks/bom-change-check-manage")({
  component: BomChangeCheckTaskManagementPage,
  head: () => ({
    meta: [
      {
        title: "BOM改制检查任务管理 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
