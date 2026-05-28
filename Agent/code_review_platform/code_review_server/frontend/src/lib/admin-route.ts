import { redirect } from "@tanstack/react-router"

import { ApiError, UsersService } from "@/client"
import { hasAdminPrivileges } from "@/lib/authz"

export async function requireAdminUser() {
  try {
    const user = await UsersService.readUserMe()

    if (!hasAdminPrivileges(user)) {
      throw redirect({
        to: "/",
      })
    }

    return user
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      localStorage.removeItem("access_token")
      throw redirect({
        to: "/login",
      })
    }

    throw error
  }
}
