import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CircleOff, ShieldAlert, Upload } from "lucide-react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  ApiError,
  ClientReleasesService,
  type ClientUpdatePolicyPublic,
  OpenAPI,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type ClientRelease = {
  id: string
  version: string
  platform?: string | null
  arch?: string | null
  release_notes?: string | null
  artifact_name?: string | null
  artifact_size?: number | null
  latest_yml_name?: string | null
  blockmap_name?: string | null
  is_active?: boolean | null
  active?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

type ClientReleasesResponse = {
  data?: ClientRelease[]
  count?: number
}

type ClientReleaseUploadInput = {
  version: string
  releaseNotes: string
  isActive: boolean
  installer: File
  latestYml: File
  blockmap: File | null
}

const DISABLED_POLICY_VALUE = "__disabled__"

function clientErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ApiError &&
    typeof error.body === "object" &&
    error.body !== null &&
    "detail" in error.body &&
    typeof error.body.detail === "string" &&
    error.body.detail.trim()
  ) {
    return error.body.detail
  }

  return error instanceof Error ? error.message : fallback
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  const headers = new Headers()

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  return headers
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as unknown
    if (
      typeof body === "object" &&
      body !== null &&
      "detail" in body &&
      typeof body.detail === "string" &&
      body.detail.trim()
    ) {
      return body.detail
    }
  } catch {
    // Use fallback below when the response body is empty or not JSON.
  }

  return fallback
}

async function readClientReleases(): Promise<ClientRelease[]> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/client-releases`, {
    headers: authHeaders(),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "加载客户端版本失败"))
  }

  const payload = (await response.json()) as
    | ClientRelease[]
    | ClientReleasesResponse
  return Array.isArray(payload) ? payload : payload.data || []
}

async function uploadClientRelease(input: ClientReleaseUploadInput) {
  const formData = new FormData()
  formData.append("version", input.version)
  formData.append("release_notes", input.releaseNotes)
  formData.append("activate", String(input.isActive))
  formData.append("installer", input.installer)
  formData.append("latest_yml", input.latestYml)

  if (input.blockmap) {
    formData.append("blockmap", input.blockmap)
  }

  const response = await fetch(`${OpenAPI.BASE}/api/v1/client-releases`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "上传客户端版本失败"))
  }

  return response.json()
}

async function activateClientRelease(releaseId: string) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/client-releases/${releaseId}/activate`,
    {
      method: "POST",
      headers: authHeaders(),
    },
  )

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "启用客户端版本失败"))
  }

  return response.json()
}

async function readClientUpdatePolicy(): Promise<ClientUpdatePolicyPublic> {
  return ClientReleasesService.readClientUpdatePolicy({
    platform: "win32",
    arch: "x64",
  })
}

async function updateClientUpdatePolicy(releaseId: string | null) {
  return ClientReleasesService.updateClientUpdatePolicy({
    platform: "win32",
    arch: "x64",
    requestBody: { minimum_supported_release_id: releaseId },
  })
}

function isClientReleaseActive(release: ClientRelease) {
  return Boolean(release.is_active ?? release.active)
}

function formatFileSize(size?: number | null) {
  if (!size) {
    return "-"
  }

  if (size < 1024) {
    return `${size} B`
  }

  const units = ["KB", "MB", "GB"]
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-"
}

function clearFileInput(input: HTMLInputElement | null) {
  if (input) {
    input.value = ""
  }
}

