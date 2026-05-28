import { describe, expect, it, vi } from 'vitest'

import { ApiClient, ApiError } from '../api-client'

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })

describe('ApiClient', () => {
  it('posts registration payload to the auth register endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token'
      })
    )
    const client = new ApiClient('https://server.example/', fetchMock)

    const result = await client.register({
      full_name: 'Ada Lovelace',
      svn_username: 'ada',
      svn_password: 'secret'
    })

    expect(result).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token'
    })
    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        full_name: 'Ada Lovelace',
        svn_username: 'ada',
        svn_password: 'secret'
      })
    })
  })

  it('posts login payload to the auth login endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token'
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    await client.login({
      svn_username: 'ada',
      svn_password: 'secret'
    })

    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        svn_username: 'ada',
        svn_password: 'secret'
      })
    })
  })

  it('adds authorization headers when creating a review task', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
    const client = new ApiClient('https://server.example', fetchMock)

    await client.createTask('token-123', {
      svn_url: 'svn://repo/project',
      old_revision: '12',
      new_revision: '14'
    })

    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/review-tasks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token-123'
      },
      body: JSON.stringify({
        svn_url: 'svn://repo/project',
        old_revision: '12',
        new_revision: '14'
      })
    })
  })

  it('gets svn credentials with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ username: 'ada' }))
    const client = new ApiClient('https://server.example', fetchMock)

    await client.getSvnCredential('token-123')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/me/svn-credential',
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token-123'
        }
      }
    )
  })

  it('gets active skill metadata with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'skill-1',
        version: '2026.05.28',
        content_hash: 'hash-123'
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.getActiveSkill('token-123')

    expect(result).toEqual({
      id: 'skill-1',
      version: '2026.05.28',
      content_hash: 'hash-123'
    })
    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/skills/active', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token-123'
      }
    })
  })

  it('downloads active skill package bytes with authorization header', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'application/zip' }
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.downloadActiveSkill('token-123')

    expect(new Uint8Array(result)).toEqual(bytes)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/skills/active/download',
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer token-123'
        }
      }
    )
  })

  it('updates review task status with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
    const client = new ApiClient('https://server.example', fetchMock)

    await client.updateTaskStatus('token-123', 'task-1', {
      status: 'running_codex'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/review-tasks/task-1/status',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token-123'
        },
        body: JSON.stringify({
          status: 'running_codex'
        })
      }
    )
  })

  it('uploads review report as multipart form data with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
    const client = new ApiClient('https://server.example', fetchMock)

    await client.uploadReport('token-123', 'task-1', {
      report_content: '# report\n',
      report_path: '/tmp/report.md'
    })

    const [, init] = fetchMock.mock.calls[0]

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://server.example/api/v1/review-tasks/task-1/report'
    )
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: 'Bearer token-123'
    })
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('report_content')).toBeNull()
    expect(init.body.get('report_path')).toBeNull()

    const upload = init.body.get('upload')
    expect(upload).toBeInstanceOf(File)
    expect((upload as File).name).toBe('report.md')
    expect((upload as File).type).toBe('text/markdown')
    await expect((upload as File).text()).resolves.toBe('# report\n')
  })

  it('throws an ApiError containing http status for failed responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: 'Invalid credentials'
        },
        {
          status: 401,
          statusText: 'Unauthorized'
        }
      )
    )
    const client = new ApiClient('https://server.example', fetchMock)

    await expect(
      client.login({
        svn_username: 'ada',
        svn_password: 'wrong'
      })
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'HTTP 401: Invalid credentials'
    } satisfies Partial<ApiError>)
  })
})
