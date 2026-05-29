import { Link as RouterLink, useRouterState } from "@tanstack/react-router"
import type { LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

type BaseItem = {
  icon: LucideIcon
  title: string
}

type LinkItem = BaseItem & {
  path: string
}

type GroupItem = BaseItem & {
  children: LinkItem[]
}

export type Item = LinkItem | GroupItem

interface MainProps {
  items: Item[]
}

const isGroupItem = (item: Item): item is GroupItem => "children" in item

export function Main({ items }: MainProps) {
  const { isMobile, setOpenMobile } = useSidebar()
  const router = useRouterState()
  const currentPath = router.location.pathname

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            if (isGroupItem(item)) {
              const isActive = item.children.some(
                (child) => currentPath === child.path,
              )
              const firstChild = item.children[0]

              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isActive}
                    asChild
                  >
                    <RouterLink to={firstChild.path} onClick={handleMenuClick}>
                      <item.icon />
                      <span>{item.title}</span>
                    </RouterLink>
                  </SidebarMenuButton>
                  <SidebarMenu className="gap-0 pl-6 group-data-[collapsible=icon]:hidden">
                    {item.children.map((child) => {
                      const isChildActive = currentPath === child.path

                      return (
                        <SidebarMenuItem key={child.title}>
                          <SidebarMenuButton
                            tooltip={child.title}
                            isActive={isChildActive}
                            asChild
                          >
                            <RouterLink
                              to={child.path}
                              onClick={handleMenuClick}
                            >
                              <child.icon />
                              <span>{child.title}</span>
                            </RouterLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarMenuItem>
              )
            }

            const isActive = currentPath === item.path

            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive}
                  asChild
                >
                  <RouterLink to={item.path} onClick={handleMenuClick}>
                    <item.icon />
                    <span>{item.title}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
