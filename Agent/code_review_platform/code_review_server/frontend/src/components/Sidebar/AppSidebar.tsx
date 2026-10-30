import {
  Briefcase,
  Cpu,
  FileSpreadsheet,
  GitCompareArrows,
  Home,
  Library,
  ListChecks,
  MessageSquareText,
  Microscope,
  MonitorDown,
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
import { hasAdminPrivileges } from "@/lib/authz"
import { type Item, Main } from "./Main"
import { User } from "./User"

type SidebarLinkItem = Extract<Item, { path: string }>

const taskChildren: SidebarLinkItem[] = [
  {
    icon: Cpu,
    title: "GPIO配置表任务管理",
    path: "/tasks/gpio-manage",
  },
  {
    icon: FileSpreadsheet,
    title: "BOM配送检查任务管理",
    path: "/tasks/bom-spec-compare-manage",
  },
  {
    icon: GitCompareArrows,
    title: "线束图对比任务管理",
    path: "/tasks/wire-harness-compare-manage",
  },
  {
    icon: FileSpreadsheet,
    title: "BOM改制检查任务管理",
    path: "/tasks/bom-change-check-manage",
  },
  {
    icon: FileSpreadsheet,
    title: "BOM电子档修改任务管理",
    path: "/tasks/bom-electronic-edit-manage",
  },
  {
    icon: Microscope,
    title: "白盒测试任务管理",
    path: "/tasks/whitebox-manage",
  },
]

const userItems: Item[] = [
  { icon: Home, title: "主页", path: "/" },
  { icon: MessageSquareText, title: "意见管理", path: "/feedback" },
  {
    icon: ListChecks,
    title: "任务管理",
    children: taskChildren,
  },
  { icon: Cpu, title: "GPIO配置表平台", path: "/tasks/gpio" },
  { icon: FileSpreadsheet, title: "BOM配送检查", path: "/tasks/bom-spec-compare" },
  { icon: GitCompareArrows, title: "线束图对比", path: "/tasks/wire-harness-compare" },
  { icon: FileSpreadsheet, title: "BOM改制检查", path: "/tasks/bom-change-check" },
  { icon: FileSpreadsheet, title: "BOM电子档修改", path: "/tasks/bom-electronic-edit" },
  { icon: Microscope, title: "白盒测试平台", path: "/tasks/whitebox" },
]

const adminItems: Item[] = [
  { icon: Home, title: "主页", path: "/" },
  { icon: Briefcase, title: "部门管理", path: "/items" },
  { icon: Users, title: "用户管理", path: "/admin/users" },
  { icon: MessageSquareText, title: "意见管理", path: "/feedback" },
  {
    icon: ListChecks,
    title: "任务管理",
    children: taskChildren,
  },
  { icon: Cpu, title: "GPIO配置表平台", path: "/tasks/gpio" },
  { icon: FileSpreadsheet, title: "BOM配送检查", path: "/tasks/bom-spec-compare" },
  { icon: GitCompareArrows, title: "线束图对比", path: "/tasks/wire-harness-compare" },
  { icon: FileSpreadsheet, title: "BOM改制检查", path: "/tasks/bom-change-check" },
  { icon: FileSpreadsheet, title: "BOM电子档修改", path: "/tasks/bom-electronic-edit" },
  { icon: Microscope, title: "白盒测试平台", path: "/tasks/whitebox" },
  { icon: Library, title: "Skill库", path: "/admin/skills" },
  { icon: MonitorDown, title: "客户端版本", path: "/admin/client-releases" },
]

export function AppSidebar() {
  const { user: currentUser } = useAuth()
  const items = hasAdminPrivileges(currentUser) ? adminItems : userItems

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
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
