import { createFileRoute } from "@tanstack/react-router"

import { ReviewFocusDirectionsPage } from "@/components/Admin/ReviewFocusDirectionsPage"
import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute(
  "/_layout/admin/review-focus-directions",
)({
  component: ReviewFocusDirectionsPage,
  beforeLoad: async () => {
    await requireAdminUser()
  },
  head: () => ({
    meta: [
      {
        title: "重点审查方向 - 沛城科技代码审查平台",
      },
    ],
  }),
})
