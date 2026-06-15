import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { DepartmentPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import DeleteDepartment from "./DeleteDepartment"
import EditDepartment from "./EditDepartment"

interface DepartmentActionsMenuProps {
  department: DepartmentPublic
}

export const DepartmentActionsMenu = ({
  department,
}: DepartmentActionsMenuProps) => {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EditDepartment department={department} onSuccess={() => setOpen(false)} />
        <DeleteDepartment id={department.id} onSuccess={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
