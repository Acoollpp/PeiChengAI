export interface TokenPair {
  access_token: string
  refresh_token: string
}

export interface RegisterRequest {
  server_url: string
  full_name: string
  svn_username: string
  svn_password: string
}

export interface LoginRequest {
  server_url: string
  svn_username: string
  svn_password: string
}

export type AuthRegisterRequest = Omit<RegisterRequest, 'server_url'>

export type AuthLoginRequest = Omit<LoginRequest, 'server_url'>

export interface CreateTaskRequest {
  svn_url: string
  old_revision: string
  new_revision: string
}

export interface UpdateTaskStatusRequest {
  status: string
  report_path?: string
  error_message?: string
}

export interface UploadReportRequest {
  report_content: string
  report_path?: string
}

export interface ActiveSkill {
  id: string
  version: string
  content_hash?: string
  hash?: string
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

export class ApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.fetchImpl = fetchImpl
  }

  register(payload: AuthRegisterRequest): Promise<TokenPair> {
    return this.request<TokenPair>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  login(payload: AuthLoginRequest): Promise<TokenPair> {
    return this.request<TokenPair>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  createTask(token: string, payload: CreateTaskRequest): Promise<unknown> {
    return this.request('/api/v1/review-tasks', {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify(payload)
    })
  }

  getSvnCredential(token: string): Promise<unknown> {
    return this.request('/api/v1/me/svn-credential', {
      method: 'GET',
      headers: this.authHeaders(token)
    })
  }

  getActiveSkill(token: string): Promise<ActiveSkill> {
    return this.request<ActiveSkill>('/api/v1/skills/active', {
      method: 'GET',
      headers: this.authHeaders(token)
    })
  }

  async downloadActiveSkill(token: string): Promise<ArrayBuffer> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/skills/active/download`, {
      method: 'GET',
      headers: this.authHeaders(token)
    })

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
      new File([payload.report_content], 'report.md', {
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

  private async request<T>(
    path: string,
    init: RequestInit,
    options: { json?: boolean } = {}
  ): Promise<T> {
    const json = options.json ?? true
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
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

  private isErrorBody(body: unknown): body is { detail: string } {
    return (
      typeof body === 'object' &&
      body !== null &&
      'detail' in body &&
      typeof body.detail === 'string'
    )
  }
}
