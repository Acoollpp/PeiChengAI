import type { ReviewTemplateKey } from '../shared/review-templates'
import { REVIEW_REPORT_FILE_NAME } from '../shared/report-artifacts'
import type { CurrentUser, DepartmentsResponse, ReviewTask } from '../shared/types'

export interface TokenPair {
  access_token: string
  refresh_token: string
}

export interface KeyLoginRequest {
  server_url: string
  key: string
}

export interface SvnLoginRequest {
  server_url: string
  svn_username: string
  svn_password: string
}

export type AuthKeyLoginRequest = Omit<KeyLoginRequest, 'server_url'>

export type AuthSvnLoginRequest = Omit<SvnLoginRequest, 'server_url'>

export interface CreateTaskRequest {
  svn_url: string
  old_revision: string
  new_revision: string
  template_key?: ReviewTemplateKey
  skill_name?: string
  requirement_file_path?: string
  requirement_file_name?: string
  focus_direction_id?: string
  focus_direction_snapshot?: string
}

export interface UpdateTaskStatusRequest {
  status: string
  report_path?: string
  error_message?: string
}

export interface UploadReportRequest {
  report_content: string
  report_path?: string
  report_name?: string
}

export interface UploadPdfReportRequest {
  pdf_content: Uint8Array | ArrayBuffer | Blob
  pdf_name?: string
}

export interface UploadRequirementFileRequest {
  file_content: Uint8Array | ArrayBuffer | Blob
  file_name: string
}

export interface SubmitFeedbackRequest {
  description: string
  screenshots?: Array<File | Blob>
  screenshotNames?: string[]
}

export interface FeedbackResult {
  id: string
  status: 'pending' | 'processing' | 'resolved'
}

export interface ReviewTasksResponse {
  data: ReviewTask[]
  count: number
}

export interface ActiveSkill {
  id: string
  name: string
  version: string
  content_hash?: string
  file_size?: number
  hash?: string
  is_active?: boolean
}

export interface ActiveSkillsResponse {
  data: ActiveSkill[]
  count: number
}

type FetchLike = typeof fetch

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(`HTTP ${status}: ${message}`)
    this.name = 'ApiError'
    this.status = status
  }
}

export class ApiConnectionError extends Error {
  readonly url: string

