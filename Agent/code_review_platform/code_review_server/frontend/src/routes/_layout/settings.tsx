import { createFileRoute } from "@tanstack/react-router"

import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import SvnCredentialForm from "@/components/UserSettings/SvnCredentialForm"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"

const tabsConfig = [
  { value: "profile", title: "个人信息", component: UserInformation },
  { value: "svn", title: "SVN凭据", component: SvnCredentialForm },
  { value: "danger", title: "危险操作", component: DeleteAccount },
]

export const Route = createFileRoute("/_layout/settings")({
  component: UserSettings,
  head: () => ({
    meta: [
      {
        title: "个人设置 - 沛城科技代码审查平台",
      },
    ],
  }),
})

function UserSettings() {
  const { user: currentUser } = useAuth()

  if (!currentUser) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">个人设置</h1>
        <p className="text-muted-foreground">管理账号信息和偏好设置</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          {tabsConfig.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabsConfig.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.component />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
