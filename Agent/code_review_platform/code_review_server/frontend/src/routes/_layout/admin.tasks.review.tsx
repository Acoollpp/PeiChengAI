import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_layout/admin/tasks/review")({
  beforeLoad: () => {
    throw redirect({
      to: "/tasks/review",
    })
  },
})
