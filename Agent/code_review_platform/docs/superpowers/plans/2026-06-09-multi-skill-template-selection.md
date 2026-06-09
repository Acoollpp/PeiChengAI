# 多 Skill 激活与客户端报告模板选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让服务端支持多个激活 Skill，客户端严格同步激活 Skill 集合，并在新建审查任务时通过同一行“模板一 / 模板二”单选项强制启动对应 Skill，报告输出为 `代码审查报告.md` 并保留图片相对路径读取能力。

**Architecture:** 服务端继续以 `SkillPackage.is_active` 作为激活集合标记，但激活同名新版本时只替换同名旧版本，不影响其他不同名 Skill。Electron 客户端把固定模板配置放在共享模块中，环境检查同步所有服务端激活 Skill 并清理不再激活的本地 Skill；任务执行时把模板 key、Skill 名称、报告路径和图片目录传入 Codex prompt。

**Tech Stack:** FastAPI、SQLModel、Alembic、pytest、Electron、React、TypeScript、Vitest、Codex CLI。

---

## 文件结构

服务端文件：

- `code_review_server/backend/app/services/skill_service.py`：维护 Skill 上传、读取、激活、取消激活和激活列表查询逻辑。
- `code_review_server/backend/app/api/routes/skills.py`：暴露多 active Skill 列表、按 ID 下载、激活、取消激活接口。
- `code_review_server/backend/app/models.py`：给 `ReviewTask`、`ReviewTaskCreate`、`ReviewTaskPublic` 增加 `template_key` 和 `skill_name`。
- `code_review_server/backend/app/alembic/versions/6e2a4d8b9f10_add_review_task_template_fields.py`：给 `review_task` 表增加 nullable 字段。
- `code_review_server/backend/app/api/routes/review_tasks.py`：创建任务时保存模板字段，历史任务返回模板字段。
- `code_review_server/backend/tests/api/routes/test_skills.py`：覆盖多 active、同名替换、取消激活、按 ID 下载。
- `code_review_server/backend/tests/api/routes/test_review_tasks.py`：覆盖模板字段保存、旧 payload 兼容。

客户端主进程文件：

- `code_review_electron/src/shared/review-templates.ts`：固定模板配置、模板 key 类型、按 key 查 Skill 名称、必需 Skill 名称列表。
- `code_review_electron/src/shared/types.ts`：给 `ReviewTask` 增加 `template_key`、`skill_name`。
- `code_review_electron/src/main/api-client.ts`：获取多个 active skills，按 ID 下载 Skill，创建任务 payload 增加模板字段。
- `code_review_electron/src/main/codex-skill-installer.ts`：增强安装提示词，新增删除同名 Skill 提示词和执行函数。
- `code_review_electron/src/main/skill-sync.ts`：manifest 改为多 Skill，安装所有 active Skill，删除不再 active 的本地 Skill。
- `code_review_electron/src/main/environment-checker.ts`：检查多 Skill manifest，并要求模板一、模板二对应 Skill 均已同步。
- `code_review_electron/src/main/runtime-paths.ts`：报告路径改为 `代码审查报告.md`，新增图片目录路径。
- `code_review_electron/src/main/codex-runner.ts`：prompt 增加 `skillName`、`imagesDir`，强制使用所选 Skill。
- `code_review_electron/src/main/task-agent.ts`：把模板字段、Skill 名称和图片目录传入 Codex 执行流程。
- `code_review_electron/src/main/ipc.ts`：沿用现有 `task:execute`，确保同步和下载报告使用新报告路径。

客户端渲染进程文件：

- `code_review_electron/src/renderer/src/code-review-api.ts`：`ExecuteTaskRequest` 增加 `template_key`、`skill_name`。
- `code_review_electron/src/preload/index.ts`：类型随 `ExecuteTaskRequest` 变更，不需要新增 IPC 通道。
- `code_review_electron/src/renderer/src/components/TaskForm.tsx`：保留 SVN URL、旧版本号、新版本号，新增同一行模板单选项。
- `code_review_electron/src/renderer/src/components/TaskPage.tsx`：待提交任务保留模板字段。
- `code_review_electron/src/renderer/src/styles.css`：新增模板单选项的同一行布局。

客户端测试文件：

- `code_review_electron/src/main/__tests__/api-client.test.ts`
- `code_review_electron/src/main/__tests__/codex-skill-installer.test.ts`
- `code_review_electron/src/main/__tests__/skill-sync.test.ts`
- `code_review_electron/src/main/__tests__/environment-checker.test.ts`
- `code_review_electron/src/main/__tests__/runtime-paths.test.ts`
- `code_review_electron/src/main/__tests__/codex-runner.test.ts`
- `code_review_electron/src/main/__tests__/task-agent.test.ts`
- `code_review_electron/src/main/__tests__/ipc.test.ts`
- `code_review_electron/src/preload/index.test.ts`
- `code_review_electron/src/renderer/src/components/TaskForm.test.tsx`
- `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`

---

### Task 1: 服务端 Skill 支持多激活、取消激活和按 ID 下载

**Files:**
- Modify: `code_review_server/backend/app/services/skill_service.py`
- Modify: `code_review_server/backend/app/api/routes/skills.py`
- Test: `code_review_server/backend/tests/api/routes/test_skills.py`

- [x] **Step 1: 写失败测试，验证 active 列表返回多个不同名 Skill**

在 `code_review_server/backend/tests/api/routes/test_skills.py` 增加辅助函数和测试。保留现有 `_skill_zip()`，新增：

```python
def _upload_skill(
    client: TestClient,
    headers: dict[str, str],
    *,
    name: str,
    version: str,
    activate: str = "true",
) -> dict[str, object]:
    response = client.post(
        f"{settings.API_V1_STR}/skills",
        headers=headers,
        data={"name": name, "version": version, "activate": activate},
        files={"upload": ("skill.zip", _skill_zip(), "application/zip")},
    )
    assert response.status_code == 200
    return response.json()


def test_active_skills_returns_all_different_active_skill_names(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))

    first = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
    )
    second = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板二",
        version="1.0.0",
    )

    response = client.get(
        f"{settings.API_V1_STR}/skills/active",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["count"] == 2
    assert {skill["id"] for skill in content["data"]} == {first["id"], second["id"]}
    assert {skill["name"] for skill in content["data"]} == {
        "通用-代码变更审查-模板一",
        "通用-代码变更审查-模板二",
    }
```

- [x] **Step 2: 写失败测试，验证同名新版本激活会取消旧同名版本**

在同一测试文件增加：