  constructor(url: string, error: unknown) {
    super(`无法连接服务端 ${url}：${formatConnectionError(error)}`)
    this.name = 'ApiConnectionError'
    this.url = url
  }
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.fetchImpl = fetchImpl
  }

  keyLogin(payload: AuthKeyLoginRequest): Promise<TokenPair> {
    return this.request<TokenPair>('/api/v1/auth/key-login', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  svnLogin(payload: AuthSvnLoginRequest): Promise<TokenPair> {
    return this.request<TokenPair>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  createTask(token: string, payload: CreateTaskRequest): Promise<unknown> {
    const { requirement_file_path: _requirementFilePath, ...requestPayload } = payload
    return this.request('/api/v1/review-tasks', {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify(requestPayload)
    })
  }

  listTasks(token: string): Promise<ReviewTasksResponse> {
    return this.request<ReviewTasksResponse>('/api/v1/review-tasks', {
      method: 'GET',
      headers: this.authHeaders(token)
    })
  }

  readCurrentUser(token: string): Promise<CurrentUser> {
    return this.request<CurrentUser>('/api/v1/users/me', {
      method: 'GET',
      headers: this.authHeaders(token)
    })
  }

  listAvailableDepartments(token: string): Promise<DepartmentsResponse> {
    return this.request<DepartmentsResponse>('/api/v1/departments/available', {
      method: 'GET',
      headers: this.authHeaders(token)
    })
  }

  setMyDepartment(token: string, departmentId: string): Promise<CurrentUser> {
    return this.request<CurrentUser>('/api/v1/users/me/department', {
      method: 'PATCH',
      headers: this.authHeaders(token),
      body: JSON.stringify({
        department_id: departmentId
      })
    })
  }

  async readTaskReport(token: string, taskId: string): Promise<string> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/review-tasks/${encodeURIComponent(taskId)}/report`,
      {
        method: 'GET',
        headers: this.authHeaders(token)
      }
    )

    if (!response.ok) {
      throw new ApiError(response.status, await this.readErrorMessage(response))
    }

    return response.text()
  }

  getSvnCredential(token: string): Promise<unknown> {
    return this.request('/api/v1/me/svn-credential', {
      method: 'GET',
      headers: this.authHeaders(token)
    })
  }

  updateSvnCredential(
    token: string,
    body: { svn_username: string; svn_password: string }
  ): Promise<{ svn_username: string; svn_password: string }> {
    return this.request('/api/v1/me/svn-credential', {
      method: 'PUT',
      headers: this.authHeaders(token),
      body: JSON.stringify(body)
    })
  }

  async getActiveSkill(token: string): Promise<ActiveSkill> {
    const response = await this.getActiveSkills(token)

    if (response.count === 0 || response.data.length === 0) {
      throw new Error('No active skill is configured')
    }
    if (response.count > 1 || response.data.length > 1) {
      throw new Error('Multiple active skills are configured; use getActiveSkills instead')
    }

    return response.data[0]
  }

  getActiveSkills(token: string): Promise<ActiveSkillsResponse> {
    return this.request<ActiveSkillsResponse>('/api/v1/skills/active', {
      method: 'GET',
      headers: this.authHeaders(token)
    })
  }

  async downloadActiveSkill(token: string): Promise<ArrayBuffer> {
    // 兼容旧的单 active Skill 下载入口；Task 5 会迁移到 downloadSkill(id)。
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/skills/active/download`, {
      method: 'GET',
      headers: this.authHeaders(token)
    })

    if (!response.ok) {
      throw new ApiError(response.status, await this.readErrorMessage(response))
    }

    return response.arrayBuffer()
  }

  async downloadSkill(token: string, skillId: string): Promise<ArrayBuffer> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/download`,
      {
        method: 'GET',
        headers: this.authHeaders(token)
      }
    )

    if (!response.ok) {
      throw new ApiError(response.status, await this.readErrorMessage(response))
    }

    return response.arrayBuffer()
  }

  updateTaskStatus(
    token: string,
    taskId: string,
    payload: UpdateTaskStatusRequest
  ): Promise<unknown> {
    return this.request(`/api/v1/review-tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'PATCH',
      headers: this.authHeaders(token),
      body: JSON.stringify(payload)
    })
  }

  uploadReport(token: string, taskId: string, payload: UploadReportRequest): Promise<unknown> {
    const body = new FormData()
    body.set(
      'upload',
      new File([payload.report_content], payload.report_name ?? REVIEW_REPORT_FILE_NAME, {
        type: 'text/markdown'
      })
    )

    return this.request(
      `/api/v1/review-tasks/${encodeURIComponent(taskId)}/report`,
      {
        method: 'POST',
        headers: this.authHeaders(token),
        body
      },
      { json: false }
    )
  }

  uploadPdfReport(token: string, taskId: string, payload: UploadPdfReportRequest): Promise<unknown> {
    const body = new FormData()
    const pdfBlob =
      payload.pdf_content instanceof Blob
        ? payload.pdf_content
        : new Blob([toArrayBuffer(payload.pdf_content)], { type: 'application/pdf' })
    body.set(
      'upload',
      new File([pdfBlob], payload.pdf_name ?? '代码审查报告.pdf', {
        type: 'application/pdf'
      })
    )

    return this.request(
      `/api/v1/review-tasks/${encodeURIComponent(taskId)}/pdf-report`,
      {
        method: 'POST',
        headers: this.authHeaders(token),
        body
      },
      { json: false }
    )
  }

  uploadRequirementFile(
    token: string,
    taskId: string,
    payload: UploadRequirementFileRequest
  ): Promise<unknown> {
    const body = new FormData()
    const requirementBlob =
      payload.file_content instanceof Blob
        ? payload.file_content
        : new Blob([toArrayBuffer(payload.file_content)], { type: contentTypeForRequirementFile(payload.file_name) })
    body.set(
      'upload',
      new File([requirementBlob], payload.file_name, {
        type: contentTypeForRequirementFile(payload.file_name)
      })
    )

    return this.request(
      `/api/v1/review-tasks/${encodeURIComponent(taskId)}/requirement-file`,
      {
        method: 'POST',
        headers: this.authHeaders(token),
        body
      },
      { json: false }
    )
  }

  async downloadPdfReport(token: string, taskId: string): Promise<ArrayBuffer> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/review-tasks/${encodeURIComponent(taskId)}/pdf/download`,
      {
        method: 'GET',
        headers: this.authHeaders(token)
      }
    )

    if (!response.ok) {
      throw new ApiError(response.status, await this.readErrorMessage(response))
    }

    return response.arrayBuffer()
  }

  submitFeedback(token: string, payload: SubmitFeedbackRequest): Promise<FeedbackResult> {
    const body = new FormData()
    body.set('description', payload.description)

    payload.screenshots?.forEach((screenshot, index) => {
      const screenshotName = payload.screenshotNames?.[index]
      if (screenshotName) {
        body.append('screenshots', screenshot, screenshotName)
      } else {
        body.append('screenshots', screenshot)
      }
    })

    return this.request(
      '/api/v1/feedback',
      {
        method: 'POST',
        headers: this.authHeaders(token),
        body
      },
      { json: false }
    )
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    options: { json?: boolean } = {}
  ): Promise<T> {
    const json = options.json ?? true
    const url = `${this.baseUrl}${path}`
    const response = await this.fetchWithConnectionError(url, {
      ...init,
      headers: {
        ...(json ? { 'content-type': 'application/json' } : {}),
        ...init.headers
      }
    })

    if (!response.ok) {
      throw new ApiError(response.status, await this.readErrorMessage(response))
    }

    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  }

  private authHeaders(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`
    }
  }

  private async readErrorMessage(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as unknown

      if (this.isErrorBody(body)) {
        return body.detail
      }
    } catch {
      // Fall back to the response status text below.
    }

    return response.statusText || 'Request failed'
  }

  private async fetchWithConnectionError(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init)
    } catch (error) {
      throw new ApiConnectionError(url, error)
    }
  }

  private isErrorBody(body: unknown): body is { detail: string } {
    return (
      typeof body === 'object' &&
      body !== null &&
      'detail' in body &&
      typeof body.detail === 'string'
    )
  }
}

function toArrayBuffer(value: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value
  }

  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

function contentTypeForRequirementFile(fileName: string): string {
  return fileName.toLowerCase().endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/vnd.ms-excel'
}

function formatConnectionError(error: unknown): string {
  if (error instanceof Error) {
    const cause = getErrorCauseMessage(error)
    return cause ? `${error.message} (${cause})` : error.message
  }

  return String(error)
}

function getErrorCauseMessage(error: Error): string | null {
  const cause = error.cause
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === 'string') {
    return cause
  }

  return null
}
