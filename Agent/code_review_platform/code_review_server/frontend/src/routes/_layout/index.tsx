import { createFileRoute } from "@tanstack/react-router"

import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: "仪表盘 - 沛城科技代码审查平台",
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
        <h1 className="text-2xl truncate max-w-sm">你好，{displayName}</h1>
        <p className="text-muted-foreground">欢迎回来，很高兴再次见到你。</p>
      </div>
    </div>
  )
}
