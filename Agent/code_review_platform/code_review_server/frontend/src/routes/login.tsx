import { zodResolver } from "@hookform/resolvers/zod"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { AuthLayout } from "@/components/Common/AuthLayout"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"

const keyFormSchema = z.object({
  key: z.string().min(1, { message: "Key is required" }),
})

const svnFormSchema = z.object({
  svn_username: z.string().min(1, { message: "SVN账号不能为空" }),
  svn_password: z.string().min(1, { message: "SVN密码不能为空" }),
})

type KeyFormData = z.infer<typeof keyFormSchema>
type SvnFormData = z.infer<typeof svnFormSchema>

export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: "登录代码审查平台 - 沛城科技代码审查平台",
      },
    ],
  }),
})

function Login() {
  const { keyLoginMutation, svnLoginMutation } = useAuth()
  const keyForm = useForm<KeyFormData>({
    resolver: zodResolver(keyFormSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      key: "",
    },
  })
  const svnForm = useForm<SvnFormData>({
    resolver: zodResolver(svnFormSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      svn_username: "",
      svn_password: "",
    },
  })

  const onKeySubmit = (data: KeyFormData) => {
    if (keyLoginMutation.isPending) return
    keyLoginMutation.mutate(data)
  }

  const onSvnSubmit = (data: SvnFormData) => {
    if (svnLoginMutation.isPending) return
    svnLoginMutation.mutate(data)
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">登录代码审查平台</h1>
        </div>

        <Tabs defaultValue="key" className="gap-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="key">Key 登录</TabsTrigger>
            <TabsTrigger value="svn">SVN 登录</TabsTrigger>
          </TabsList>

          <TabsContent value="key">
            <Form {...keyForm}>
              <form
                onSubmit={keyForm.handleSubmit(onKeySubmit)}
                className="grid gap-4"
              >
                <FormField
                  control={keyForm.control}
                  name="key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Key</FormLabel>
                      <FormControl>
                        <PasswordInput
                          data-testid="key-input"
                          placeholder="Key"
                          autoComplete="current-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <LoadingButton
                  type="submit"
                  loading={keyLoginMutation.isPending}
                >
                  登录
                </LoadingButton>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="svn">
            <Form {...svnForm}>
              <form
                onSubmit={svnForm.handleSubmit(onSvnSubmit)}
                className="grid gap-4"
              >
                <FormField
                  control={svnForm.control}
                  name="svn_username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SVN账号</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="svn-username-input"
                          placeholder="SVN账号"
                          autoComplete="username"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={svnForm.control}
                  name="svn_password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SVN密码</FormLabel>
                      <FormControl>
                        <PasswordInput
                          data-testid="svn-password-input"
                          placeholder="SVN密码"
                          autoComplete="current-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <LoadingButton
                  type="submit"
                  loading={svnLoginMutation.isPending}
                >
                  登录
                </LoadingButton>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </div>
    </AuthLayout>
  )
}
