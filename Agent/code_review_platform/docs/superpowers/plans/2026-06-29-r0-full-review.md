# 旧版本号 0 全量审查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户用旧版本号 `0` 发起目标 SVN revision 的全量静态代码审查，并同步更新两个代码审查 Skill 的规则。

**Architecture:** 保持现有 API 数据结构不变，把 `old_revision = r0` 作为平台兼容开关。服务端负责校验 `r0` 语义，Electron 负责提示、报告命名、Codex Prompt 和任务展示，Skill 负责把 `r0` 转成全量审查获取策略和输出口径。

**Tech Stack:** FastAPI、SQLModel、pytest、Electron、TypeScript、React、Vitest、Markdown Skill 文件。

---

## 文件结构

- Modify: `code_review_server/backend/app/api/routes/review_tasks.py` - 允许 `old_revision = r0`，禁止 `new_revision = r0`，保留普通差异审查的相同版本校验。
- Modify: `code_review_server/backend/tests/api/routes/test_review_tasks.py` - 覆盖 `r0` 创建成功、目标版本为 `0` 失败、普通相同版本失败。
- Modify: `code_review_electron/src/shared/report-artifacts.ts` - 增加 `r0` 全量审查报告命名。
- Modify: `code_review_electron/src/shared/report-artifacts.test.ts` - 覆盖全量和差异报告名。
- Modify: `code_review_electron/src/main/codex-runner.ts` - 在 `buildReviewPrompt` 中增加全量审查提示分支。
- Modify: `code_review_electron/src/main/__tests__/codex-runner.test.ts` - 覆盖全量审查 Prompt。
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.tsx` - 给旧版本号输入框增加提示。
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.test.tsx` - 覆盖提示文案。
- Modify: `code_review_electron/src/renderer/src/components/TaskBoard.tsx` - `r0` 任务显示为 `全量审查 r新版本`。
- Modify: `code_review_electron/src/renderer/src/components/TaskBoard.test.tsx` - 覆盖任务卡片全量审查展示。
- Modify: `code_review_server/frontend/src/components/Tasks/TasksPage.tsx` - 管理后台任务列表显示全量审查文案。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/SKILL.md` - 说明支持全量审查。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/10-输入模块/10-输入收集规则.md` - 输入规则支持 `0/r0`。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/10-输入模块/20-SVN获取策略.md` - 增加全量审查 SVN export 策略。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/30-输出模块/10-报告模板规则.md` - 调整全量审查报告口径。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/30-输出模块/30-代码差异图生成规则.md` - 全量审查允许风险代码片段图。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/30-输出模块/代码审查报告-模版一.md` - 模板字段说明兼容全量审查。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/SKILL.md` - 说明支持全量审查。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/10-输入模块/10-输入收集规则.md` - 输入规则支持 `0/r0`。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/10-输入模块/20-SVN与封装文件处理.md` - 增加全量审查获取策略。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/20-规则模块/10-户用自检工具接入.md` - 目标 revision 说明兼容全量审查。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/20-规则模块/11-高压自检工具接入.md` - 目标 revision 说明兼容全量审查。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/30-输出模块/10-报告模板.md` - 调整全量审查报告口径。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/30-输出模块/20-变更图规则.md` - 全量审查允许风险代码片段图。
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/30-输出模块/代码审查报告-模版二.md` - 模板字段说明兼容全量审查。

## Task 1: 服务端 r0 校验

