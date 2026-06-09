# 多 Skill 激活与客户端报告模板选择设计

## 背景

当前代码审查平台由 Web 服务端和 Electron 客户端组成。服务端已有 Skill 库，管理员可以上传 Skill 包并激活其中一个 Skill。客户端登录后会在环境检查阶段同步服务端当前激活的 Skill，安装到本机 Codex，然后在新建审查任务时通过 Codex 执行该 Skill，生成 Markdown 审查报告并上传报告内容。

现有实现的核心限制是服务端同一时间只有一个激活 Skill。为了支持客户端在新建任务时选择不同报告模板，需要让服务端允许多个 Skill 同时激活，客户端严格同步服务端激活列表，并在任务执行时根据用户选择强制启动对应 Skill。

本次改动必须保持现有任务创建、SVN URL、旧版本号、新版本号、报告预览、报告位置打开、报告图片读取等功能不变。模板选择是新增能力，不替代现有输入字段。

## 已确认决策

- 服务端 Skill 库允许多个不同名称的 Skill 同时处于激活状态。
- 管理员可以主动把已激活 Skill 改为不激活。
- 服务端必须阻止同名 Skill 的多个版本同时保持激活；激活同名新版本时自动取消旧同名版本的激活状态。
- 客户端每次环境检查时严格以服务端激活 Skill 列表为准。
- 服务端激活但客户端缺失或版本/hash 不一致的 Skill，客户端下载并安装。
- 服务端不再激活但客户端本地 manifest 中存在的 Skill，客户端删除本机 Codex 中的同名 Skill，并从 manifest 移除。
- 客户端新建任务表单保留原有 `项目路径 / SVN URL`、`旧版本号`、`新版本号`。
- 客户端在“开始审查”按钮上方新增同一行模板单选项：`模板一`、`模板二`。
- 模板一、模板二与 Skill 名称的关系固定写在客户端。
- 第一版采用固定映射，不需要服务端下发模板配置。
- 模板一对应 `通用-代码变更审查-模板一`。
- 模板二对应 `通用-代码变更审查-模板二`。
- 审查报告文件名从 `report.md` 改为 `代码审查报告.md`。
- 报告相关图片保存在任务工作区下的 `images/` 目录。
- Markdown 报告中的图片使用相对路径，例如 `images/example.png`。
- 文档、计划和提交信息使用中文。

## 目标

1. 支持服务端多个不同名 Skill 同时激活。
2. 支持服务端将已激活 Skill 改为不激活。
3. 客户端同步所有服务端激活 Skill，而不是只同步单个 active Skill。
4. 客户端清理服务端不再激活的本地 Skill。
5. 客户端新建任务时新增报告模板选择。
6. 选择模板一时强制使用模板一对应 Skill，选择模板二时强制使用模板二对应 Skill。
7. 任务报告输出为 `代码审查报告.md`，图片输出到同任务工作区的 `images/` 目录。
8. 保持现有报告上传、报告预览、历史报告读取、图片读取和查看报告位置能力。

## 非目标

第一版不做以下能力：

- 服务端动态配置模板一、模板二和 Skill 的对应关系。
- 客户端展示任意数量的模板选项。
- 模板三或更多模板。
- 管理端为 Skill 编辑模板标签。
- 服务端上传或保存报告图片文件。
- 跨客户端恢复历史报告图片。
- 改造报告 Markdown 的服务端存储模型。
- 改变当前 SVN 审查输入参数含义。
- 改变任务看板、历史报告、意见反馈等无关功能。

历史报告图片能力先保持现状：客户端本地预览通过报告文件所在目录读取相对图片资源。服务端仍主要保存 Markdown 报告内容。如果未来要求其他客户端也能查看历史报告图片，需要单独设计报告图片上传和服务端静态资源读取权限。

## 推荐方案

采用“服务端多激活 Skill + 客户端固定模板映射”的方案。

