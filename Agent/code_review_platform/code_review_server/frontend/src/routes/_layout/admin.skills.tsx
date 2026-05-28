import { createFileRoute } from "@tanstack/react-router"

import { AdminSkillsPage } from "@/components/Admin/SkillsPage"
import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/skills")({
  component: AdminSkillsPage,
  beforeLoad: async () => {
    await requireAdminUser()
  },
  head: () => ({
    meta: [
      {
        title: "Skill库 - 沛城科技代码审查平台",
      },
    ],
  }),
})
