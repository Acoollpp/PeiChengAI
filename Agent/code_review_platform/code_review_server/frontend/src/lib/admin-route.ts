import { redirect } from "@tanstack/react-router"

import { ApiError, UsersService } from "@/client"
import {
  hasManagementPrivileges,
  hasPlatformAdminPrivileges,
} from "@/lib/authz"

export async function readCurrentUserOrRedirect() {
  try {
    const user = await UsersService.readUserMe()
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

export async function requirePlatformAdminUser() {
  const user = await readCurrentUserOrRedirect()

  if (!hasPlatformAdminPrivileges(user)) {
    throw redirect({
      to: "/",
    })
  }

  return user
}

export async function requireManagementUser() {
  const user = await readCurrentUserOrRedirect()

  if (!hasManagementPrivileges(user)) {
    throw redirect({
      to: "/",
    })
  }

  return user
}

export const requireAdminUser = requirePlatformAdminUser