服务端负责维护当前激活 Skill 集合。客户端环境检查时获取所有激活 Skill 元信息，逐个校验本地 manifest 与服务端元信息是否一致；不一致则下载并通过 Codex 安装。客户端任务表单固定展示两个同一行单选项：`模板一`、`模板二`。用户选择模板后，客户端根据固定映射得到 Skill 名称，并在 Codex 审查 prompt 中明确强制使用该 Skill。

该方案符合当前架构，也便于后续增加非代码审查功能时随客户端版本一起扩展入口和流程。相比服务端动态模板配置，第一版更简单，风险更低。

## 服务端设计

### Skill 激活规则

当前 `SkillPackage.is_active` 字段继续保留，但语义从“唯一激活 Skill”改为“是否属于客户端应同步的激活 Skill 集合”。

激活规则：

- 激活某个 Skill 时，不再取消其他不同名称 Skill 的激活状态。
- 激活某个 Skill 时，如果存在同名且不同 ID 的已激活 Skill，必须先将旧同名 Skill 置为不激活，再激活当前 Skill。
- 同一时刻同一个 `name` 最多只有一个 `is_active = true` 的 Skill。
- 管理员可以对已激活 Skill 执行取消激活操作，将 `is_active` 改为 `false`。

### API 调整

保留现有管理端列表、上传、激活能力，并新增或调整以下接口：

```text
GET /api/v1/skills/active
```

返回所有激活 Skill 列表，不再返回单个对象。

```json
{
  "data": [
    {
      "id": "skill-id-1",
      "name": "通用-代码变更审查-模板一",
      "version": "1.0.0",
      "description": null,
      "content_hash": "abc...",
      "file_size": 12345,
      "is_active": true
    }
  ],
  "count": 1
}
```

```text
GET /api/v1/skills/{skill_id}/download
```

按 Skill ID 下载指定 Skill 包。客户端同步多个 Skill 时使用该接口。

```text
POST /api/v1/skills/{skill_id}/activate
```

激活指定 Skill。新语义下不再取消其他不同名 Skill。

```text
POST /api/v1/skills/{skill_id}/deactivate
```

取消激活指定 Skill。

兼容性处理：

- 如果现有客户端仍调用旧的单 active 接口，需要在客户端同步发布前确认是否保留兼容接口。
- 本次目标客户端会改为消费多 active 列表。

## 客户端同步设计

### 本地 manifest

本地 Skill manifest 从单对象改为多对象：

```json
{
  "skills": [
    {
      "id": "skill-id-1",
      "name": "通用-代码变更审查-模板一",
      "version": "1.0.0",
      "content_hash": "abc...",
      "hash": "abc...",
      "file_size": 12345,
      "package_path": ".../skill-id-1-1.0.0-abc.zip",
      "installed_at": "2026-06-09T10:00:00.000Z"
    }
  ]
}
```

客户端同步判断以服务端 active 列表为权威来源。每个 Skill 使用 `id`、`name`、`version`、`content_hash`、`file_size` 校验本地是否为最新。

### 同步流程

1. 环境检查确认 Codex CLI 和 SVN CLI 可用。
2. 客户端请求服务端所有激活 Skill。
3. 如果激活 Skill 列表为空，环境状态为 `missing_skill`。
4. 客户端读取本地 manifest。
5. 对服务端每个激活 Skill：
   - 本地无记录：下载并安装。
   - 本地记录存在但 `version`、`content_hash`、`file_size` 或包文件校验不一致：下载并安装。
   - 本地记录一致：跳过下载，视为已同步。
6. 对本地 manifest 中存在但服务端不再激活的 Skill：
   - 调用 Codex 删除同名 Skill。
   - 从 manifest 移除。
7. 全部安装、删除成功后写回 manifest。
8. 校验模板一、模板二固定 Skill 名称均存在于已同步激活 Skill 中。
9. 环境状态返回 `ready`。

### 安装提示词

安装单个 Skill 时，Codex 更新 Skill 的提示词应增强为：

