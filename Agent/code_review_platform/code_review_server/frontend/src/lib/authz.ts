import type { UserPublic } from "@/client"

type UserWithRole = UserPublic & {
  role?: string | null
}

export function hasAdminPrivileges(user: UserWithRole | null | undefined) {
  return user?.role === "admin"
}