```python
def test_activating_same_name_replaces_only_previous_same_name_active_skill(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))

    old_same_name = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
    )
    other_name = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板二",
        version="1.0.0",
    )
    new_same_name = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.1",
        activate="false",
    )

    response = client.post(
        f"{settings.API_V1_STR}/skills/{new_same_name['id']}/activate",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    active_response = client.get(
        f"{settings.API_V1_STR}/skills/active",
        headers=normal_user_token_headers,
    )
    active_ids = {skill["id"] for skill in active_response.json()["data"]}
    assert active_ids == {new_same_name["id"], other_name["id"]}
    assert old_same_name["id"] not in active_ids
```

- [x] **Step 3: 写失败测试，验证管理员可以取消激活并按 ID 下载**

在同一测试文件增加：

```python
def test_admin_can_deactivate_skill_and_download_by_id(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))
    uploaded = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
    )

    download_response = client.get(
        f"{settings.API_V1_STR}/skills/{uploaded['id']}/download",
        headers=normal_user_token_headers,
    )
    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith("application/zip")

    deactivate_response = client.post(
        f"{settings.API_V1_STR}/skills/{uploaded['id']}/deactivate",
        headers=superuser_token_headers,
    )
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["is_active"] is False

    active_response = client.get(
        f"{settings.API_V1_STR}/skills/active",
        headers=normal_user_token_headers,
    )
    assert active_response.status_code == 200
    assert active_response.json() == {"data": [], "count": 0}
```

- [x] **Step 4: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_skills.py -q
```

Expected: FAIL，原因包括 `/skills/active` 返回单对象、没有 `/{skill_id}/download`、没有 `deactivate` 接口。

- [x] **Step 5: 实现 Skill service 多激活逻辑**

在 `code_review_server/backend/app/services/skill_service.py` 替换激活查询逻辑：

```python
def activate_skill(session: Session, skill: SkillPackage) -> SkillPackage:
    active_same_name_skills = session.exec(
        select(SkillPackage).where(
            SkillPackage.is_active == True,  # noqa: E712
            SkillPackage.name == skill.name,
            SkillPackage.id != skill.id,
        )
    ).all()
    now = get_datetime_utc()
    for active_skill in active_same_name_skills:
        active_skill.is_active = False
        active_skill.updated_at = now
        session.add(active_skill)

    skill.is_active = True
    skill.updated_at = now
    session.add(skill)
    session.commit()
    session.refresh(skill)
    return skill


def deactivate_skill(session: Session, skill: SkillPackage) -> SkillPackage:
    skill.is_active = False
    skill.updated_at = get_datetime_utc()
    session.add(skill)
    session.commit()
    session.refresh(skill)
    return skill


def get_active_skills(session: Session) -> list[SkillPackage]:
    return session.exec(
        select(SkillPackage)
        .where(SkillPackage.is_active == True)  # noqa: E712
        .order_by(col(SkillPackage.updated_at).desc())
    ).all()
```

删除或停止使用旧的 `get_active_skill()`。

- [x] **Step 6: 实现 Skill routes**

在 `code_review_server/backend/app/api/routes/skills.py`：

```python
@router.post(
    "/{skill_id}/deactivate",
    dependencies=[Depends(get_current_active_admin)],
    response_model=SkillPackagePublic,
)
def deactivate_skill(session: SessionDep, skill_id: uuid.UUID) -> Any:
    skill = _get_skill_or_404(session, skill_id)
    return skill_service.deactivate_skill(session, skill)


@router.get("/active", response_model=SkillPackagesPublic)
def read_active_skills(session: SessionDep, _current_user: CurrentUser) -> Any:
    skills = skill_service.get_active_skills(session)
    return SkillPackagesPublic(
        data=[SkillPackagePublic.model_validate(skill) for skill in skills],
        count=len(skills),
    )


@router.get("/{skill_id}/download")
def download_skill(
    session: SessionDep, _current_user: CurrentUser, skill_id: uuid.UUID
) -> Response:
    skill = _get_skill_or_404(session, skill_id)
    return Response(
        skill_service.read_skill_content(skill),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="skill.zip"'},
    )
```

移除 `_get_active_skill_or_404()`、旧 `download_active_skill()`，并更新旧测试中对 `/skills/active` 的断言为列表结构。

- [x] **Step 7: 运行服务端 Skill 测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_skills.py -q
```

Expected: PASS。

- [x] **Step 8: 提交**

```bash
git add code_review_server/backend/app/services/skill_service.py code_review_server/backend/app/api/routes/skills.py code_review_server/backend/tests/api/routes/test_skills.py
git commit -m "支持服务端多Skill激活"
```

---

### Task 2: 服务端任务记录保存模板 key 和 Skill 名称

**Files:**
- Modify: `code_review_server/backend/app/models.py`
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Create: `code_review_server/backend/app/alembic/versions/6e2a4d8b9f10_add_review_task_template_fields.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`

- [x] **Step 1: 写失败测试，验证创建任务保存模板字段**

在 `code_review_server/backend/tests/api/routes/test_review_tasks.py` 增加：

```python
def test_create_review_task_stores_template_and_skill_name(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "svn://repo/project",
            "old_revision": "r12",
            "new_revision": "r14",
            "template_key": "template_2",
            "skill_name": "通用-代码变更审查-模板二",
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["template_key"] == "template_2"
    assert content["skill_name"] == "通用-代码变更审查-模板二"
    assert content["old_revision"] == "r12"
    assert content["new_revision"] == "r14"
```

- [x] **Step 2: 写兼容测试，验证旧 payload 仍可创建任务**

在同一测试文件增加：

```python
def test_create_review_task_without_template_fields_remains_supported(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "svn://repo/project",
            "old_revision": "12",
            "new_revision": "14",
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["template_key"] is None
    assert content["skill_name"] is None
```

