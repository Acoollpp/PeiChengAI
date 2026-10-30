import { createFileRoute } from "@tanstack/react-router"

import { GpioTasksPage } from "@/components/GpioTasks/GpioTasksPage"

export const Route = createFileRoute("/_layout/tasks/gpio")({
  component: GpioTasksPage,
  head: () => ({
    meta: [
      {
        title: "GPIO配置表平台 - 沛城科技GPIO配置表平台",
      },
    ],
  }),
})
