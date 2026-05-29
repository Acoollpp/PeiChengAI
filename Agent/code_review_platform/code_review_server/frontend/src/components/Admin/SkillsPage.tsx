import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CircleOff, Upload } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"

import { OpenAPI } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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

type Skill = {
  id: string
  name: string
  version?: string | null
  description?: string | null
  content_hash?: string | null
  file_size?: number | null
  is_active?: boolean | null
  active?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

type SkillsResponse = {
  data?: Skill[]
  count?: number
}

type SkillUploadInput = {
  file: File
  name: string
  version: string
  description: string
  isActive: boolean
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  const headers = new Headers()

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  return headers
}

async function readSkills(): Promise<Skill[]> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/skills`, {
    headers: authHeaders(),
  })

  if (!response.ok) {
    throw new Error("Failed to load skills")
  }

  const payload = (await response.json()) as Skill[] | SkillsResponse
  return Array.isArray(payload) ? payload : payload.data || []
}

async function uploadSkill(input: SkillUploadInput) {
  const formData = new FormData()
  formData.append("upload", input.file)
  formData.append("name", input.name)
  formData.append("version", input.version)
  formData.append("description", input.description)
  formData.append("activate", String(input.isActive))

  const response = await fetch(`${OpenAPI.BASE}/api/v1/skills`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  })

  if (!response.ok) {
    throw new Error("Failed to upload skill")
  }

  return response.json()
}

async function activateSkill(skillId: string) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/skills/${skillId}/activate`,
    {
      method: "POST",
      headers: authHeaders(),
    },
  )

  if (!response.ok) {
    throw new Error("Failed to activate skill")
  }

  return response.json()
}

function isSkillActive(skill: Skill) {
  return Boolean(skill.is_active ?? skill.active)
}

function SkillUploadForm() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("通用-代码变更审查")
  const [version, setVersion] = useState("")
  const [description, setDescription] = useState("")
  const [isActive, setIsActive] = useState(true)

  const uploadMutation = useMutation({
    mutationFn: uploadSkill,
    onSuccess: async () => {
      toast.success("Skill已上传")
      setFile(null)
      setName("通用-代码变更审查")
      setVersion("")
      setDescription("")
      setIsActive(true)
      await queryClient.invalidateQueries({ queryKey: ["admin", "skills"] })
    },
    onError: () => {
      toast.error("上传失败，请稍后重试")
    },
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!file) {
      toast.error("请选择zip包")
      return
    }

    if (!name.trim()) {
      toast.error("请填写Skill名称")
      return
    }

    if (!version.trim()) {
      toast.error("请填写版本")
      return
    }

    uploadMutation.mutate({
      file,
      name: name.trim(),
      version,
      description,
      isActive,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>上传Skill</CardTitle>
        <CardDescription>
          上传zip包，并填写版本、描述和激活状态。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-5" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2 md:col-span-1">
            <Label htmlFor="skill-file">zip包</Label>
            <Input
              id="skill-file"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-name">名称</Label>
            <Input
              id="skill-name"
              value={name}
              placeholder="通用-代码变更审查"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-version">版本</Label>
            <Input
              id="skill-version"
              value={version}
              placeholder="v1.0.0"
              onChange={(event) => setVersion(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-description">描述</Label>
            <Input
              id="skill-description"
              value={description}
              placeholder="适用场景"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-active">激活状态</Label>
            <Select
              value={isActive ? "active" : "inactive"}
              onValueChange={(value) => setIsActive(value === "active")}
            >
              <SelectTrigger id="skill-active" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inactive">暂不激活</SelectItem>
                <SelectItem value="active">上传后激活</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex md:col-span-5">
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

function SkillsTable() {
  const queryClient = useQueryClient()
  const {
    data: skills = [],
    isError,
    isLoading,
  } = useQuery({
    queryFn: readSkills,
    queryKey: ["admin", "skills"],
  })

  const activateMutation = useMutation({
    mutationFn: activateSkill,
    onSuccess: async () => {
      toast.success("Skill已激活")
      await queryClient.invalidateQueries({ queryKey: ["admin", "skills"] })
    },
    onError: () => {
      toast.error("激活失败，请稍后重试")
    },
  })

  if (isLoading) {
    return <div className="text-muted-foreground">加载中...</div>
  }

  if (isError) {
    return (
      <div className="rounded-md border border-dashed p-6 text-muted-foreground">
        暂时无法加载Skill库，请确认后端API已启用。
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>名称</TableHead>
          <TableHead>版本</TableHead>
          <TableHead>描述</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {skills.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={5}
              className="h-32 text-center text-muted-foreground"
            >
              暂无Skill
            </TableCell>
          </TableRow>
        ) : (
          skills.map((skill) => {
            const active = isSkillActive(skill)

            return (
              <TableRow key={skill.id}>
                <TableCell className="font-medium">{skill.name}</TableCell>
                <TableCell>{skill.version || "-"}</TableCell>
                <TableCell className="max-w-md truncate text-muted-foreground">
                  {skill.description || "-"}
                </TableCell>
                <TableCell>
                  <Badge variant={active ? "default" : "secondary"}>
                    {active ? <CheckCircle2 /> : <CircleOff />}
                    {active ? "已激活" : "未激活"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={active || activateMutation.isPending}
                    onClick={() => activateMutation.mutate(skill.id)}
                  >
                    激活
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

export function AdminSkillsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Skill库</h1>
        <p className="text-muted-foreground">
          管理审查Skill包、版本和启用状态。
        </p>
      </div>
      <SkillUploadForm />
      <SkillsTable />
    </div>
  )
}
