import { createFileRoute } from "@tanstack/react-router"

import { BomChangeCheckTasksPage } from "@/components/BomChangeCheckTasks/BomChangeCheckTasksPage"

export const Route = createFileRoute("/_layout/tasks/bom-change-check")({
  component: BomChangeCheckTasksPage,
  head: () => ({
    meta: [
      {
        title: "BOM改制检查 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
