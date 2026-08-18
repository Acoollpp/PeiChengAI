import { createFileRoute } from "@tanstack/react-router"

import { CustomReviewInputsPage } from "@/components/Admin/CustomReviewInputsPage"
import { requireManagementUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/custom-review-inputs")({
  component: CustomReviewInputsPage,
  beforeLoad: async () => {
    await requireManagementUser()
  },
  head: () => ({
    meta: [{ title: "自定义审查输入统计 - 沛城科技代码审查平台" }],
  }),
})
