import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown } from "lucide-react"
import { useMemo, useState } from "react"

import { DepartmentsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface DepartmentMultiSelectProps {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

export function DepartmentMultiSelect({
  value,
  onChange,
  disabled = false,
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
          type="button"
          variant="outline"
          className="w-full justify-between"
          disabled={disabled || isLoading}
          aria-label="选择部门"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onChange([])
          }}
        >
          <Checkbox
            checked={value.length === 0}
            className="mr-2"
            aria-label="全局"
          />
          全局
        </DropdownMenuItem>
        {departments.map((department) => (
          <DropdownMenuItem
            key={department.id}
            onSelect={(event) => {
              event.preventDefault()
              toggleDepartment(department.id)
            }}
          >
            <Checkbox
              checked={value.includes(department.id)}
              className="mr-2"
              aria-label={department.name}
            />
            <span className="flex-1 truncate">{department.name}</span>
            {value.includes(department.id) && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
