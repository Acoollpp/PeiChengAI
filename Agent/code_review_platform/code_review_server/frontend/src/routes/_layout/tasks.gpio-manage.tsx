import { createFileRoute } from "@tanstack/react-router"

import { GpioTaskManagementPage } from "@/components/GpioTasks/GpioTasksPage"

export const Route = createFileRoute("/_layout/tasks/gpio-manage")({
  component: GpioTaskManagementPage,
  head: () => ({
    meta: [
      {
        title: "GPIO配置表任务管理 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
