import type { UserPublic } from "@/client"

type UserWithRole = UserPublic & {
  role?: string | null
}

export function hasPlatformAdminPrivileges(
  user: UserWithRole | null | undefined,
) {
  return user?.role === "admin"
}

export function hasDepartmentAdminPrivileges(
  user: UserWithRole | null | undefined,
) {
  return user?.role === "department_admin"
}

export function hasManagementPrivileges(user: UserWithRole | null | undefined) {
  return hasPlatformAdminPrivileges(user) || hasDepartmentAdminPrivileges(user)
}

export const hasAdminPrivileges = hasPlatformAdminPrivileges
