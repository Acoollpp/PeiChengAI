# Codex Skill 分发与客户端运行目录设计

## 背景

当前 Electron 客户端把 Skill 和任务工作区放在 `app.getPath('userData')` 下，Windows 上通常会落到 C 盘用户数据目录。打包后的客户端实际部署目录是类似 `D:\SoftWare\代码审查客户端` 的固定目录，后续 Skill 包缓存和 Codex 任务工作区都应放在该客户端目录下，便于定位、排查和迁移。

Skill 分发的职责也需要收拢：服务端保存管理员上传的原始 zip 包，客户端只下载并校验这个原始 zip，最终由本机 Codex 从该 zip 路径安装到 Codex 自己的 Skill 目录。客户端不再解压 Skill，也不再把 Skill 复制到每个任务工作区。

## 目标

- 服务端作为 Skill 原始 zip 包的分发源，客户端不修改包内容。
- Electron 客户端在 exe 同级目录下维护 `runtime-data`。
- 客户端下载 active Skill zip 后进行完整性校验，并把 zip 路径交给 Codex 安装。
- Codex 任务工作区固定创建在客户端目录下的 `runtime-data/workspaces/<taskId>`。
- 任务执行时使用 Codex 已安装的 `通用-代码变更审查` Skill，不依赖工作区内复制的 `skills` 目录。
- 第一阶段实现只改 Electron 客户端；服务端 `file_size` 字段作为建议增强，由服务端侧另行处理。

## 非目标

- 不在客户端解析或改写 Skill zip 内部内容。
- 不在每个任务工作区复制 Skill。
- 不改变服务端现有上传、激活、下载 Skill 的主流程。
- 不在本设计中实现多 Skill 选择 UI。

## 目录结构

打包部署后，运行数据目录从 exe 所在目录推导：

```text
D:\SoftWare\代码审查客户端\
  CodeReviewClient.exe
  runtime-data\
    skill-packages\
      manifest.json
      <skillId>-<version>-<hash>.zip
    workspaces\
      <taskId>\
        report.md
```

开发环境下可使用 Electron 项目内的 `.runtime-data`，避免继续污染 C 盘用户数据目录。

## 组件设计

### RuntimePaths

新增统一路径模块，负责生成所有运行目录：

- `runtimeRoot`
- `skillPackagesDir`
- `skillManifestPath`
- `workspacesDir`
- `workspaceForTask(taskId)`
- `reportPathForTask(taskId)`

业务模块不再直接用 `app.getPath('userData')` 存放 Skill 和 workspace。

路径推导规则：

- 打包后：使用 `app.getPath('exe')` 的父目录作为客户端根目录。
- 开发环境：使用 Electron 项目目录下的 `.runtime-data`。
- 启动或环境检查时确认 `runtime-data` 可创建、可写。

### SkillSyncService

职责改为“下载原始 zip、校验、调用 Codex 安装”：

1. 请求 `/api/v1/skills/active` 获取 active Skill 元数据。
2. 读取本地 `runtime-data/skill-packages/manifest.json`。
3. 如果本地 manifest 与服务端 `id/version/content_hash` 匹配，且 zip 文件存在并通过 hash 校验，则跳过下载。
4. 否则下载 `/api/v1/skills/active/download` 的原始 zip。
5. 将 zip 保存为 `<skillId>-<version>-<hash>.zip`。
6. 计算本地 zip hash，与服务端 `content_hash` 比对。
7. 如果服务端提供 `file_size`，同时比对本地文件大小；若缺失，不阻塞流程。
8. 调用 Codex 安装命令，把 zip 文件路径交给 Codex。
9. 安装成功后写入 manifest。

manifest 示例：

```json
{
  "id": "skill-id",
  "version": "2026.05.29",
  "content_hash": "sha256...",
  "file_size": 123456,
  "package_path": "D:\\SoftWare\\代码审查客户端\\runtime-data\\skill-packages\\skill-id-2026.05.29-sha256.zip",
  "installed_at": "2026-05-29T10:00:00.000Z"
}
```

`file_size` 为可选字段。客户端应兼容服务端暂未提供该字段的情况。

### Codex 安装适配

新增 Codex Skill 安装适配层，封装具体命令：

- 输入：本地 zip 绝对路径。
- 输出：安装成功或失败原因。
- 要求：使用本机 Codex 支持的 Skill 安装能力，让 Codex 自己安装到它的 Skill 目录。

具体命令参数需要以当前 Codex CLI 支持的安装方式为准。该适配层应单独测试，避免安装命令散落在 `skill-sync.ts`。

### Task Workspace

`defaultPrepareWorkspace` 改为只创建任务目录和报告路径：

- `cwd = runtime-data/workspaces/<taskId>`
- `reportPath = runtime-data/workspaces/<taskId>/report.md`

不再创建或复制：

- `workspace/skills/通用-代码变更审查`
- Electron 解压后的 Skill 目录

### Codex Prompt

任务 prompt 改为要求 Codex 使用已安装的 Skill：

```text
请使用本机 Codex 已安装的 skill：通用-代码变更审查
```

不再引用：

```text
skills/通用-代码变更审查
```

## 错误处理

客户端需要区分并提示以下错误：

- 客户端运行目录不可写。
- 服务端没有 active Skill。
- Skill zip 下载失败。
- Skill zip hash 与服务端元数据不一致。
- Skill zip 文件大小与服务端 `file_size` 不一致。
- Codex Skill 安装失败。
- Codex CLI 不可用。
- SVN CLI 不可用。
- 任务 workspace 创建失败。

hash 不一致和文件大小不一致应视为高风险错误，不能继续安装。

## 服务端协作点

服务端当前已提供 active Skill 元数据和原始 zip 下载能力，客户端第一阶段可以只依赖 `id/version/content_hash`。

建议服务端补充 `file_size` 字段：

- 上传 Skill zip 时记录原始 zip 字节数。
- `/skills/active` 返回 `file_size`。
- 客户端下载后用 `file_size` 做快速完整性检查，再用 `content_hash` 做强校验。

该字段不是客户端第一阶段的硬依赖；如果服务端暂未提供，客户端只使用 hash 校验。

## 测试策略

Electron 侧测试覆盖：

- runtime path 在打包/开发环境下生成正确。
- runtime 目录不可写时返回明确错误。
- Skill manifest 匹配时跳过下载，但仍确认本地 zip hash。
- manifest 不匹配时下载原始 zip。
- hash 不一致时拒绝安装。
- `file_size` 存在且不一致时拒绝安装。
- Codex 安装命令收到的是 zip 绝对路径。
- workspace 创建在 `runtime-data/workspaces/<taskId>`。
- workspace 不再复制 Skill。
- prompt 使用已安装 Skill 名称，不再引用工作区 `skills/...`。

## 迁移策略

第一阶段不迁移 C 盘旧数据。客户端使用新的 `runtime-data` 后，旧 `userData/skills` 和 `userData/workspaces` 不再参与流程。

如果用户已有旧 Skill，登录后或点击安装 Skill 时会重新从服务端下载 active zip，并通过 Codex 安装。

## 验收标准

- 打包后客户端在 `D:\SoftWare\代码审查客户端\runtime-data` 下创建 Skill 包缓存和任务工作区。
- 客户端本地只保存服务端原始 zip，不解压 Skill。
- Skill 安装由 Codex 根据 zip 路径完成。
- 任务 workspace 不包含复制出来的 Skill 目录。
- 代码审查报告输出到 `runtime-data/workspaces/<taskId>/report.md`。
- 服务端未提供 `file_size` 时客户端仍可通过 hash 完成同步和安装。
