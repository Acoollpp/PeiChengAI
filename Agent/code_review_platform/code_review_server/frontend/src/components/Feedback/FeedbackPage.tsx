import { MessageSquarePlus } from "lucide-react"

import { Button } from "@/components/ui/button"

export function FeedbackPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">意见管理</h1>
          <p className="text-muted-foreground">
            查看意见处理进度，或提交新的问题反馈。
          </p>
        </div>
        <Button type="button">
          <MessageSquarePlus />
          提交意见
        </Button>
      </div>
    </div>
  )
}
