// Note: the `PrivateService` is only available when generating the client
// for local environments.
import { OpenAPI, PrivateService } from "../../src/client"

OpenAPI.BASE = `${process.env.VITE_API_URL}`

export const uniqueSvnUsername = () =>
  `svn_${Math.random().toString(36).substring(2, 10)}`

export const createUser = async ({
  fullName,
  svnUsername,
  isSuperuser = false,
}: {
  fullName?: string
  svnUsername: string
  isSuperuser?: boolean
}) => {
  return await PrivateService.createUser({
    requestBody: {
      full_name: fullName ?? `Test User ${svnUsername}`,
      svn_username: svnUsername,
      is_superuser: isSuperuser,
    },
  })
}
