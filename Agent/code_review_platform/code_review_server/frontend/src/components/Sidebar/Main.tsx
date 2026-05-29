import { Link as RouterLink, useRouterState } from "@tanstack/react-router"
import type { LucideIcon } from "lucide-react"
import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  useEffect(() => {
    setOpenGroups((current) => {
      let next = current
      for (const item of items) {
        if (!isGroupItem(item)) continue
        const isActive = item.children.some(
          (child) => currentPath === child.path,
        )
        if (isActive && current[item.title] !== true) {
          next = { ...next, [item.title]: true }
        }
      }
      return next
    })
  }, [currentPath, items])

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            if (isGroupItem(item)) {
              const isActive = item.children.some(
                (child) => currentPath === child.path,
              )
              const isOpen = openGroups[item.title] ?? isActive

              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    type="button"
                    tooltip={item.title}
                    isActive={isActive}
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenGroups((current) => ({
                        ...current,
                        [item.title]: !(current[item.title] ?? isActive),
                      }))
                    }
                  >
                    <item.icon />
                    <span>{item.title}</span>
                    <ChevronRight
                      className={`ml-auto transition-transform group-data-[collapsible=icon]:hidden ${
                        isOpen ? "rotate-90" : ""
                      }`}
                    />
                  </SidebarMenuButton>
                  {isOpen ? (
                    <SidebarMenuSub>
                      {item.children.map((child) => {
                        const isChildActive = currentPath === child.path

                        return (
                          <SidebarMenuSubItem key={child.title}>
                            <SidebarMenuSubButton
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
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )
                      })}
                    </SidebarMenuSub>
                  ) : null}
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
