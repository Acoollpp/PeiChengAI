import { createFileRoute } from "@tanstack/react-router"

import { BomElectronicEditTaskManagementPage } from "@/components/BomElectronicEditTasks/BomElectronicEditTasksPage"

export const Route = createFileRoute("/_layout/tasks/bom-electronic-edit-manage")({
  component: BomElectronicEditTaskManagementPage,
  head: () => ({
    meta: [
      {
        title: "BOM电子档修改任务管理 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
