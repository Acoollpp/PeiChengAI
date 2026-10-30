import { createFileRoute } from "@tanstack/react-router"

import { WireHarnessCompareManagementPage } from "@/components/WireHarnessCompare/WireHarnessComparePage"

export const Route = createFileRoute("/_layout/tasks/wire-harness-compare-manage")({
  component: WireHarnessCompareManagementPage,
  head: () => ({ meta: [{ title: "线束图对比任务管理" }] }),
})
