import { createFileRoute } from "@tanstack/react-router"

import { BomElectronicEditTasksPage } from "@/components/BomElectronicEditTasks/BomElectronicEditTasksPage"

export const Route = createFileRoute("/_layout/tasks/bom-electronic-edit")({
  component: BomElectronicEditTasksPage,
  head: () => ({
    meta: [
      {
        title: "BOM电子档修改 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
