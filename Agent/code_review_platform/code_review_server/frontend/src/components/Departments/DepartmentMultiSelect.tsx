import { useQuery } from "@tanstack/react-query"
import { ChevronsUpDown } from "lucide-react"
import { useMemo, useState } from "react"

import { DepartmentsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface DepartmentMultiSelectProps {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  id?: string
  "aria-labelledby"?: string
}

export function DepartmentMultiSelect({
  value,
  onChange,
  disabled = false,
  id,
  "aria-labelledby": ariaLabelledBy,
}: DepartmentMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryFn: () => DepartmentsService.readDepartments({ limit: 1000 }),
    queryKey: ["departments", "multi-select"],
  })

  const departments = data?.data ?? []
  const selectedNames = useMemo(
    () =>
      departments
        .filter((department) => value.includes(department.id))
        .map((department) => department.name),
    [departments, value],
  )
  const label = selectedNames.length === 0 ? "全局" : selectedNames.join("、")

  const toggleDepartment = (departmentId: string) => {
    if (value.includes(departmentId)) {
      onChange(value.filter((item) => item !== departmentId))
      return
    }

    onChange([...value, departmentId])
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full justify-between"
          disabled={disabled || isLoading}
          aria-label="选择部门"
          aria-labelledby={ariaLabelledBy}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuCheckboxItem
          checked={value.length === 0}
          onSelect={(event) => {
            event.preventDefault()
            onChange([])
          }}
        >
          全局
        </DropdownMenuCheckboxItem>
        {departments.map((department) => (
          <DropdownMenuCheckboxItem
            key={department.id}
            checked={value.includes(department.id)}
            onSelect={(event) => {
              event.preventDefault()
              toggleDepartment(department.id)
            }}
          >
            <span className="flex-1 truncate">{department.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