function ClientReleaseUploadForm() {
  const queryClient = useQueryClient()
  const installerInputRef = useRef<HTMLInputElement>(null)
  const latestYmlInputRef = useRef<HTMLInputElement>(null)
  const blockmapInputRef = useRef<HTMLInputElement>(null)
  const [version, setVersion] = useState("")
  const [releaseNotes, setReleaseNotes] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [installer, setInstaller] = useState<File | null>(null)
  const [latestYml, setLatestYml] = useState<File | null>(null)
  const [blockmap, setBlockmap] = useState<File | null>(null)

  const uploadMutation = useMutation({
    mutationFn: uploadClientRelease,
    onSuccess: async () => {
      toast.success("客户端版本已上传")
      setVersion("")
      setReleaseNotes("")
      setIsActive(true)
      setInstaller(null)
      setLatestYml(null)
      setBlockmap(null)
      clearFileInput(installerInputRef.current)
      clearFileInput(latestYmlInputRef.current)
      clearFileInput(blockmapInputRef.current)
      await queryClient.invalidateQueries({
        queryKey: ["admin", "client-releases"],
      })
      await queryClient.invalidateQueries({
        queryKey: ["admin", "client-update-policy"],
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "上传客户端版本失败")
    },
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!version.trim()) {
      toast.error("请填写版本号")
      return
    }

    if (!installer) {
      toast.error("请选择安装包exe")
      return
    }

    if (!latestYml) {
      toast.error("请选择latest.yml")
      return
    }

    uploadMutation.mutate({
      version: version.trim(),
      releaseNotes: releaseNotes.trim(),
      isActive,
      installer,
      latestYml,
      blockmap,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>上传客户端版本</CardTitle>
        <CardDescription>
          上传Windows客户端安装包、latest.yml和可选blockmap。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-6" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-release-version">版本号</Label>
            <Input
              id="client-release-version"
              value={version}
              placeholder="1.0.1"
              onChange={(event) => setVersion(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="client-release-notes">更新说明</Label>
            <Input
              id="client-release-notes"
              value={releaseNotes}
              placeholder="修复问题或新增能力"
              onChange={(event) => setReleaseNotes(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-release-active">启用状态</Label>
            <Select
              value={isActive ? "active" : "inactive"}
              onValueChange={(value) => setIsActive(value === "active")}
            >
              <SelectTrigger id="client-release-active" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inactive">暂不启用</SelectItem>
                <SelectItem value="active">上传后启用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="client-release-installer">安装包 exe</Label>
            <Input
              id="client-release-installer"
              ref={installerInputRef}
              type="file"
              accept=".exe,application/x-msdownload"
              onChange={(event) =>
                setInstaller(event.target.files?.[0] ?? null)
              }
            />
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="client-release-latest-yml">latest.yml</Label>
            <Input
              id="client-release-latest-yml"
              ref={latestYmlInputRef}
              type="file"
              accept=".yml,.yaml,application/x-yaml,text/yaml,text/plain"
              onChange={(event) =>
                setLatestYml(event.target.files?.[0] ?? null)
              }
            />
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="client-release-blockmap">blockmap（可选）</Label>
            <Input
              id="client-release-blockmap"
              ref={blockmapInputRef}
              type="file"
              accept=".blockmap,application/octet-stream"
              onChange={(event) => setBlockmap(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex items-end md:col-span-2">
            <Button type="submit" disabled={uploadMutation.isPending}>
              <Upload />
              {uploadMutation.isPending ? "上传中..." : "上传"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function ClientUpdatePolicyCard() {
  const queryClient = useQueryClient()
  const [selectedReleaseId, setSelectedReleaseId] = useState(
    DISABLED_POLICY_VALUE,
  )
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const policyQuery = useQuery({
    queryFn: readClientUpdatePolicy,
    queryKey: ["admin", "client-update-policy", "win32", "x64"],
  })
  const releasesQuery = useQuery({
    queryFn: readClientReleases,
    queryKey: ["admin", "client-releases"],
  })

  useEffect(() => {
    if (policyQuery.data) {
      setSelectedReleaseId(
        policyQuery.data.minimum_supported_release_id ?? DISABLED_POLICY_VALUE,
      )
    }
  }, [policyQuery.data])

  const updateMutation = useMutation({
    mutationFn: updateClientUpdatePolicy,
    onSuccess: async () => {
      toast.success("最低支持版本已更新")
      setIsConfirmOpen(false)
      await queryClient.invalidateQueries({
        queryKey: ["admin", "client-update-policy"],
      })
    },
    onError: (error) => {
      toast.error(clientErrorMessage(error, "调整最低支持版本失败"))
    },
  })

  const policy = policyQuery.data
  const matchingReleases = (releasesQuery.data ?? []).filter(
    (release) =>
      (release.platform ?? "win32") === "win32" &&
      (release.arch ?? "x64") === "x64",
  )
  const selectedRelease = matchingReleases.find(
    (release) => release.id === selectedReleaseId,
  )
  const selectedVersion = selectedRelease?.version ?? "未启用"
  const currentValue =
    policy?.minimum_supported_release_id ?? DISABLED_POLICY_VALUE
  const isLoading = policyQuery.isLoading || releasesQuery.isLoading
  const error = policyQuery.error ?? releasesQuery.error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-5" />
          最低支持版本
        </CardTitle>
        <CardDescription>
          独立控制登录后的强制更新门槛，不会随上传或启用版本自动变化。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        {error ? (
          <div className="text-destructive md:col-span-3">
            {clientErrorMessage(error, "加载最低支持版本失败")}
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label>当前启用版本</Label>
              <div className="font-medium text-sm">
                {isLoading ? "加载中..." : policy?.active_version || "未配置"}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="minimum-supported-release">最低支持版本</Label>
              <Select
                value={selectedReleaseId}
                disabled={isLoading || updateMutation.isPending}
                onValueChange={setSelectedReleaseId}
              >
                <SelectTrigger
                  id="minimum-supported-release"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DISABLED_POLICY_VALUE}>未启用</SelectItem>
                  {matchingReleases.map((release) => (
                    <SelectItem key={release.id} value={release.id}>
                      {release.version}
                      {isClientReleaseActive(release) ? "（当前启用）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground text-xs">
                最近调整：{formatDateTime(policy?.updated_at)}
              </span>
            </div>
            <Button
              type="button"
              disabled={
                isLoading ||
                !policy?.active_release_id ||
                selectedReleaseId === currentValue ||
                updateMutation.isPending
              }
              onClick={() => setIsConfirmOpen(true)}
            >
              调整门槛
            </Button>
          </>
        )}
      </CardContent>
      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent showCloseButton={!updateMutation.isPending}>
          <DialogHeader>
            <DialogTitle>确认调整最低支持版本</DialogTitle>
            <DialogDescription>
              当前门槛：{policy?.minimum_supported_version || "未启用"}
              ；目标门槛：
              {selectedVersion}。
              {selectedReleaseId === DISABLED_POLICY_VALUE
                ? " 调整后客户端不会因最低版本策略被强制更新。"
                : ` 低于 ${selectedVersion} 的客户端在下次登录成功后将无法进入业务页面。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={updateMutation.isPending}
              onClick={() => setIsConfirmOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={updateMutation.isPending}
              onClick={() =>
                updateMutation.mutate(
                  selectedReleaseId === DISABLED_POLICY_VALUE
                    ? null
                    : selectedReleaseId,
                )
              }
            >
              {updateMutation.isPending ? "保存中..." : "确认调整"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ClientReleasesTable() {
  const queryClient = useQueryClient()
  const {
    data: releases = [],
    error,
    isError,
    isLoading,
  } = useQuery({
    queryFn: readClientReleases,
    queryKey: ["admin", "client-releases"],
  })

  const activateMutation = useMutation({
    mutationFn: activateClientRelease,
    onSuccess: async () => {
      toast.success("客户端版本已启用")
      await queryClient.invalidateQueries({
        queryKey: ["admin", "client-releases"],
      })
      await queryClient.invalidateQueries({
        queryKey: ["admin", "client-update-policy"],
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "启用客户端版本失败")
    },
  })

  if (isLoading) {
    return <div className="text-muted-foreground">加载中...</div>
  }

  if (isError) {
    return (
      <div className="rounded-md border border-dashed p-6 text-muted-foreground">
        {error instanceof Error
          ? error.message
          : "暂时无法加载客户端版本，请确认后端API已启用。"}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>版本</TableHead>
          <TableHead>平台/架构</TableHead>
          <TableHead>安装包</TableHead>
          <TableHead>大小</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>发布时间</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {releases.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={7}
              className="h-32 text-center text-muted-foreground"
            >
              暂无客户端版本
            </TableCell>
          </TableRow>
        ) : (
          releases.map((release) => {
            const active = isClientReleaseActive(release)

            return (
              <TableRow key={release.id}>
                <TableCell className="font-medium">
                  <div>{release.version}</div>
                  <div className="max-w-56 truncate text-muted-foreground text-xs">
                    {release.release_notes || "-"}
                  </div>
                </TableCell>
                <TableCell>
                  {[release.platform, release.arch]
                    .filter(Boolean)
                    .join(" / ") || "-"}
                </TableCell>
                <TableCell>
                  <div className="max-w-64 truncate">
                    {release.artifact_name || "-"}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {release.latest_yml_name || "latest.yml"}
                    {release.blockmap_name ? ` / ${release.blockmap_name}` : ""}
                  </div>
                </TableCell>
                <TableCell>{formatFileSize(release.artifact_size)}</TableCell>
                <TableCell>
                  <Badge variant={active ? "default" : "secondary"}>
                    {active ? <CheckCircle2 /> : <CircleOff />}
                    {active ? "已启用" : "未启用"}
                  </Badge>
                </TableCell>
                <TableCell>{formatDateTime(release.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={active || activateMutation.isPending}
                    onClick={() => activateMutation.mutate(release.id)}
                  >
                    启用
                  </Button>
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}

export function AdminClientReleasesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">客户端版本</h1>
        <p className="text-muted-foreground">
          管理客户端安装包、更新元数据和当前启用版本。
        </p>
      </div>
      <ClientUpdatePolicyCard />
      <ClientReleaseUploadForm />
      <ClientReleasesTable />
    </div>
  )
}