```text
请将下面这个本地 Skill zip 包安装为 Codex 当前可用的最新 Skill。

这是服务端当前激活 Skill 列表中的一个条目，客户端正在按服务端激活列表同步本机 Codex Skill。

服务端 Skill 元信息：
- Skill ID：${skillId}
- Skill 名称：${skillName}
- Skill 版本：${version}
- 内容哈希：${contentHash}
- Skill zip 路径：${packagePath}

安装要求：
1. 直接读取 Skill zip 路径对应的 zip 文件，不要修改 zip 内容。
2. 安装前必须识别 zip 包内的 Skill 名称，并确认它与服务端 Skill 名称一致：${skillName}。
3. 在安装新包前，必须定位 Codex 当前已安装的所有同名 Skill：${skillName}。
4. 删除所有旧的同名 Skill，包括旧版本目录、缓存目录、注册信息或 Codex 机制中会影响同名 Skill 解析的旧记录。
5. 只能删除同名 Skill，不要删除其他名称的 Skill。
6. 删除完成后，安装当前 zip 包中的 Skill。
7. 安装后必须确认后续通过 Skill 名称 ${skillName} 调用时，只会使用本次安装的新版本。
8. 如果无法确认旧同名 Skill 已删除、无法确认新 Skill 已安装成功，或发现安装后的 Skill 名称与服务端元信息不一致，必须以失败状态结束。
9. 安装成功后只输出简短成功信息。

失败输出格式：
[SKILL_INSTALL_ERROR] <失败原因，包括已尝试的删除路径、安装步骤和失败细节>

成功输出格式：
[SKILL_INSTALL_OK] ${skillName}@${version}
```

### 删除提示词

服务端取消激活后，客户端删除本地同名 Skill 的提示词：

```text
请从 Codex 当前已安装的 Skill 中删除指定 Skill。

删除目标：
- Skill 名称：${skillName}
- 原服务端 Skill ID：${skillId}
- 原版本：${version}

删除要求：
1. 只删除名称为 ${skillName} 的 Skill。
2. 删除该名称下所有旧版本目录、缓存目录、注册信息或 Codex 机制中会影响同名 Skill 解析的记录。
3. 不要删除其他名称的 Skill。
4. 删除后必须确认后续通过 Skill 名称 ${skillName} 不会再启动到任何本地残留版本。
5. 如果无法确认删除成功，必须以失败状态结束。

失败输出格式：
[SKILL_DELETE_ERROR] <失败原因，包括已尝试的删除路径和失败细节>

成功输出格式：
[SKILL_DELETE_OK] ${skillName}
```

## 客户端任务表单设计

现有任务表单字段保留：

```text
项目路径 / SVN URL
旧版本号
新版本号
```

新增模板选择，放在“开始审查”按钮上方，两个选项在同一行：

```text
审查模板  ○ 模板一    ○ 模板二

[开始审查]
```

客户端固定模板配置：

```ts
const REVIEW_TEMPLATES = [
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
]
```

表单提交 payload 增加 `template_key`：

```ts
{
  svn_url: string
  old_revision: string
  new_revision: string
  template_key: 'template_1' | 'template_2'
}
```

默认选择 `template_1`。如果用户上次选择的模板仍然已同步且可用，可以沿用上次选择；第一版也可以只默认模板一。

## 任务与报告设计

### 任务记录

服务端任务模型建议增加以下字段，便于历史追溯：

```text
template_key
skill_name
```

客户端创建任务时传入所选模板 key 和对应 Skill 名称。服务端保存后，历史任务可以知道报告由哪个模板 Skill 生成。

### 本地产物目录

每个任务继续使用独立工作区。报告产物目录结构：

```text
workspaces/<taskId>/
  代码审查报告.md
  images/
    example.png
    example.jpg
```

报告路径生成逻辑从：

```text
workspaces/<taskId>/report.md
```

改为：

```text
workspaces/<taskId>/代码审查报告.md
```

图片目录为：

```text
workspaces/<taskId>/images/
```

Markdown 中引用图片使用相对路径：

```md
![截图](images/example.png)
```

### 审查启动 prompt

执行审查时，prompt 必须同时包含原有 SVN 参数和模板 Skill：

