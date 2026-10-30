import { createFileRoute } from "@tanstack/react-router"

import { BomSpecCompareTasksPage } from "@/components/BomSpecCompareTasks/BomSpecCompareTasksPage"

export const Route = createFileRoute("/_layout/tasks/bom-spec-compare")({
  component: BomSpecCompareTasksPage,
  head: () => ({
    meta: [
      {
        title: "BOM配送检查 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
