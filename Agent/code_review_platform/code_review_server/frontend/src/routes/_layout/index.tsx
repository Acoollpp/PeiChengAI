import { createFileRoute } from "@tanstack/react-router"

import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: "Dashboard - 沛城科技代码审查平台",
      },
    ],
  }),
})

function Dashboard() {
  const { user: currentUser } = useAuth()
  const displayName =
    currentUser?.full_name || currentUser?.svn_username || "用户"

  return (
    <div>
      <div>
        <h1 className="text-2xl truncate max-w-sm">Hi, {displayName}</h1>
        <p className="text-muted-foreground">
          Welcome back, nice to see you again!!!
        </p>
      </div>
    </div>
  )
}