```text
请强制使用本机 Codex 已安装的 Skill：${skillName}

审查输入：
- 项目路径：${svnUrl}
- 旧版本号：${oldRevision}
- 新版本号：${newRevision}
- 报告输出路径：${reportPath}
- 图片保存目录：${imagesDir}

请严格按该 Skill 的输入模块、SVN 获取策略、规则模块、输出模块执行代码变更审查。
最终生成 Markdown 审查报告到报告输出路径：${reportPath}
如需生成或引用图片，请将图片保存到图片保存目录，并在 Markdown 中使用相对路径 images/<文件名> 引用。
```

现有错误处理规范继续保留，包括 `[CODEX_ERROR::<错误码>]` 输出约定。

## 错误处理

- 服务端没有激活任何 Skill：客户端环境状态为 `missing_skill`，不能开始审查。
- 服务端激活列表缺少模板一或模板二对应的固定 Skill：环境状态为 `missing_skill`，提示模板 Skill 未配置完整。
- 服务端激活同名 Skill 的新版本：服务端自动取消旧同名版本的激活状态，并只保留新版本为激活状态。
- Skill 下载失败：环境状态为 `missing_skill`，展示下载失败原因。
- Skill hash 或 file_size 校验失败：拒绝安装，环境状态为 `missing_skill`。
- Codex 安装 Skill 失败：环境状态为 `missing_skill`，展示 `[SKILL_INSTALL_ERROR]` 或进程失败信息。
- Codex 删除不再激活 Skill 失败：环境状态为 `missing_skill`，提示本地 Skill 清理失败。
- 用户选择的模板在本地 manifest 中不存在或与服务端 active 列表不一致：阻止任务启动，提示刷新环境或联系管理员。
- Codex 未生成 `代码审查报告.md` 或文件为空：沿用现有报告生成失败处理。
- `images/` 目录不存在不算失败。
- Markdown 引用了图片但图片读取失败：报告文本继续展示，图片位置显示加载失败或保持现有失败表现。

## 测试设计

### 服务端

- 上传 Skill 后可以激活。
- 多个不同名称 Skill 可以同时激活。
- 同名多个版本不能同时保持激活。
- 已激活 Skill 可以取消激活。
- `GET /skills/active` 返回所有激活 Skill。
- 按 ID 下载 Skill 包。
- 无激活 Skill 时 active 列表返回空集合。
- 非管理员不能激活或取消激活 Skill。
- 创建任务时可以保存 `template_key` 和 `skill_name`。

### 客户端主进程

- API client 获取多个 active skills。
- API client 按 ID 下载 Skill。
- Skill sync 下载并安装多个 active skills。
- Skill sync 对本地已是最新的 Skill 不重复下载。
- Skill sync 检测 hash/file_size 不一致并失败。
- Skill sync 删除服务端不再激活的本地 Skill。
- manifest 正确保存多个 Skill。
- 环境检查在模板一或模板二 Skill 缺失时返回 `missing_skill`。
- 模板一生成 prompt 时使用 `通用-代码变更审查-模板一`。
- 模板二生成 prompt 时使用 `通用-代码变更审查-模板二`。
- 报告路径为 `代码审查报告.md`。
- 图片目录为任务工作区下 `images/`。

### 客户端渲染进程

- 任务表单保留 SVN URL、旧版本号、新版本号。
- “开始审查”按钮上方展示同一行 `模板一`、`模板二` 单选项。
- 默认选中模板一。
- 选择模板二后提交 payload 包含 `template_key: template_2`。
- 环境未 ready 时仍按现有逻辑禁用任务提交。

### 回归验证

- 现有任务创建流程不变。
- 现有报告上传流程不变。
- 当前报告预览仍能展示 Markdown。
- 当前报告图片读取逻辑仍能从报告目录解析相对图片路径。
- 查看报告位置打开 `代码审查报告.md` 所在目录。
- 历史报告读取不因模板字段缺失而崩溃。

## 实施边界

本设计聚焦多 Skill 同步和客户端固定模板选择。实现时应尽量复用现有 Skill 上传、下载、安装、环境检查、任务执行和报告预览结构，只在必要边界扩展数据结构和 API。

当前仓库存在其他未提交改动，实施时不得回退或覆盖与本功能无关的用户改动。
