import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { CredentialsService, type SvnCredential } from "@/client"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { PasswordInput } from "@/components/ui/password-input"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const formSchema = z.object({
  svn_username: z.string().trim().min(1, { message: "SVN账号不能为空" }),
  svn_password: z.string().min(1, { message: "SVN密码不能为空" }),
})

type FormData = z.infer<typeof formSchema>

const SvnCredentialForm = () => {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      svn_username: currentUser?.svn_username ?? "",
      svn_password: "",
    },
  })

  const mutation = useMutation({
    mutationFn: (data: SvnCredential) =>
      CredentialsService.updateMySvnCredential({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("SVN凭据已更新")
      form.reset({
        svn_username: form.getValues("svn_username"),
        svn_password: "",
      })
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries()
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate(data)
  }

  return (
    <div className="max-w-md">
      <h3 className="text-lg font-semibold py-4">SVN凭据</h3>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="svn_username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>SVN账号</FormLabel>
                <FormControl>
                  <Input
                    data-testid="svn-username-input"
                    className="font-mono"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="svn_password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>SVN密码</FormLabel>
                <FormControl>
                  <PasswordInput
                    data-testid="svn-password-input"
                    autoComplete="new-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <LoadingButton
            type="submit"
            loading={mutation.isPending}
            disabled={!form.formState.isDirty}
            className="self-start"
          >
            保存
          </LoadingButton>
        </form>
      </Form>
    </div>
  )
}

export default SvnCredentialForm
