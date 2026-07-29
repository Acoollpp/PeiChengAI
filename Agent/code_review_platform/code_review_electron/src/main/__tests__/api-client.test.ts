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
      skill_name: '通用-代码审查-模版一'
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
        skill_name: '通用-代码审查-模版一'
      })
    })
  })

  it('serializes supplemental review input fields when creating a review task', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
    const client = new ApiClient('https://server.example', fetchMock)

    await client.createTask('token-123', {
      svn_url: 'svn://repo/project',
      old_revision: '12',
      new_revision: '14',
      requirement_file_name: '产品开发需求表.xls',
      focus_direction_id: 'direction-1',
      focus_direction_snapshot: '重点检查 SOC 跳变'
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
        requirement_file_name: '产品开发需求表.xls',
        focus_direction_id: 'direction-1',
        focus_direction_snapshot: '重点检查 SOC 跳变'
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

  it('requests only the authenticated user review tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [], count: 0 }))
    const client = new ApiClient('https://server.example', fetchMock)

    await client.listTasks('token-123', { mine: true })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/review-tasks?mine=true',
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token-123'
        }
      }
    )
  })

  it('reads current user with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'user-1',
        full_name: '张三',
        svn_username: 'zhangsan',
        department_id: null,
        department_name: null,
        role: 'user'
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.readCurrentUser('token-123')

    expect(result).toMatchObject({
      id: 'user-1',
      department_id: null
    })
    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/users/me', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token-123'
      }
    })
  })

  it('lists available departments with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'dept-1',
            name: '研发部',
            description: null,
            is_active: true
          }
        ],
        count: 1
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.listAvailableDepartments('token-123')

    expect(result).toMatchObject({
      data: [{ id: 'dept-1', name: '研发部' }],
      count: 1
    })
    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/departments/available', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token-123'
      }
    })
  })

  it('sets current user department once with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'user-1',
        full_name: '张三',
        svn_username: 'zhangsan',
        department_id: 'dept-1',
        department_name: '研发部',
        role: 'user'
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.setMyDepartment('token-123', 'dept-1')

    expect(result).toMatchObject({
      id: 'user-1',
      department_id: 'dept-1',
      department_name: '研发部'
    })
    expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/users/me/department', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token-123'
      },
      body: JSON.stringify({
        department_id: 'dept-1'
      })
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

  it('按任务读取问题快照和反馈进度', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'issue-1',
            task_id: 'task-1',
            issue_text: '高风险：空指针',
            description_text: '未校验返回值。',
            display_snapshot: '### 高风险：空指针',
            order: 0,
            source: 'template_1_heading',
            location: {
              start_offset: 0,
              end_offset: 12,
              feedback_insertion_offset: 12,
              anchor_line: 0,
              heading_level: 3
            },
            helpful: null,
            feedback_text: null
          }
        ],
        count: 1,
        evaluated_count: 0
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.readTaskIssues('token-123', 'task/1')

    expect(result.count).toBe(1)
    expect(result.evaluated_count).toBe(0)
    expect(result.data[0]?.issue_text).toBe('高风险：空指针')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/review-tasks/task%2F1/issues',
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
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
            name: '通用-代码审查-模版一',
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
      name: '通用-代码审查-模版一',
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
            name: '通用-代码审查-模版一',
            version: '2026.05.28'
          },
          {
            id: 'skill-2',
            name: '通用-代码审查-模版二',
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
              name: '通用-代码审查-模版一',
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
      data: [expect.objectContaining({ id: 'skill-1', name: '通用-代码审查-模版一' })],
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

  it('reads a review task by id with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'task-1',
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2',
      status: 'failed'
    }))
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.readTask('token-123', 'task-1')

    expect(result).toMatchObject({
      id: 'task-1',
      status: 'failed'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/review-tasks/task-1',
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token-123'
        }
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
    expect((upload as File).name).toBe('代码审查报告.md')
    expect((upload as File).type).toBe('text/markdown')
    await expect((upload as File).text()).resolves.toBe('# report\n')
  })

  it('uses custom upload report filename when report_name is provided', async () => {
    vi.stubGlobal('File', File)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
    const client = new ApiClient('https://server.example', fetchMock)

    await client.uploadReport('token-123', 'task-1', {
      report_content: '# report\n',
      report_name: '自定义报告.md'
    })

    const [, init] = fetchMock.mock.calls[0]
    const upload = init.body.get('upload')

    expect(upload).toBeInstanceOf(File)
    expect((upload as File).name).toBe('自定义报告.md')
  })

  it('上传新协议报告时发送问题快照和相对图片资产', async () => {
    vi.stubGlobal('File', File)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
    const client = new ApiClient('https://server.example', fetchMock)

    await client.uploadReport('token-123', 'task-1', {
      report_content: '# report\n',
      feedback_protocol_version: 1,
      issues: [
        {
          issue_text: '高风险：空指针',
          description_text: '未校验返回值。',
          display_snapshot: '### 高风险：空指针',
          order: 0,
          source: 'template_1_heading',
          location: {
            start_offset: 0,
            end_offset: 12,
            feedback_insertion_offset: 12,
            anchor_line: 0,
            heading_level: 3
          }
        }
      ],
      assets: [
        {
          relative_path: 'images/evidence.png',
          content: Buffer.from('png-content'),
          content_type: 'image/png'
        }
      ]
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = init.body as FormData
    expect(body.get('feedback_protocol_version')).toBe('1')
    expect(JSON.parse(String(body.get('issues')))).toEqual([
      expect.objectContaining({ issue_text: '高风险：空指针', order: 0 })
    ])
    expect(JSON.parse(String(body.get('asset_paths')))).toEqual(['images/evidence.png'])
    const assets = body.getAll('assets')
    expect(assets).toHaveLength(1)
    const uploadedAsset = assets[0] as unknown as File
    expect(uploadedAsset.name).toBe('evidence.png')
    expect(uploadedAsset.type).toBe('image/png')
    await expect(uploadedAsset.text()).resolves.toBe('png-content')
  })

  it('uploads generated PDF report as multipart form data with authorization header', async () => {
    vi.stubGlobal('File', File)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
    const client = new ApiClient('https://server.example', fetchMock)
    const pdfBytes = new Uint8Array([37, 80, 68, 70])

    await client.uploadPdfReport('token-123', 'task/1', {
      pdf_content: pdfBytes,
      pdf_name: '代码审查报告.pdf'
    })

    const [, init] = fetchMock.mock.calls[0]

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://server.example/api/v1/review-tasks/task%2F1/pdf-report'
    )
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: 'Bearer token-123'
    })
    expect(init.body).toBeInstanceOf(FormData)

    const upload = init.body.get('upload')
    expect(upload).toBeInstanceOf(File)
    expect((upload as File).name).toBe('代码审查报告.pdf')
    expect((upload as File).type).toBe('application/pdf')
    await expect((upload as File).arrayBuffer()).resolves.toEqual(pdfBytes.buffer)
  })

  it('uploads requirement file as multipart form data with Excel content type', async () => {
    vi.stubGlobal('File', File)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
    const client = new ApiClient('https://server.example', fetchMock)
    const content = new Uint8Array([1, 2, 3])

    await client.uploadRequirementFile('token-123', 'task/1', {
      file_content: content,
      file_name: '产品开发需求表.xlsx'
    })

    const [, init] = fetchMock.mock.calls[0]

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://server.example/api/v1/review-tasks/task%2F1/requirement-file'
    )
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: 'Bearer token-123'
    })
    expect(init.body).toBeInstanceOf(FormData)

    const upload = init.body.get('upload')
    expect(upload).toBeInstanceOf(File)
    expect((upload as File).name).toBe('产品开发需求表.xlsx')
    expect((upload as File).type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    await expect((upload as File).arrayBuffer()).resolves.toEqual(content.buffer)
  })

  it('downloads generated PDF report bytes with authorization header', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'application/pdf' }
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.downloadPdfReport('token-123', 'task/1')

    expect(new Uint8Array(result)).toEqual(bytes)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/review-tasks/task%2F1/pdf/download',
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer token-123'
        }
      }
    )
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
    const firstScreenshot = new File(['png-bytes'], 'screen.png', {
      type: 'image/png'
    }) as unknown as globalThis.File
    const secondScreenshot = new File(['jpeg-bytes'], 'screen-2.jpg', {
      type: 'image/jpeg'
    }) as unknown as globalThis.File

    const result = await client.submitFeedback('token-123', {
      description: '按钮点击后没有响应',
      screenshots: [firstScreenshot, secondScreenshot]
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

    const uploadedScreenshots = init.body.getAll('screenshots')
    expect(uploadedScreenshots).toHaveLength(2)
    expect(init.body.get('screenshot')).toBeNull()
    expect(uploadedScreenshots[0]).toBeInstanceOf(File)
    expect((uploadedScreenshots[0] as File).name).toBe('screen.png')
    expect((uploadedScreenshots[0] as File).type).toBe('image/png')
    await expect((uploadedScreenshots[0] as File).text()).resolves.toBe('png-bytes')
    expect(uploadedScreenshots[1]).toBeInstanceOf(File)
    expect((uploadedScreenshots[1] as File).name).toBe('screen-2.jpg')
    expect((uploadedScreenshots[1] as File).type).toBe('image/jpeg')
    await expect((uploadedScreenshots[1] as File).text()).resolves.toBe('jpeg-bytes')
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

  it('submits report feedback as JSON with authorization header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'feedback-1',
          task_id: 'task-1',
          user_id: 'user-1',
          helpful: true,
          useful_issues_text: '1. 空指针风险'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const client = new ApiClient('https://server.example', fetchMock as typeof fetch)

    const result = await client.submitReportFeedback('token-123', 'task-1', {
      helpful: true,
      useful_issues_text: '1. 空指针风险'
    })

    expect(result).toMatchObject({
      id: 'feedback-1',
      task_id: 'task-1',
      helpful: true
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/review-tasks/task-1/report-feedback',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer token-123',
          'content-type': 'application/json'
        }),
        body: JSON.stringify({
          helpful: true,
          useful_issues_text: '1. 空指针风险'
        })
      })
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
