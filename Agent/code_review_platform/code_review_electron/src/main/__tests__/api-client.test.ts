import { File } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { ApiClient, ApiError } from '../api-client'

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })

describe('ApiClient', () => {
  it('posts key login payload to the auth key login endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token'
      })
    )
    const client = new ApiClient('https://server.example/', fetchMock)

    const result = await client.keyLogin({
      access_key: 'key-123'
    })

    expect(result).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token'
    })
    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/auth/key-login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        access_key: 'key-123'
      })
    })
  })

  it('posts svn login payload to the auth login endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token'
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    await client.svnLogin({
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

  it('lists review tasks with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'task-1',
            svn_url: 'svn://repo/project',
            old_revision: '12',
            new_revision: '14',
            status: 'success',
            report_path: '/reports/task-1.md'
          }
        ],
        count: 1
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.listTasks('token-123')

    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      id: 'task-1',
      status: 'success'
    })
    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/review-tasks', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token-123'
      }
    })
  })

  it('reads a review task report as markdown text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('# Review\n\nLooks good.\n', {
        status: 200,
        headers: { 'content-type': 'text/markdown' }
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.readTaskReport('token-123', 'task/1')

    expect(result).toBe('# Review\n\nLooks good.\n')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/review-tasks/task%2F1/report',
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer token-123'
        }
      }
    )
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
    vi.stubGlobal('File', File)
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
      client.svnLogin({
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
