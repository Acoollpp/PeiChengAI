# 验证记录

## Task 14 最终清理、全量验证与文档更新（2026-06-02）

工作树：`/home/gpt/.config/superpowers/worktrees/PeiChengAI/codex-cch-key-svn-auth/Agent/code_review_platform`

### 残留搜索与清理结论

本次使用以下命令搜索邮箱身份残留：

```bash
rg -n "email|hashed_password|password-recovery|reset-password|login/access-token|signup|Sign up|Forgot your password|UserRegister|UpdatePassword|get_user_by_email|authenticate" code_review_server code_review_electron --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/out/**'
```

已清理 Web/Electron 活跃运行时和活跃前端测试中的旧邮箱注册、邮箱登录、找回密码、修改密码流程语义：

- 删除 `frontend/tests/sign-up.spec.ts` 和 `frontend/tests/reset-password.spec.ts`。
- `frontend/tests/auth.setup.ts`、`frontend/tests/utils/user.ts` 改为 Key/SVN 登录语义。
- `frontend/tests/utils/privateApi.ts`、`frontend/tests/admin.spec.ts`、`frontend/tests/items.spec.ts` 改为使用 `full_name`、`svn_username`、`is_superuser`、`is_active` 语义，不再使用 email/password 创建或登录用户。
- `frontend/tests/utils/mailcatcher.ts` 已删除。

允许残留分类：

- 历史文档、计划文档、release notes 中对旧模板或历史实现的说明。
- Alembic 迁移历史中的 email / hashed_password 字段增删记录。
- 后端旧路由移除测试，如 `/login/access-token`、`/password-recovery`、`/reset-password`、`/users/signup` 不可用断言。
- 非身份认证用途的 email 配置，例如 Traefik / Let's Encrypt 联系邮箱。
- 依赖锁文件、包名、邮件模板空壳或已禁用的邮件工具函数。
- `authenticate` 作为 Key 认证服务方法名或通用“已认证用户”测试描述，不代表旧邮箱认证流程。

### 验证命令与结果

后端测试使用测试 DB 环境变量运行：

```bash
cd code_review_server/backend
POSTGRES_SERVER=127.0.0.1 POSTGRES_PORT=55432 POSTGRES_USER=code_review POSTGRES_DB=code_review_auth_test POSTGRES_PASSWORD=67d683d5795d3bc3cb23ff91605e63146971b426d9ece3e4 /home/gpt/.local/bin/uv run pytest -q
```

结果：`112 passed`。本次按指定环境变量复跑时测试 DB 无需清理；若后续测试 DB 因中途失败残留脏数据，仅允许清理 `code_review_auth_test` 测试库后重跑。

后端 lint：

```bash
POSTGRES_SERVER=127.0.0.1 POSTGRES_PORT=55432 POSTGRES_USER=code_review POSTGRES_DB=code_review_auth_test POSTGRES_PASSWORD=67d683d5795d3bc3cb23ff91605e63146971b426d9ece3e4 /home/gpt/.local/bin/uv run ruff check app tests
```

结果：`All checks passed!`

Web TypeScript：

```bash
cd code_review_server/frontend
npx tsc -p tsconfig.build.json --noEmit
```

结果：通过，无 TypeScript 错误。

Web build：

```bash
npm run build
```

结果：环境失败。`tsc -p tsconfig.build.json` 阶段通过，Vite 阶段报告远程 Node.js `18.19.1` 低于 Vite 要求的 `20.19+` 或 `22.12+`，同时 Tailwind optional native binding 缺失。未见代码编译错误。

Electron typecheck：

```bash
cd code_review_electron
npm run typecheck
```

结果：通过。

Electron tests：

```bash
npm test
```

结果：`10` 个测试文件通过，`61` 个测试通过。
