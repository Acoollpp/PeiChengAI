import type { ReviewTemplateKey } from '../shared/review-templates'
import type { SelectedReviewItemInput } from '../shared/review-items'
import { REVIEW_REPORT_FILE_NAME } from '../shared/report-artifacts'
import type {
  ClientUpdatePolicy,
  CurrentUser,
  DepartmentsResponse,
  ReviewTask,
  ReviewTaskIssue,
  ReviewTaskIssuesResponse,
  ReviewTaskStats
} from '../shared/types'

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
  review_items?: SelectedReviewItemInput[]
  review_item_ids?: string[]
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
  error_message?: string | null
}

export interface UploadReportRequest {
  report_content: string
  report_path?: string
  report_name?: string
  feedback_protocol_version?: number
  issues?: UploadReportIssueSnapshot[]
  assets?: UploadReportAsset[]
}

export interface UploadReportIssueSnapshot {
  issue_text: string
  description_text: string
  display_snapshot: string
  order: number
  source: string
  location: {
    start_offset: number
    end_offset: number
    feedback_insertion_offset: number
    anchor_line: number
    heading_level: number
  }
}

export interface UploadReportAsset {
  relative_path: string
  content: Uint8Array | ArrayBuffer | Blob
  content_type: string
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

export interface SubmitReportFeedbackRequest {
  helpful: boolean
  useful_issues_text?: string | null
}

export interface SaveIssueFeedbackDraftRequest {
  helpful: boolean | null
  feedback_text: string | null
}

export interface ReportFeedbackResult {
  id: string
  task_id: string
  user_id: string
  helpful: boolean
  useful_issues_text?: string | null
}

export interface ReviewTasksResponse {
  data: ReviewTask[]
  count: number
}

export interface ListTasksOptions {
  mine?: boolean
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
    const {
      requirement_file_path: _requirementFilePath,
      review_items: _reviewItems,
      ...requestPayload
    } = payload
    return this.request('/api/v1/review-tasks', {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify(requestPayload)
    })
  }

  listTasks(token: string, options: ListTasksOptions = {}): Promise<ReviewTasksResponse> {
    const query = options.mine ? '?mine=true' : ''
    return this.request<ReviewTasksResponse>(`/api/v1/review-tasks${query}`, {
      method: 'GET',
      headers: this.authHeaders(token)
    })
  }

  readTodayTaskStats(token: string): Promise<ReviewTaskStats> {
    return this.request<ReviewTaskStats>('/api/v1/review-tasks/stats?range=today', {
      method: 'GET',
      headers: this.authHeaders(token)
    })
  }

  readTask(token: string, taskId: string): Promise<ReviewTask> {
    return this.request<ReviewTask>(`/api/v1/review-tasks/${encodeURIComponent(taskId)}`, {
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

  checkClientUpdatePolicy(token: string, currentVersion: string): Promise<ClientUpdatePolicy> {
    const query = new URLSearchParams({ current_version: currentVersion })
    return this.request<ClientUpdatePolicy>(
      `/api/v1/client-update-policy/win32/x64/check?${query}`,
      {
        method: 'GET',
        headers: this.authHeaders(token)
      }
    )
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

    const reportBytes = await response.arrayBuffer()
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(reportBytes)
  }

  readTaskIssues(token: string, taskId: string): Promise<ReviewTaskIssuesResponse> {
    return this.request<ReviewTaskIssuesResponse>(
      `/api/v1/review-tasks/${encodeURIComponent(taskId)}/issues`,
      {
        method: 'GET',
        headers: this.authHeaders(token)
      }
    )
  }

  saveIssueFeedbackDraft(
    token: string,
    taskId: string,
    issueId: string,
    payload: SaveIssueFeedbackDraftRequest
  ): Promise<ReviewTaskIssue> {
    return this.request<ReviewTaskIssue>(
      `/api/v1/review-tasks/${encodeURIComponent(taskId)}/issues/${encodeURIComponent(issueId)}/feedback-draft`,
      {
        method: 'PUT',
        headers: this.authHeaders(token),
        body: JSON.stringify(payload)
      }
    )
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
    if (payload.feedback_protocol_version !== undefined) {
      body.set('feedback_protocol_version', String(payload.feedback_protocol_version))
      body.set('issues', JSON.stringify(payload.issues ?? []))
      const assets = payload.assets ?? []
      body.set('asset_paths', JSON.stringify(assets.map((asset) => asset.relative_path)))
      for (const asset of assets) {
        const assetBlob =
          asset.content instanceof Blob
            ? asset.content
            : new Blob([toArrayBuffer(asset.content)], { type: asset.content_type })
        body.append(
          'assets',
          new File([assetBlob], asset.relative_path.split('/').at(-1) ?? 'image', {
            type: asset.content_type
          })
        )
      }
    }

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

  uploadPdfReport(
    token: string,
    taskId: string,
    payload: UploadPdfReportRequest
  ): Promise<ReviewTask> {
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

  async downloadReportAsset(
    token: string,
    taskId: string,
    assetPath: string
  ): Promise<ArrayBuffer> {
    const encodedAssetPath = assetPath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/review-tasks/${encodeURIComponent(taskId)}/assets/${encodedAssetPath}`,
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

  submitReportFeedback(
    token: string,
    taskId: string,
    payload: SubmitReportFeedbackRequest
  ): Promise<ReportFeedbackResult> {
    return this.request(
      `/api/v1/review-tasks/${encodeURIComponent(taskId)}/report-feedback`,
      {
        method: 'POST',
        headers: this.authHeaders(token),
        body: JSON.stringify(payload)
      }
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
