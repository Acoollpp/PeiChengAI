import { createFileRoute } from "@tanstack/react-router"

import { WireHarnessComparePage } from "@/components/WireHarnessCompare/WireHarnessComparePage"

export const Route = createFileRoute("/_layout/tasks/wire-harness-compare")({
  component: WireHarnessComparePage,
  head: () => ({ meta: [{ title: "线束图对比" }] }),
})
