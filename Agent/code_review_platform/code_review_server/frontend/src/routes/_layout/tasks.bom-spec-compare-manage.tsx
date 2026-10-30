import { createFileRoute } from "@tanstack/react-router"

import { BomSpecCompareTaskManagementPage } from "@/components/BomSpecCompareTasks/BomSpecCompareTasksPage"

export const Route = createFileRoute("/_layout/tasks/bom-spec-compare-manage")({
  component: BomSpecCompareTaskManagementPage,
  head: () => ({
    meta: [
      {
        title: "BOM配送检查任务管理 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
