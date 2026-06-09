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
      key: 'sk-cch-test'
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
        key: 'sk-cch-test'
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

  it('serializes review template fields when creating a review task', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
    const client = new ApiClient('https://server.example', fetchMock)

    await client.createTask('token-123', {
      svn_url: 'svn://repo/project',
      old_revision: '12',
      new_revision: '14',
      template_key: 'template_1',
      skill_name: '通用-代码变更审查-模板一'
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
        new_revision: '14',
        template_key: 'template_1',
        skill_name: '通用-代码变更审查-模板一'
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
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.28',
            content_hash: 'hash-123'
          }
        ],
        count: 1
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.getActiveSkill('token-123')

    expect(result).toEqual({
      id: 'skill-1',
      name: '通用-代码变更审查-模板一',
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

  it('rejects getActiveSkill when multiple active skills are configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.28'
          },
          {
            id: 'skill-2',
            name: '通用-代码变更审查-模板二',
            version: '2026.05.28'
          }
        ],
        count: 2
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    await expect(client.getActiveSkill('token-123')).rejects.toThrow('Multiple active skills')
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

  it('gets active skill list with authorization header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'skill-1',
              name: '通用-代码变更审查-模板一',
              version: '1.0.0',
              content_hash: 'hash-1',
              file_size: 100,
              is_active: true
            }
          ],
          count: 1
        })
      )
    )
    const client = new ApiClient('https://server.example', fetchMock)

    await expect(client.getActiveSkills('token-123')).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'skill-1', name: '通用-代码变更审查-模板一' })],
      count: 1
    })
    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/skills/active', {
      method: 'GET',
      headers: { authorization: 'Bearer token-123', 'content-type': 'application/json' }
    })
  })

  it('downloads a skill package by id with authorization header', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fetchMock = vi.fn(async () => new Response(bytes))
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.downloadSkill('token-123', 'skill-1')

    expect(new Uint8Array(result)).toEqual(bytes)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/skills/skill-1/download',
      {
        method: 'GET',
        headers: { authorization: 'Bearer token-123' }
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

  it('submits feedback as multipart form data with authorization header', async () => {
    vi.stubGlobal('File', File)
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'feedback-1',
        status: 'pending'
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)
    const screenshot = new File(['png-bytes'], 'screen.png', {
      type: 'image/png'
    }) as unknown as globalThis.File

    const result = await client.submitFeedback('token-123', {
      description: '按钮点击后没有响应',
      screenshot
    })

    const [, init] = fetchMock.mock.calls[0]

    expect(result).toEqual({
      id: 'feedback-1',
      status: 'pending'
    })
    expect(fetchMock.mock.calls[0][0]).toBe('https://server.example/api/v1/feedback')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: 'Bearer token-123'
    })
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('description')).toBe('按钮点击后没有响应')

    const uploadedScreenshot = init.body.get('screenshot')
    expect(uploadedScreenshot).toBeInstanceOf(File)
    expect((uploadedScreenshot as File).name).toBe('screen.png')
    expect((uploadedScreenshot as File).type).toBe('image/png')
    await expect((uploadedScreenshot as File).text()).resolves.toBe('png-bytes')
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

  it('updates svn credentials via PUT with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        svn_username: 'ada',
        svn_password: 'secret'
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.updateSvnCredential('token-123', {
      svn_username: 'ada',
      svn_password: 'secret'
    })

    expect(result).toEqual({
      svn_username: 'ada',
      svn_password: 'secret'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/me/svn-credential',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token-123'
        },
        body: JSON.stringify({
          svn_username: 'ada',
          svn_password: 'secret'
        })
      }
    )
  })

  it('adds the request URL and network cause to failed fetch errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new TypeError('fetch failed', {
        cause: new Error('socket closed')
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    await expect(
      client.keyLogin({
        key: 'sk-cch-test'
      })
    ).rejects.toThrow(
      '无法连接服务端 https://server.example/api/v1/auth/key-login：fetch failed (socket closed)'
    )
  })
})
