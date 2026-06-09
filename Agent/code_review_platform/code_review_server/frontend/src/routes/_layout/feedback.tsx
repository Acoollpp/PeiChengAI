import { createFileRoute } from "@tanstack/react-router"

import { FeedbackPage } from "@/components/Feedback/FeedbackPage"

export const Route = createFileRoute("/_layout/feedback")({
  component: FeedbackPage,
  head: () => ({
    meta: [
      {
        title: "意见管理 - 沛城科技代码审查平台",
      },
    ],
  }),
})
