import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import {
  type KeyLogin,
  LoginService,
  type SvnLogin,
  type UserPublic,
  UsersService,
} from "@/client"
import { handleError } from "@/utils"
import useCustomToast from "./useCustomToast"

const isLoggedIn = () => {
  return localStorage.getItem("access_token") !== null
}

const useAuth = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const { data: user } = useQuery<UserPublic | null, Error>({
    queryKey: ["currentUser"],
    queryFn: UsersService.readUserMe,
    enabled: isLoggedIn(),
  })

  const clearSessionQueries = () => {
    queryClient.setQueryData(["currentUser"], null)
    queryClient.removeQueries({ queryKey: ["currentUser"] })
    queryClient.removeQueries({ queryKey: ["review-task-stats"] })
    queryClient.removeQueries({ queryKey: ["review-tasks"] })
  }

  const onLoginSuccess = async (token: string) => {
    clearSessionQueries()
    localStorage.setItem("access_token", token)
    await queryClient.invalidateQueries({ queryKey: ["currentUser"] })
    navigate({ to: "/" })
  }

  const keyLoginMutation = useMutation({
    mutationFn: (data: KeyLogin) =>
      LoginService.loginWithKey({ requestBody: data }),
    onSuccess: (response) => onLoginSuccess(response.access_token),
    onError: handleError.bind(showErrorToast),
  })

  const svnLoginMutation = useMutation({
    mutationFn: (data: SvnLogin) =>
      LoginService.loginSvnAccount({ requestBody: data }),
    onSuccess: (response) => onLoginSuccess(response.access_token),
    onError: handleError.bind(showErrorToast),
  })

  const logout = () => {
    localStorage.removeItem("access_token")
    clearSessionQueries()
    navigate({ to: "/login" })
  }

  return {
    keyLoginMutation,
    svnLoginMutation,
    logout,
    user,
  }
}

export { isLoggedIn }
export default useAuth
