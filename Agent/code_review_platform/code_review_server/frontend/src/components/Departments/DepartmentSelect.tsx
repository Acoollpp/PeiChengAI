import { useQuery } from "@tanstack/react-query"

import { DepartmentsService } from "@/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const NO_DEPARTMENT_VALUE = "__none__"

interface DepartmentSelectProps {
  value?: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
}

export function DepartmentSelect({
  value,
  onChange,
  disabled = false,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: DepartmentSelectProps) {
  const { data, isLoading } = useQuery({
    queryFn: () => DepartmentsService.readDepartments({ limit: 1000 }),
    queryKey: ["departments", "select"],
  })

  const departments = data?.data ?? []

  return (
    <Select
      value={value || NO_DEPARTMENT_VALUE}
      onValueChange={(nextValue) =>
        onChange(nextValue === NO_DEPARTMENT_VALUE ? null : nextValue)
      }
      disabled={disabled || isLoading}
    >
      <SelectTrigger
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className="w-full"
      >
        <SelectValue placeholder="不选择部门" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_DEPARTMENT_VALUE}>不选择部门</SelectItem>
        {departments.map((department) => (
          <SelectItem key={department.id} value={department.id}>
            {department.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