- [x] **Step 3: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py::test_create_review_task_stores_template_and_skill_name tests/api/routes/test_review_tasks.py::test_create_review_task_without_template_fields_remains_supported -q
```

Expected: FAIL，响应缺少 `template_key` 和 `skill_name`。

- [x] **Step 4: 修改模型**

在 `ReviewTask`、`ReviewTaskCreate`、`ReviewTaskPublic` 中加入：

```python
template_key: str | None = Field(default=None, max_length=64)
skill_name: str | None = Field(default=None, max_length=255)
```

`ReviewTaskCreate` 和 `ReviewTaskPublic` 中字段保持 nullable，避免旧客户端 payload 失败。

- [x] **Step 5: 创建 Alembic 迁移**

新增 `code_review_server/backend/app/alembic/versions/6e2a4d8b9f10_add_review_task_template_fields.py`：

```python
"""add review task template fields

Revision ID: 6e2a4d8b9f10
Revises: 3f6b2d1a9c44
Create Date: 2026-06-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "6e2a4d8b9f10"
down_revision = "3f6b2d1a9c44"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("template_key", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column("skill_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_task", "skill_name")
    op.drop_column("review_task", "template_key")
```

`down_revision` 使用当前仓库最新迁移头 `3f6b2d1a9c44`，该迁移接在意见反馈表迁移之后。

- [x] **Step 6: 运行任务测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -q
```

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add code_review_server/backend/app/models.py code_review_server/backend/app/alembic/versions/*_add_review_task_template_fields.py code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "记录审查任务模板信息"
```

---

### Task 3: 客户端共享模板配置和 API 类型升级

**Files:**
- Create: `code_review_electron/src/shared/review-templates.ts`
- Modify: `code_review_electron/src/shared/types.ts`
- Modify: `code_review_electron/src/main/api-client.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Test: `code_review_electron/src/main/__tests__/api-client.test.ts`
- Test: `code_review_electron/src/preload/index.test.ts`

- [x] **Step 1: 写失败测试，验证 API client 获取 active skills 列表和按 ID 下载**

在 `code_review_electron/src/main/__tests__/api-client.test.ts` 增加：

```ts
it('gets active skill list with authorization header', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
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
  })))
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
  expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/skills/skill-1/download', {
    method: 'GET',
    headers: { authorization: 'Bearer token-123' }
  })
})
```

- [x] **Step 2: 运行 API 测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts --runInBand
```

Expected: FAIL，`getActiveSkills`、`downloadSkill` 不存在。

- [x] **Step 3: 新增共享模板配置**

创建 `code_review_electron/src/shared/review-templates.ts`：

```ts
export const REVIEW_TEMPLATES = [
  {
    key: 'template_1',
    label: '模板一',
    skillName: '通用-代码变更审查-模板一'
  },
  {
    key: 'template_2',
    label: '模板二',
    skillName: '通用-代码变更审查-模板二'
  }
] as const

export type ReviewTemplateKey = (typeof REVIEW_TEMPLATES)[number]['key']

export const DEFAULT_REVIEW_TEMPLATE_KEY: ReviewTemplateKey = 'template_1'

export const REQUIRED_REVIEW_SKILL_NAMES = REVIEW_TEMPLATES.map(
  (template) => template.skillName
)

export const resolveReviewTemplate = (key: string): (typeof REVIEW_TEMPLATES)[number] => {
  const template = REVIEW_TEMPLATES.find((item) => item.key === key)
  if (!template) {
    throw new Error(`未知审查模板：${key}`)
  }
  return template
}
```

- [x] **Step 4: 更新 API 类型**

在 `code_review_electron/src/main/api-client.ts`：

```ts
import type { ReviewTemplateKey } from '../shared/review-templates'

export interface CreateTaskRequest {
  svn_url: string
  old_revision: string
  new_revision: string
  template_key?: ReviewTemplateKey
  skill_name?: string
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
```

新增方法：

```ts
getActiveSkills(token: string): Promise<ActiveSkillsResponse> {
  return this.request<ActiveSkillsResponse>('/api/v1/skills/active', {
    method: 'GET',
    headers: this.authHeaders(token)
  })
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
```

删除或停止使用 `getActiveSkill()`、`downloadActiveSkill()`。

- [x] **Step 5: 更新渲染和 shared 类型**

在 `code_review_electron/src/shared/types.ts` 的 `ReviewTask` 中增加：

```ts
template_key?: ReviewTemplateKey
skill_name?: string
```

在 `code_review_electron/src/renderer/src/code-review-api.ts` 的 `ExecuteTaskRequest` 中增加：

```ts
template_key: ReviewTemplateKey
skill_name: string
```

确保 `preload/index.ts` 不需要改 IPC 名称，只复用新的请求类型。

- [x] **Step 6: 运行类型和 API 测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/preload/index.test.ts --runInBand
npm run typecheck
```

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add code_review_electron/src/shared/review-templates.ts code_review_electron/src/shared/types.ts code_review_electron/src/main/api-client.ts code_review_electron/src/renderer/src/code-review-api.ts code_review_electron/src/preload/index.ts code_review_electron/src/main/__tests__/api-client.test.ts code_review_electron/src/preload/index.test.ts
git commit -m "增加客户端审查模板与多Skill接口类型"
```

---

### Task 4: Codex Skill 安装提示词增强并支持删除同名 Skill

**Files:**
- Modify: `code_review_electron/src/main/codex-skill-installer.ts`
- Test: `code_review_electron/src/main/__tests__/codex-skill-installer.test.ts`

- [x] **Step 1: 写失败测试，验证安装提示词包含服务端元信息和只删同名约束**

在 `codex-skill-installer.test.ts` 增加：

```ts
import { buildDeleteSkillPrompt, buildInstallSkillPrompt } from '../codex-skill-installer'

it('builds an install prompt with server skill metadata and same-name replacement rules', () => {
  const prompt = buildInstallSkillPrompt({
    packagePath: '/tmp/skill.zip',
    skillId: 'skill-1',
    skillName: '通用-代码变更审查-模板一',
    version: '1.0.0',
    contentHash: 'hash-1'
  })

  expect(prompt).toContain('Skill ID：skill-1')
  expect(prompt).toContain('Skill 名称：通用-代码变更审查-模板一')
  expect(prompt).toContain('Skill 版本：1.0.0')
  expect(prompt).toContain('内容哈希：hash-1')
  expect(prompt).toContain('只能删除同名 Skill，不要删除其他名称的 Skill')
  expect(prompt).toContain('[SKILL_INSTALL_OK] 通用-代码变更审查-模板一@1.0.0')
})
```

- [x] **Step 2: 写失败测试，验证删除提示词**

在同一测试文件增加：

```ts
it('builds a delete prompt that only removes the target skill name', () => {
  const prompt = buildDeleteSkillPrompt({
    skillId: 'skill-1',
    skillName: '通用-代码变更审查-模板一',
    version: '1.0.0'
  })

  expect(prompt).toContain('Skill 名称：通用-代码变更审查-模板一')
  expect(prompt).toContain('只删除名称为 通用-代码变更审查-模板一 的 Skill')
  expect(prompt).toContain('不要删除其他名称的 Skill')
  expect(prompt).toContain('[SKILL_DELETE_OK] 通用-代码变更审查-模板一')
})
```

- [x] **Step 3: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/codex-skill-installer.test.ts --runInBand
```

Expected: FAIL，函数签名和删除函数不存在。

- [x] **Step 4: 更新安装和删除函数**

在 `codex-skill-installer.ts` 定义：

```ts
export interface InstallCodexSkillInput {
  packagePath: string
  skillId: string
  skillName: string
  version: string
  contentHash?: string
  timeoutMs?: number
}

export interface DeleteCodexSkillInput {
  skillId: string
  skillName: string
  version: string
  timeoutMs?: number
}
```

把 `buildInstallSkillPrompt(packagePath: string)` 改为：

```ts
export const buildInstallSkillPrompt = ({
  packagePath,
  skillId,
  skillName,
  version,
  contentHash
}: InstallCodexSkillInput): string =>
  [
    '请将下面这个本地 Skill zip 包安装为 Codex 当前可用的最新 Skill。',
    '',
    '这是服务端当前激活 Skill 列表中的一个条目，客户端正在按服务端激活列表同步本机 Codex Skill。',
    '',
    '服务端 Skill 元信息：',
    `- Skill ID：${skillId}`,
    `- Skill 名称：${skillName}`,
    `- Skill 版本：${version}`,
    `- 内容哈希：${contentHash ?? '未提供'}`,
    `- Skill zip 路径：${packagePath}`,
    '',
    '安装要求：',
    '1. 直接读取 Skill zip 路径对应的 zip 文件，不要修改 zip 内容。',
    `2. 安装前必须识别 zip 包内的 Skill 名称，并确认它与服务端 Skill 名称一致：${skillName}。`,
    `3. 在安装新包前，必须定位 Codex 当前已安装的所有同名 Skill：${skillName}。`,
    '4. 删除所有旧的同名 Skill，包括旧版本目录、缓存目录、注册信息或 Codex 机制中会影响同名 Skill 解析的旧记录。',
    '5. 只能删除同名 Skill，不要删除其他名称的 Skill。',
    '6. 删除完成后，安装当前 zip 包中的 Skill。',
    `7. 安装后必须确认后续通过 Skill 名称 ${skillName} 调用时，只会使用本次安装的新版本。`,
    '8. 如果无法确认旧同名 Skill 已删除、无法确认新 Skill 已安装成功，或发现安装后的 Skill 名称与服务端元信息不一致，必须以失败状态结束。',
    '9. 安装成功后只输出简短成功信息。',
    '',
    '失败输出格式：',
    '[SKILL_INSTALL_ERROR] <失败原因，包括已尝试的删除路径、安装步骤和失败细节>',
    '',
    '成功输出格式：',
    `[SKILL_INSTALL_OK] ${skillName}@${version}`
  ].join('\n')
```

新增：

```ts
export const buildDeleteSkillPrompt = ({
  skillId,
  skillName,
  version
}: DeleteCodexSkillInput): string =>
  [
    '请从 Codex 当前已安装的 Skill 中删除指定 Skill。',
    '',
    '删除目标：',
    `- Skill 名称：${skillName}`,
    `- 原服务端 Skill ID：${skillId}`,
    `- 原版本：${version}`,
    '',
    '删除要求：',
    `1. 只删除名称为 ${skillName} 的 Skill。`,
    '2. 删除该名称下所有旧版本目录、缓存目录、注册信息或 Codex 机制中会影响同名 Skill 解析的记录。',
    '3. 不要删除其他名称的 Skill。',
    `4. 删除后必须确认后续通过 Skill 名称 ${skillName} 不会再启动到任何本地残留版本。`,
    '5. 如果无法确认删除成功，必须以失败状态结束。',
    '',
    '失败输出格式：',
    '[SKILL_DELETE_ERROR] <失败原因，包括已尝试的删除路径和失败细节>',
    '',
    '成功输出格式：',
    `[SKILL_DELETE_OK] ${skillName}`
  ].join('\n')
```

抽出公共 `runCodexPrompt(prompt, timeoutMs)`，让 `installCodexSkillFromZip(input)` 和新增 `deleteCodexSkill(input)` 复用。

- [x] **Step 5: 运行测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/codex-skill-installer.test.ts --runInBand
npm run typecheck
```

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add code_review_electron/src/main/codex-skill-installer.ts code_review_electron/src/main/__tests__/codex-skill-installer.test.ts
git commit -m "增强Codex Skill安装与删除提示词"
```

---

### Task 5: 客户端 Skill 同步改为多 active manifest，并清理不再激活 Skill

**Files:**
- Modify: `code_review_electron/src/main/skill-sync.ts`
- Modify: `code_review_electron/src/main/environment-checker.ts`
- Test: `code_review_electron/src/main/__tests__/skill-sync.test.ts`
- Test: `code_review_electron/src/main/__tests__/environment-checker.test.ts`
- Test: `code_review_electron/src/main/__tests__/ipc.test.ts`

- [x] **Step 1: 写失败测试，验证同步多个 active skills**

在 `skill-sync.test.ts` 新增测试：

```ts
it('syncs every active skill, writes a multi-skill manifest, and skips current packages', async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
  tempDirs.push(runtimeRoot)
  const runtimePaths = runtimePathsFor(runtimeRoot)
  const firstZip = Buffer.from('template one zip')
  const secondZip = Buffer.from('template two zip')
  const firstHash = sha256(firstZip)
  const secondHash = sha256(secondZip)
  const installSkill = vi.fn(async () => ({ stdout: 'installed', stderr: '' }))
  const deleteSkill = vi.fn()
  const api = {
    getActiveSkills: vi.fn(async () => ({
      data: [
        {
          id: 'skill-1',
          name: '通用-代码变更审查-模板一',
          version: '1.0.0',
          content_hash: firstHash,
          file_size: firstZip.byteLength
        },
        {
          id: 'skill-2',
          name: '通用-代码变更审查-模板二',
          version: '1.0.0',
          content_hash: secondHash,
          file_size: secondZip.byteLength
        }
      ],
      count: 2
    })),
    downloadSkill: vi.fn(async (_token: string, skillId: string) => {
      const bytes = skillId === 'skill-1' ? firstZip : secondZip
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    })
  }
  const service = new SkillSyncService(api, {
    runtimePaths,
    installSkill,
    deleteSkill
  })

  await expect(service.sync('token-123')).resolves.toMatchObject({
    status: 'synced',
    skills: [
      expect.objectContaining({ id: 'skill-1', name: '通用-代码变更审查-模板一' }),
      expect.objectContaining({ id: 'skill-2', name: '通用-代码变更审查-模板二' })
    ]
  })
  const manifest = JSON.parse(await readFile(runtimePaths.skillManifestPath, 'utf8')) as {
    skills: Array<{ id: string; name: string; content_hash: string }>
  }
  expect(manifest.skills.map((skill) => skill.id)).toEqual(['skill-1', 'skill-2'])
  expect(installSkill).toHaveBeenCalledTimes(2)
  expect(deleteSkill).not.toHaveBeenCalled()
})
```

- [x] **Step 2: 写失败测试，验证服务端不再激活的本地 Skill 会删除**

在同一测试文件增加：

```ts
it('deletes locally installed skills that are no longer active on the server', async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
  tempDirs.push(runtimeRoot)
  const runtimePaths = runtimePathsFor(runtimeRoot)
  await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
  const stalePackagePath = join(runtimePaths.skillPackagesDir, 'stale.zip')
  await writeFile(stalePackagePath, 'stale zip')
  await writeFile(
    runtimePaths.skillManifestPath,
    `${JSON.stringify({
      skills: [
        {
          id: 'stale-skill',
          name: '旧模板',
          version: '0.9.0',
          content_hash: sha256(Buffer.from('stale zip')),
          file_size: 9,
          package_path: stalePackagePath,
          installed_at: '2026-06-09T10:00:00.000Z'
        }
      ]
    }, null, 2)}\n`
  )
  const zipBytes = Buffer.from('template one zip')
  const contentHash = sha256(zipBytes)
  const installSkill = vi.fn(async () => ({ stdout: 'installed', stderr: '' }))
  const deleteSkill = vi.fn(async () => ({ stdout: 'deleted', stderr: '' }))
  const api = {
    getActiveSkills: vi.fn(async () => ({
      data: [
        {
          id: 'skill-1',
          name: '通用-代码变更审查-模板一',
          version: '1.0.0',
          content_hash: contentHash,
          file_size: zipBytes.byteLength
        }
      ],
      count: 1
    })),
    downloadSkill: vi.fn(async () =>
      zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
    )
  }
  const service = new SkillSyncService(api, { runtimePaths, installSkill, deleteSkill })

  await service.sync('token-123')

  expect(deleteSkill).toHaveBeenCalledWith({
    skillId: 'stale-skill',
    skillName: '旧模板',
    version: '0.9.0'
  })
  const manifest = JSON.parse(await readFile(runtimePaths.skillManifestPath, 'utf8')) as {
    skills: Array<{ id: string }>
  }
  expect(manifest.skills.map((skill) => skill.id)).toEqual(['skill-1'])
})
```

- [x] **Step 3: 写失败测试，验证环境检查要求模板一和模板二 Skill 均存在**

在 `environment-checker.test.ts` 增加：

```ts
it('treats multi-skill manifest as ready only when both template skills are installed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'environment-skill-'))
  tempDirs.push(dir)
  const manifestPath = join(dir, 'manifest.json')
  const firstPackage = join(dir, 'first.zip')
  const secondPackage = join(dir, 'second.zip')
  await writeFile(firstPackage, 'first')
  await writeFile(secondPackage, 'second')
  await writeFile(
    manifestPath,
    JSON.stringify({
      skills: [
        {
          id: 'skill-1',
          name: '通用-代码变更审查-模板一',
          version: '1.0.0',
          content_hash: 'hash-1',
          package_path: firstPackage,
          installed_at: '2026-06-09T10:00:00.000Z'
        },
        {
          id: 'skill-2',
          name: '通用-代码变更审查-模板二',
          version: '1.0.0',
          content_hash: 'hash-2',
          package_path: secondPackage,
          installed_at: '2026-06-09T10:00:00.000Z'
        }
      ]
    })
  )

  await expect(checkSkillPackageReady(manifestPath)).resolves.toBe(true)
})
```

再加缺少模板二的测试：

```ts
it('rejects manifest when one required template skill is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'environment-skill-'))
  tempDirs.push(dir)
  const manifestPath = join(dir, 'manifest.json')
  const firstPackage = join(dir, 'first.zip')
  await writeFile(firstPackage, 'first')
  await writeFile(
    manifestPath,
    JSON.stringify({
      skills: [
        {
          id: 'skill-1',
          name: '通用-代码变更审查-模板一',
          version: '1.0.0',
          content_hash: 'hash-1',
          package_path: firstPackage,
          installed_at: '2026-06-09T10:00:00.000Z'
        }
      ]
    })
  )

  await expect(checkSkillPackageReady(manifestPath)).resolves.toBe(false)
})
```

- [x] **Step 4: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/skill-sync.test.ts src/main/__tests__/environment-checker.test.ts --runInBand
```

Expected: FAIL，当前 manifest 是单对象，API 仍是单 active，删除函数未接入。

- [x] **Step 5: 实现多 Skill manifest 类型和同步流程**

在 `skill-sync.ts`：

```ts
export interface SkillManifestEntry {
  id: string
  name: string
  version: string
  content_hash?: string
  hash?: string
  file_size?: number
  package_path: string
  installed_at: string
}

export interface SkillManifest {
  skills: SkillManifestEntry[]
}

export interface SkillSyncResult {
  status: 'current' | 'synced'
  skills: SkillManifestEntry[]
}
```

`SkillSyncApi` 改为：

```ts
export interface SkillSyncApi {
  getActiveSkills(token: string): Promise<ActiveSkillsResponse>
  downloadSkill(token: string, skillId: string): Promise<ArrayBuffer>
}
```

`SkillSyncOptions` 增加：

```ts
deleteSkill?: (input: { skillId: string; skillName: string; version: string }) => Promise<unknown>
```

`sync(token)` 流程：

```ts
const activeSkills = (await this.api.getActiveSkills(token)).data
if (activeSkills.length === 0) {
  throw new Error('No active skill is configured')
}
const currentManifest = await this.readManifest()
const currentEntries = currentManifest?.skills ?? []
const nextEntries: SkillManifestEntry[] = []
let didChange = false

for (const staleEntry of currentEntries.filter(
  (entry) => !activeSkills.some((skill) => skill.id === entry.id)
)) {
  await this.deleteSkill({
    skillId: staleEntry.id,
    skillName: staleEntry.name,
    version: staleEntry.version
  })
  didChange = true
}

for (const activeSkill of activeSkills) {
  const expected = this.toManifest(activeSkill)
  const current = currentEntries.find((entry) => entry.id === expected.id)
  if (current && (await this.cachedPackageMatches(current, expected))) {
    nextEntries.push(current)
    continue
  }

  const installed = await this.downloadAndInstall(token, expected)
  nextEntries.push(installed)
  didChange = true
}

await mkdir(this.runtimePaths.skillPackagesDir, { recursive: true })
await writeFile(
  this.runtimePaths.skillManifestPath,
  `${JSON.stringify({ skills: nextEntries }, null, 2)}\n`
)

return { status: didChange ? 'synced' : 'current', skills: nextEntries }
```

`downloadAndInstall` 调用：

```ts
await this.installSkill({
  packagePath,
  skillId: manifest.id,
  skillName: manifest.name,
  version: manifest.version,
  contentHash: expectedHash ?? contentHash
})
```

保留旧单对象 manifest 读取兼容：如果 JSON 有 `package_path`，转换成 `{ skills: [parsed] }`，避免老客户端升级后立即失效。

- [x] **Step 6: 实现环境检查多 manifest**

在 `environment-checker.ts` 导入：

```ts
import { REQUIRED_REVIEW_SKILL_NAMES } from '../shared/review-templates'
```

替换 `checkSkillPackageReady`：

```ts
export const checkSkillPackageReady = async (manifestPath: string): Promise<boolean> => {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    const skills = extractManifestSkills(manifest)
    const entriesByName = new Map(skills.map((skill) => [skill.name, skill]))

    for (const skillName of REQUIRED_REVIEW_SKILL_NAMES) {
      const entry = entriesByName.get(skillName)
      if (!entry?.package_path) {
        return false
      }
      await access(entry.package_path)
    }
    return true
  } catch {
    return false
  }
}
```

新增小函数：

```ts
const extractManifestSkills = (manifest: unknown): Array<{ name: string; package_path: string }> => {
  if (
    typeof manifest === 'object' &&
    manifest !== null &&
    'skills' in manifest &&
    Array.isArray(manifest.skills)
  ) {
    return manifest.skills.filter(
      (item): item is { name: string; package_path: string } =>
        typeof item === 'object' &&
        item !== null &&
        'name' in item &&
        'package_path' in item &&
        typeof item.name === 'string' &&
        typeof item.package_path === 'string'
    )
  }

  return []
}
```

- [x] **Step 7: 更新 IPC 测试的 syncSkill 期望**

在 `ipc.test.ts` 中把旧的 `{ status, packagePath }` 期望改为：

```ts
{
  status: 'synced',
  skills: [
    expect.objectContaining({
      id: 'skill-1',
      name: '通用-代码变更审查-模板一'
    })
  ]
}
```

环境检查仍然只需要断言 `syncSkill` 被调用一次。

- [x] **Step 8: 运行客户端主进程测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/skill-sync.test.ts src/main/__tests__/environment-checker.test.ts src/main/__tests__/ipc.test.ts --runInBand
npm run typecheck
```

Expected: PASS。

- [x] **Step 9: 提交**

```bash
git add code_review_electron/src/main/skill-sync.ts code_review_electron/src/main/environment-checker.ts code_review_electron/src/main/__tests__/skill-sync.test.ts code_review_electron/src/main/__tests__/environment-checker.test.ts code_review_electron/src/main/__tests__/ipc.test.ts
git commit -m "同步多个激活Skill并清理失效Skill"
```

---

### Task 6: 任务执行使用模板 Skill，报告改名并增加图片目录

**Files:**
- Modify: `code_review_electron/src/main/runtime-paths.ts`
- Modify: `code_review_electron/src/main/codex-runner.ts`
- Modify: `code_review_electron/src/main/task-agent.ts`
- Modify: `code_review_electron/src/main/report-uploader.ts`
- Test: `code_review_electron/src/main/__tests__/runtime-paths.test.ts`
- Test: `code_review_electron/src/main/__tests__/codex-runner.test.ts`
- Test: `code_review_electron/src/main/__tests__/task-agent.test.ts`
- Test: `code_review_electron/src/main/__tests__/report-uploader.test.ts`

- [x] **Step 1: 写失败测试，验证报告路径和图片目录**

在 `runtime-paths.test.ts` 增加或更新断言：

```ts
expect(runtimePaths.reportPathForTask('task-1')).toContain('代码审查报告.md')
expect(runtimePaths.imagesDirForTask('task-1')).toContain(join('workspaces', 'task-1', 'images'))
```

- [x] **Step 2: 写失败测试，验证 prompt 强制使用模板 Skill 并包含图片目录**

在 `codex-runner.test.ts` 更新 `buildReviewPrompt` 调用：

```ts
const prompt = buildReviewPrompt({
  svnUrl: 'svn://example.com/repo/project',
  oldRevision: '123',
  newRevision: '130',
  reportPath: '/tmp/review/代码审查报告.md',
  imagesDir: '/tmp/review/images',
  skillName: '通用-代码变更审查-模板二'
})

expect(prompt).toContain('请强制使用本机 Codex 已安装的 Skill：通用-代码变更审查-模板二')
expect(prompt).toContain('报告输出路径：/tmp/review/代码审查报告.md')
expect(prompt).toContain('图片保存目录：/tmp/review/images')
expect(prompt).toContain('images/<文件名>')
```

- [x] **Step 3: 写失败测试，验证 executeReviewTask 传入 skillName 和 imagesDir**

在 `task-agent.test.ts` 中把 request 改为：

```ts
const request = {
  svn_url: 'svn://repo/project',
  old_revision: '12',
  new_revision: '14',
  template_key: 'template_2' as const,
  skill_name: '通用-代码变更审查-模板二'
}
```

成功测试里准备：

```ts
const imagesDir = join(cwd, 'images')
const reportPath = join(cwd, '代码审查报告.md')
```

断言：

```ts
expect(dependencies.runCodex).toHaveBeenCalledWith({
  cwd,
  reportPath,
  imagesDir,
  skillName: '通用-代码变更审查-模板二',
  task: makeTask({
    template_key: 'template_2',
    skill_name: '通用-代码变更审查-模板二'
  })
})
```

- [x] **Step 4: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/runtime-paths.test.ts src/main/__tests__/codex-runner.test.ts src/main/__tests__/task-agent.test.ts --runInBand
```

Expected: FAIL，路径、prompt 参数和 RunCodexInput 尚未更新。

- [x] **Step 5: 更新 runtime paths**

在 `runtime-paths.ts` 的 `RuntimePaths` 中新增：

```ts
imagesDirForTask(taskId: string): string
```

返回值改为：

```ts
reportPathForTask: (taskId: string) => pathApi.join(workspacesDir, taskId, '代码审查报告.md'),
imagesDirForTask: (taskId: string) => pathApi.join(workspacesDir, taskId, 'images')
```

- [x] **Step 6: 更新 prompt 类型和内容**

在 `codex-runner.ts`：

```ts
export interface ReviewPromptInput {
  svnUrl: string
  oldRevision: string
  newRevision: string
  reportPath: string
  imagesDir: string
  skillName: string
}
```

`buildReviewPrompt` 开头改为：

```ts
export const buildReviewPrompt = ({
  svnUrl,
  oldRevision,
  newRevision,
  reportPath,
  imagesDir,
  skillName
}: ReviewPromptInput): string => `请强制使用本机 Codex 已安装的 Skill：${skillName}

审查输入：
- 项目路径：${svnUrl}
- 旧版本号：${oldRevision}
- 新版本号：${newRevision}
- 报告输出路径：${reportPath}
- 图片保存目录：${imagesDir}

请严格按该 Skill 的输入模块、SVN 获取策略、规则模块、输出模块执行代码变更审查。
最终生成 Markdown 审查报告到报告输出路径：${reportPath}
如需生成或引用图片，请将图片保存到图片保存目录，并在 Markdown 中使用相对路径 images/<文件名> 引用。
...
`
```

保留原错误处理规范正文。

- [x] **Step 7: 更新 task-agent**

在 `PreparedWorkspace` 增加 `imagesDir`，`RunCodexInput` 增加 `imagesDir` 和 `skillName`：

```ts
export interface PreparedWorkspace {
  cwd: string
  reportPath: string
  imagesDir: string
}

export interface RunCodexInput {
  cwd: string
  reportPath: string
  imagesDir: string
  skillName: string
  task: ReviewTask
  onProgress?: TaskProgressReporter
}
```

`defaultPrepareWorkspace` 返回：

```ts
return {
  cwd,
  reportPath: runtimePaths.reportPathForTask(taskId),
  imagesDir: runtimePaths.imagesDirForTask(taskId)
}
```

`defaultRunCodex` 调用：

```ts
prompt: buildReviewPrompt({
  svnUrl: task.svn_url,
  oldRevision: task.old_revision,
  newRevision: task.new_revision,
  reportPath,
  imagesDir,
  skillName
})
```

在 `executeReviewTask` 调用 `runCodex` 前解析：

```ts
const skillName = input.request.skill_name ?? task.skill_name
if (!skillName) {
  throw new Error('未选择审查模板 Skill')
}
```

并传给 `runCodex`。

- [x] **Step 8: 更新上传文件名**

在 `report-uploader.ts` 中把上传文件名从 `report.md` 改为：

```ts
new File([payload.report_content], '代码审查报告.md', {
  type: 'text/markdown'
})
```

测试断言同步更新。

- [x] **Step 9: 运行测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/runtime-paths.test.ts src/main/__tests__/codex-runner.test.ts src/main/__tests__/task-agent.test.ts src/main/__tests__/report-uploader.test.ts --runInBand
npm run typecheck
```

Expected: PASS。

- [x] **Step 10: 提交**

```bash
git add code_review_electron/src/main/runtime-paths.ts code_review_electron/src/main/codex-runner.ts code_review_electron/src/main/task-agent.ts code_review_electron/src/main/report-uploader.ts code_review_electron/src/main/__tests__/runtime-paths.test.ts code_review_electron/src/main/__tests__/codex-runner.test.ts code_review_electron/src/main/__tests__/task-agent.test.ts code_review_electron/src/main/__tests__/report-uploader.test.ts
git commit -m "按模板Skill生成代码审查报告"
```

---

### Task 7: 渲染端任务表单增加同一行模板选择

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`
- Create: `code_review_electron/src/renderer/src/components/TaskForm.test.tsx`
- Test: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`

- [x] **Step 1: 写 TaskForm 失败测试**

创建 `TaskForm.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TaskForm } from './TaskForm'

describe('TaskForm', () => {
  it('keeps SVN fields and submits the selected review template', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(<TaskForm disabled={false} onSubmit={onSubmit} />)

    expect(screen.getByLabelText('SVN 地址')).toBeInTheDocument()
    expect(screen.getByLabelText('旧版本号')).toBeInTheDocument()
    expect(screen.getByLabelText('新版本号')).toBeInTheDocument()
    expect(screen.getByLabelText('模板一')).toBeChecked()
    expect(screen.getByLabelText('模板二')).not.toBeChecked()

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
    await user.type(screen.getByLabelText('旧版本号'), '12')
    await user.type(screen.getByLabelText('新版本号'), '14')
    await user.click(screen.getByLabelText('模板二'))
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(onSubmit).toHaveBeenCalledWith({
      svn_url: 'svn://repo/project',
      old_revision: '12',
      new_revision: '14',
      template_key: 'template_2',
      skill_name: '通用-代码变更审查-模板二'
    })
  })
})
```

- [x] **Step 2: 更新 TaskPage 测试，验证 pending task 保留模板字段**

在 `TaskPage.test.tsx` 中提交任务的测试断言 `executeTask` payload 包含：

```ts
expect(window.codeReview.executeTask).toHaveBeenCalledWith(
  expect.objectContaining({
    template_key: 'template_1',
    skill_name: '通用-代码变更审查-模板一'
  })
)
```

- [x] **Step 3: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskForm.test.tsx src/renderer/src/components/TaskPage.test.tsx --runInBand
```

Expected: FAIL，表单没有模板单选项。

- [x] **Step 4: 实现 TaskForm**

在 `TaskForm.tsx` 导入：

```ts
import { DEFAULT_REVIEW_TEMPLATE_KEY, REVIEW_TEMPLATES, resolveReviewTemplate, type ReviewTemplateKey } from '../../../shared/review-templates'
```

新增状态：

```ts
const [templateKey, setTemplateKey] = useState<ReviewTemplateKey>(DEFAULT_REVIEW_TEMPLATE_KEY)
```

提交时：

```ts
const template = resolveReviewTemplate(templateKey)
await onSubmit({
  svn_url: svnUrl.trim(),
  old_revision: oldRevision.trim(),
  new_revision: newRevision.trim(),
  template_key: template.key,
  skill_name: template.skillName
})
```

按钮上方加入：

```tsx
<fieldset className="template-choice">
  <legend>审查模板</legend>
  <div className="template-options">
    {REVIEW_TEMPLATES.map((template) => (
      <label className="template-option" key={template.key}>
        <input
          type="radio"
          name="review-template"
          value={template.key}
          checked={templateKey === template.key}
          onChange={() => setTemplateKey(template.key)}
        />
        <span>{template.label}</span>
      </label>
    ))}
  </div>
</fieldset>
```

- [x] **Step 5: 更新 TaskPage pending task**

在 `TaskPage.tsx` 的 `pendingTask` 中加入：

```ts
template_key: payload.template_key,
skill_name: payload.skill_name,
```

服务端返回成功后映射任务时保留：

```ts
template_key: payload.template_key,
skill_name: payload.skill_name,
```

- [x] **Step 6: 增加 CSS**

在 `styles.css` 增加：

```css
.template-choice {
  border: 0;
  margin: 0;
  padding: 0;
}

.template-choice legend {
  color: #5f6b7a;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.template-options {
  align-items: center;
  display: flex;
  gap: 18px;
  min-height: 32px;
}

.template-option {
  align-items: center;
  color: #1f2937;
  display: inline-flex;
  font-size: 14px;
  gap: 6px;
  line-height: 20px;
  white-space: nowrap;
}

.template-option input {
  accent-color: #2563eb;
  height: 14px;
  width: 14px;
}
```

- [x] **Step 7: 运行渲染测试**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskForm.test.tsx src/renderer/src/components/TaskPage.test.tsx --runInBand
npm run typecheck
```

Expected: PASS。

- [x] **Step 8: 提交**

```bash
git add code_review_electron/src/renderer/src/components/TaskForm.tsx code_review_electron/src/renderer/src/components/TaskPage.tsx code_review_electron/src/renderer/src/components/TaskForm.test.tsx code_review_electron/src/renderer/src/components/TaskPage.test.tsx code_review_electron/src/renderer/src/styles.css
git commit -m "新增客户端审查模板选择"
```

---

### Task 8: IPC、预览和下载位置回归收口

**Files:**
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/preload/index.test.ts`
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`
- Modify: `code_review_electron/src/renderer/src/components/MarkdownPreview.test.tsx`

- [x] **Step 1: 更新 IPC 测试，验证下载历史报告写入中文报告名**

在 `ipc.test.ts` 里历史报告下载测试中，把期望路径从 `report.md` 改为：

```ts
const reportPath = join(runtimeRoot, 'workspaces', 'task-remote', '代码审查报告.md')
```

断言保持：

```ts
await expect(readFile(reportPath, 'utf8')).resolves.toBe('# historical report\n')
expect(showItemInFolderMock).toHaveBeenCalledWith(reportPath)
```

- [x] **Step 2: 更新报告图片读取测试，确保相对 images 路径仍可读**

在 `ipc.test.ts` 的 `report:asset` 测试中使用：

```ts
const reportPath = join(cwd, '代码审查报告.md')
const imagePath = join(cwd, 'images', 'diagram.png')
await mkdir(dirname(imagePath), { recursive: true })
await writeFile(reportPath, '# report\n![diagram](images/diagram.png)\n')
await writeFile(imagePath, Buffer.from([137, 80, 78, 71]))
```

调用：

```ts
await expect(assetHandler({}, { reportPath, assetPath: 'images/diagram.png' })).resolves.toMatchObject({
  contentType: 'image/png'
})
```

- [x] **Step 3: 运行 IPC 和预览测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/MarkdownPreview.test.tsx --runInBand
```

Expected: PASS。

Actual: PASS。运行 `npm test -- src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/MarkdownPreview.test.tsx`，3 个测试文件、37 个用例通过。

- [x] **Step 4: 修复必要的路径调用**

如果测试失败，确保 `ipc.ts` 中历史报告下载仍然使用：

```ts
const reportPath = runtimePaths.reportPathForTask(reportTaskId)
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, reportMarkdown, 'utf8')
shell.showItemInFolder(reportPath)
```

`readReportAsset` 不需要改业务逻辑，因为它已经按 `dirname(reportPath)` 解析相对图片路径。

Actual: 业务逻辑无需修改，`readReportAsset` 继续按报告目录解析相对图片路径。

- [x] **Step 5: 提交**

```bash
git add code_review_electron/src/main/ipc.ts code_review_electron/src/main/__tests__/ipc.test.ts code_review_electron/src/preload/index.test.ts code_review_electron/src/renderer/src/components/MarkdownPreview.test.tsx
git commit -m "回归报告下载和图片预览路径"
```

---

### Task 9: 全量验证和收尾

**Files:**
- Verify only.

- [x] **Step 1: 运行服务端相关测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_skills.py tests/api/routes/test_review_tasks.py -q
```

Expected: PASS。

Actual: 部分通过，完整组合仍有既有统计测试隔离问题。`CODE_REVIEW_TEST_POSTGRES_DB=multi_skill_verify_test ... uv run pytest tests/api/routes/test_skills.py -q` 结果为 12 passed；模板字段切片 `test_create_review_task_stores_template_and_skill_name`、`test_create_review_task_without_template_fields_remains_supported` 结果为 2 passed。完整组合 `uv run pytest tests/api/routes/test_skills.py tests/api/routes/test_review_tasks.py -q` 结果为 34 passed、1 failed，失败为 `test_admin_task_stats_include_all_nonzero_report_counts_by_user`，`reports_by_user` 期望 21、实际 22。

- [x] **Step 2: 运行客户端相关测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/codex-skill-installer.test.ts src/main/__tests__/skill-sync.test.ts src/main/__tests__/environment-checker.test.ts src/main/__tests__/runtime-paths.test.ts src/main/__tests__/codex-runner.test.ts src/main/__tests__/task-agent.test.ts src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/TaskForm.test.tsx src/renderer/src/components/TaskPage.test.tsx src/renderer/src/components/MarkdownPreview.test.tsx --runInBand
```

Expected: PASS。

Actual: PASS。由于当前 Vitest 不支持 `--runInBand`，运行不带该参数的命令，12 个测试文件、106 个用例通过。

- [x] **Step 3: 运行客户端类型检查**

Run:

```bash
cd code_review_electron
npm run typecheck
```

Expected: PASS。

Actual: PASS。`npm run typecheck` 通过。

- [x] **Step 4: 检查工作区只包含本功能相关改动**

Run:

```bash
git status --short
git log --oneline --decorate -8
```

Expected: 只有本计划任务产生的提交；如果存在执行前就已有的用户改动，不要回退，只在最终说明中列出未触碰。

Actual: 当前分支包含本计划提交；工作区另有执行前已存在的外部 Skill 压缩包未跟踪文件，未触碰。

- [x] **Step 5: 最终提交验证记录**

如果前面每个任务已分别提交，本步骤不再创建额外提交。若执行过程中有测试说明文档需要记录，追加到现有验证文档后再提交：

```bash
git add docs/verification-log.md
git commit -m "记录多Skill模板选择验证结果"
```

只有实际修改了验证文档时执行该提交。

Actual: 未新增单独验证文档，仅在本计划中记录验证结果。

---

## 自检

- Spec 覆盖：计划覆盖服务端多激活、取消激活、同名替换、客户端多 Skill 同步、不再激活清理、固定模板映射、任务字段保留、报告改名、图片目录和回归测试。
- 占位检查：计划使用具体 Alembic revision `6e2a4d8b9f10` 和当前迁移头 `3f6b2d1a9c44`，没有保留业务待定项。
- 类型一致性：`template_key` 使用 `ReviewTemplateKey`，`skill_name` 使用 string；客户端请求、任务对象、prompt 和表单 payload 使用同一字段名。
- 风险点：历史报告图片跨客户端查看仍按非目标处理；实现时不得扩展服务端图片上传范围。