**Files:**
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`

- [ ] **Step 1: 写失败测试**

在 `test_create_review_task_normalizes_revisions` 后增加：

```python
def test_create_review_task_allows_zero_old_revision_for_full_review(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "https://svn.example.com/project/trunk",
            "old_revision": "0",
            "new_revision": "r123",
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["old_revision"] == "r0"
    assert content["new_revision"] == "r123"


def test_create_review_task_rejects_zero_new_revision(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "https://svn.example.com/project/trunk",
            "old_revision": "0",
            "new_revision": "0",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "新版本号不能为 0"


def test_create_review_task_rejects_equal_non_zero_revisions(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "https://svn.example.com/project/trunk",
            "old_revision": "12",
            "new_revision": "r12",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "旧版本号和新版本号不能相同"
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
bash scripts/test.sh tests/api/routes/test_review_tasks.py -k 'zero_old_revision or zero_new_revision or equal_non_zero_revisions'
```

Expected: 至少 `zero_old_revision` 或错误信息断言失败。

- [ ] **Step 3: 实现服务端校验**

在 `create_review_task` 中替换相同版本校验：

```python
    if new_revision == "r0":
        raise HTTPException(status_code=400, detail="新版本号不能为 0")
    if old_revision != "r0" and old_revision == new_revision:
        raise HTTPException(status_code=400, detail="旧版本号和新版本号不能相同")
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd code_review_server/backend
bash scripts/test.sh tests/api/routes/test_review_tasks.py -k 'zero_old_revision or zero_new_revision or equal_non_zero_revisions or normalizes_revisions'
```

Expected: PASS。

## Task 2: Electron 报告名与 Prompt

**Files:**
- Modify: `code_review_electron/src/shared/report-artifacts.ts`
- Test: `code_review_electron/src/shared/report-artifacts.test.ts`
- Modify: `code_review_electron/src/main/codex-runner.ts`
- Test: `code_review_electron/src/main/__tests__/codex-runner.test.ts`

- [ ] **Step 1: 写报告名失败测试**

在 `report-artifacts.test.ts` 增加：

```ts
  it('builds a full review report file name when old revision is zero', () => {
    const fileName = buildReviewReportFileName({
      oldRevision: '0',
      newRevision: 'R456',
      generatedAt: new Date(2026, 5, 29, 10, 30, 0)
    })

    expect(fileName).toBe('全量审查_r456_20260629_103000.md')
  })
```

- [ ] **Step 2: 写 Prompt 失败测试**

在 `buildReviewPrompt` describe 中增加：

```ts
  it('explains full review semantics when old revision is zero', () => {
    const prompt = buildReviewPrompt({
      svnUrl: 'svn://example.com/repo/project',
      oldRevision: 'r0',
      newRevision: 'r130',
      reportPath: '/tmp/review/全量审查_r130.md',
      imagesDir: '/tmp/review/images',
      skillName: '通用-代码审查-模版二'
    })

    expect(prompt).toContain('旧版本号：r0（平台全量审查占位，不是 SVN 真实旧版本）')
    expect(prompt).toContain('本次为全量代码静态审查')
    expect(prompt).toContain('禁止执行 svn diff -r 0:130')
    expect(prompt).toContain('必须获取 r130 对应的完整代码')
    expect(prompt).toContain('报告中不得写成本次变更引入')
  })
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/shared/report-artifacts.test.ts src/main/__tests__/codex-runner.test.ts
```

Expected: 新增断言失败。

- [ ] **Step 4: 实现报告名与 Prompt**

在 `report-artifacts.ts` 增加：

```ts
export const isFullReviewOldRevision = (revision: string): boolean =>
  normalizeRevisionForReportName(revision) === 'r0'
```

并在 `buildReviewReportFileName` 中：

```ts
  if (isFullReviewOldRevision(oldRevision)) {
    return `全量审查_${normalizeRevisionForReportName(newRevision)}_${timestamp}.md`
  }
```

在 `codex-runner.ts` 中导入 `normalizeRevisionForReportName`，增加辅助函数：

```ts
const buildReviewModeInstruction = (oldRevision: string, newRevision: string): string => {
  const normalizedOldRevision = normalizeRevisionForReportName(oldRevision)
  const normalizedNewRevision = normalizeRevisionForReportName(newRevision)
  const numericNewRevision = normalizedNewRevision.replace(/^r/, '')

  if (normalizedOldRevision !== 'r0') {
    return ''
  }

  return `\n\n全量审查模式：\n旧版本号 r0 是平台全量审查占位，不是 SVN 真实旧版本。\n本次为全量代码静态审查，禁止执行 svn diff -r 0:${numericNewRevision}。\n必须获取 ${normalizedNewRevision} 对应的完整代码，并基于完整代码执行静态审查。\n报告中不得写成本次变更引入，应写成全量静态审查发现。`
}
```

并把旧版本行改为全量审查时带括号说明，把该 instruction 插入到补充输入之后、执行规则之前。

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
cd code_review_electron
npm test -- src/shared/report-artifacts.test.ts src/main/__tests__/codex-runner.test.ts
```

Expected: PASS。

## Task 3: Electron 表单与任务展示

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.tsx`
- Test: `code_review_electron/src/renderer/src/components/TaskForm.test.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskBoard.tsx`
- Test: `code_review_electron/src/renderer/src/components/TaskBoard.test.tsx`

- [ ] **Step 1: 写表单提示测试**

在 `TaskForm` 第一个测试中增加：

```ts
    expect(screen.getByPlaceholderText('填 0 表示全量审查新版本代码')).toBeInTheDocument()
```

- [ ] **Step 2: 写任务展示测试**

在 `TaskBoard` describe 中增加：

```ts
  it('全量审查任务显示目标版本', async () => {
    const user = userEvent.setup()
    const fullReviewTask: TaskViewItem = {
      ...historyTasks[0],
      id: 'task-full-review',
      old_revision: 'r0',
      new_revision: 'r123'
    }

    renderTaskBoard({ runningTasks: [], queuedTasks: [], historyTasks: [fullReviewTask] })

    await user.click(screen.getByRole('tab', { name: '历史任务 1' }))

    expect(screen.getByText('全量审查 r123')).toBeInTheDocument()
  })
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskForm.test.tsx src/renderer/src/components/TaskBoard.test.tsx
```

Expected: 新增断言失败。

- [ ] **Step 4: 实现 UI**

在 `TaskForm.tsx` 的旧版本号 `<input>` 增加：

```tsx
            placeholder="填 0 表示全量审查新版本代码"
```

在 `TaskBoard.tsx` 增加：

```ts
function isFullReviewTask(task: Pick<TaskViewItem, 'old_revision'>): boolean {
  return formatRevisionLabel(task.old_revision) === 'r0'
}

function formatTaskRevisionRange(task: TaskViewItem): string {
  const newRevision = formatRevisionLabel(task.new_revision)

  if (isFullReviewTask(task)) {
    return `全量审查 ${newRevision || task.new_revision}`
  }

  return `${task.old_revision} → ${task.new_revision}`
}
```

并把卡片中的旧/新版本两列在全量审查时替换成一个 `dt` 为 `审查范围` 的展示块。

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskForm.test.tsx src/renderer/src/components/TaskBoard.test.tsx
```

Expected: PASS。

## Task 4: 管理后台任务展示

**Files:**
- Modify: `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`

- [ ] **Step 1: 增加版本展示函数**

在 `TasksPage.tsx` 中增加：

```ts
function formatReviewTaskRevisionRange(task: ReviewTask) {
  if (task.old_revision.trim().toLowerCase() === "r0") {
    return `全量审查 ${task.new_revision}`
  }

  return `${task.old_revision} → ${task.new_revision}`
}
```

- [ ] **Step 2: 替换表格版本列**

把：

```tsx
{task.old_revision} → {task.new_revision}
```

替换为：

```tsx
{formatReviewTaskRevisionRange(task)}
```

- [ ] **Step 3: 运行前端静态检查**

Run:

```bash
cd code_review_server/frontend
npm run lint
```

Expected: PASS。

## Task 5: 更新模板一 Skill

**Files:**
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/SKILL.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/10-输入模块/10-输入收集规则.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/10-输入模块/20-SVN获取策略.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/30-输出模块/10-报告模板规则.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/30-输出模块/30-代码差异图生成规则.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版一/references/30-输出模块/代码审查报告-模版一.md`

- [ ] **Step 1: 更新适用范围**

在 `SKILL.md` 概述和适用范围中补充：

```markdown
3. 当平台传入旧版本号 `0` 或 `r0` 时，对新版本号对应的完整代码执行全量静态审查。
```

以及：

```markdown
- 用户提供项目路径、旧版本号 `0/r0`、新版本号，并要求对目标版本完整代码生成全量审查报告。
```

- [ ] **Step 2: 更新输入收集规则**

在输入校验中补充：

```markdown
- 如果旧版本号为 `0` 或 `r0`，必须识别为“全量审查模式”。`r0` 是平台占位，不是 SVN 真实旧版本。
- 全量审查模式下，新版本号仍为必填，且不能为 `0/r0`。
```

- [ ] **Step 3: 更新 SVN 获取策略**

在优先获取顺序前增加：

```markdown
## 全量审查模式

当旧版本号为 `0` 或 `r0` 时，进入全量审查模式：

1. 禁止执行 `svn diff -r 0:新版本 项目路径`。
2. 使用新版本号作为目标 revision。
3. 优先执行 `svn export -r 新版本 项目路径 英文临时目录` 获取目标版本完整代码。
4. 如果用户提供的是本地 SVN 工作副本，先用 `svn info` 确认工作副本 revision；无法确认与新版本一致时，报告必须说明材料来源限制。
5. 基于目标版本完整代码执行静态审查，不能把结论写成“本次变更引入”。
```

- [ ] **Step 4: 更新报告和图规则**

在报告模板规则和代码差异图生成规则中补充全量审查口径：

```markdown
- 全量审查模式下，“审查方式”写为 `全量代码静态审查，目标版本 r新版本`。
- 全量审查模式下，不使用“旧版本对新版本”“本次变更引入”等差异审查措辞。
- 全量审查模式下，差异图可替换为风险代码片段图、检查结果图或调用链说明图，不强制左右版本对比。
```

- [ ] **Step 5: 检查关键文本**

Run:

```bash
rg -n "全量审查|r0|svn diff -r 0|全量代码静态审查" /Users/chenghao/.codex/skills/通用-代码审查-模版一
```

Expected: 能在输入、SVN 获取、输出规则中看到全量审查规则。

## Task 6: 更新模板二 Skill

**Files:**
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/SKILL.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/10-输入模块/10-输入收集规则.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/10-输入模块/20-SVN与封装文件处理.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/20-规则模块/10-户用自检工具接入.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/20-规则模块/11-高压自检工具接入.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/30-输出模块/10-报告模板.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/30-输出模块/20-变更图规则.md`
- Modify: `/Users/chenghao/.codex/skills/通用-代码审查-模版二/references/30-输出模块/代码审查报告-模版二.md`

- [ ] **Step 1: 更新适用范围**

在 `SKILL.md` 中说明支持旧版本号 `0/r0` 的全量静态审查。

- [ ] **Step 2: 更新输入收集和 SVN 规则**

在输入收集规则中说明：

```markdown
- 旧版本号为 `0` 或 `r0` 时，变更范围记录为 `全量代码，目标版本 r新版本`。
```

在 `20-SVN与封装文件处理.md` 的开头增加全量审查模式，禁止套用 `SVN 最新变更` 的 `svn diff -c <rev>` 流程。

- [ ] **Step 3: 更新自检工具 revision 说明**

在户用和高压自检工具接入规则中补充：

```markdown
- 全量审查模式下，`<newrev>` 仍为用户输入的新版本号；旧版本号 `r0` 只表示平台全量审查占位，不能传给 SVN diff 或自检范围判断。
```

- [ ] **Step 4: 更新输出和图规则**

在报告模板和变更图规则中补充：

```markdown
- 全量审查模式下，“变更识别”写明审查范围为 `全量代码，目标版本 r新版本`。
- 全量审查模式下，不写“本次变更引入”，改写为“全量静态审查发现”。
- 全量审查模式下，对应变更图可以是风险代码片段图或自检结果图。
```

- [ ] **Step 5: 检查关键文本**

Run:

```bash
rg -n "全量审查|r0|svn diff -r 0|全量代码静态审查" /Users/chenghao/.codex/skills/通用-代码审查-模版二
```

Expected: 能在输入、SVN 获取、自检、输出规则中看到全量审查规则。

## Task 7: 全量验证与提交

**Files:**
- All modified repo files
- Skill directories outside repo

- [ ] **Step 1: 运行后端目标测试**

Run:

```bash
cd code_review_server/backend
bash scripts/test.sh tests/api/routes/test_review_tasks.py -k 'zero_old_revision or zero_new_revision or equal_non_zero_revisions or normalizes_revisions'
```

Expected: PASS。

- [ ] **Step 2: 运行 Electron 目标测试**

Run:

```bash
cd code_review_electron
npm test -- src/shared/report-artifacts.test.ts src/main/__tests__/codex-runner.test.ts src/renderer/src/components/TaskForm.test.tsx src/renderer/src/components/TaskBoard.test.tsx
```

Expected: PASS。

- [ ] **Step 3: 运行前端 lint**

Run:

```bash
cd code_review_server/frontend
npm run lint
```

Expected: PASS。

- [ ] **Step 4: 检查 Skill 关键规则**

Run:

```bash
rg -n "全量审查|r0|禁止执行 `?svn diff -r 0|全量代码静态审查" /Users/chenghao/.codex/skills/通用-代码审查-模版一 /Users/chenghao/.codex/skills/通用-代码审查-模版二
```

Expected: 两个 Skill 都有命中。

- [ ] **Step 5: 提交 repo 内改动**

Run:

```bash
git add code_review_server/backend/app/api/routes/review_tasks.py code_review_server/backend/tests/api/routes/test_review_tasks.py code_review_electron/src/shared/report-artifacts.ts code_review_electron/src/shared/report-artifacts.test.ts code_review_electron/src/main/codex-runner.ts code_review_electron/src/main/__tests__/codex-runner.test.ts code_review_electron/src/renderer/src/components/TaskForm.tsx code_review_electron/src/renderer/src/components/TaskForm.test.tsx code_review_electron/src/renderer/src/components/TaskBoard.tsx code_review_electron/src/renderer/src/components/TaskBoard.test.tsx code_review_server/frontend/src/components/Tasks/TasksPage.tsx docs/superpowers/plans/2026-06-29-r0-full-review.md
git commit -m "支持旧版本号0触发全量审查"
```

Expected: commit 成功。Skill 目录位于用户 Codex skill 目录外，不纳入当前 repo commit。

## Self-Review

- Spec coverage: 计划覆盖服务端校验、Electron Prompt、报告命名、表单提示、任务展示、两个 Skill 更新、测试与 Skill 位置说明。
- Placeholder scan: 无 `TBD`、`TODO` 或“之后补充”式步骤。
- Type consistency: 使用现有字段 `old_revision`、`new_revision`、`ReviewTask`、`TaskViewItem`，未引入新 API 字段。
