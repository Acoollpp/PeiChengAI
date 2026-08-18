import {
  Briefcase,
  FileSpreadsheet,
  Home,
  Library,
  ListChecks,
  MessageSquareText,
  MonitorDown,
  Target,
  Users,
} from "lucide-react"

import { SidebarAppearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import {
  hasDepartmentAdminPrivileges,
  hasPlatformAdminPrivileges,
} from "@/lib/authz"
import { type Item, Main } from "./Main"
import { User } from "./User"

const userItems: Item[] = [
  { icon: Home, title: "主页", path: "/" },
  { icon: MessageSquareText, title: "意见管理", path: "/feedback" },
  {
    icon: ListChecks,
    title: "任务管理",
    children: [
      {
        icon: ListChecks,
        title: "代码审查任务管理",
        path: "/tasks/review",
      },
    ],
  },
]

const adminItems: Item[] = [
  { icon: Home, title: "主页", path: "/" },
  { icon: Briefcase, title: "部门管理", path: "/items" },
  { icon: Users, title: "用户管理", path: "/admin/users" },
  {
    icon: Target,
    title: "重点审查方向",
    path: "/admin/review-focus-directions",
  },
  { icon: MessageSquareText, title: "意见管理", path: "/feedback" },
  {
    icon: ListChecks,
    title: "任务管理",
    children: [
      {
        icon: ListChecks,
        title: "代码审查任务管理",
        path: "/tasks/review",
      },
      {
        icon: FileSpreadsheet,
        title: "自定义审查输入统计",
        path: "/admin/custom-review-inputs",
      },
    ],
  },
  { icon: Library, title: "Skill库", path: "/admin/skills" },
  { icon: MonitorDown, title: "客户端版本", path: "/admin/client-releases" },
]

const departmentAdminItems: Item[] = [
  { icon: Home, title: "主页", path: "/" },
  { icon: Users, title: "用户管理", path: "/admin/users" },
  {
    icon: Target,
    title: "重点审查方向",
    path: "/admin/review-focus-directions",
  },
  { icon: MessageSquareText, title: "意见管理", path: "/feedback" },
  {
    icon: ListChecks,
    title: "任务管理",
    children: [
      {
        icon: ListChecks,
        title: "代码审查任务管理",
        path: "/tasks/review",
      },
      {
        icon: FileSpreadsheet,
        title: "自定义审查输入统计",
        path: "/admin/custom-review-inputs",
      },
    ],
  },
]

export function AppSidebar() {
  const { user: currentUser } = useAuth()
  const items = hasPlatformAdminPrivileges(currentUser)
    ? adminItems
    : hasDepartmentAdminPrivileges(currentUser)
      ? departmentAdminItems
      : userItems

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
