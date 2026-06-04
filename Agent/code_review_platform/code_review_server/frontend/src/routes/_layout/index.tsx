import { createFileRoute } from "@tanstack/react-router"

import { TaskStatsPanel } from "@/components/Home/TaskStatsPanel"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/")({
  component: Home,
  head: () => ({
    meta: [
      {
        title: "主页 - 沛城科技代码审查平台",
      },
    ],
  }),
})

function Home() {
  const { user: currentUser } = useAuth()
  const displayName =
    currentUser?.full_name || currentUser?.svn_username || "用户"

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="max-w-sm truncate text-2xl font-bold tracking-tight">
          你好，{displayName}
        </h1>
        <p className="text-muted-foreground">欢迎回来，很高兴再次见到你。</p>
      </div>
      <TaskStatsPanel />
    </div>
  )
}
