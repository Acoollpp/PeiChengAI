# 部门管理员权限实现计划

> **面向 agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加 `department_admin` 部门管理员角色，使其可只读查看本部门用户、查看下载本部门任务报告、维护本部门单部门审查方向，同时保持超级管理员、普通用户、CCH 同步、Electron 客户端现有流程稳定。

**Architecture:** 后端以 `UserRole.department_admin` 和统一权限辅助函数为基础，按资源拆分读取范围与写入范围，避免部门管理员读取权限扩散到写操作。前端 Web 拆分平台管理员守卫和管理用户守卫，并按角色渲染菜单与只读页面。Electron 只同步角色类型和未绑定部门提示，不引入部门管理员自选管理部门能力。

**Tech Stack:** FastAPI、SQLModel、pytest、React、TanStack Router、React Query、Zod、TypeScript、Electron、Vitest、OpenAPI TypeScript client。

---

## 文件结构

后端：

- 修改 `code_review_server/backend/app/models.py`：新增 `UserRole.department_admin`。
- 修改 `code_review_server/backend/app/api/deps.py`：新增平台管理员、部门管理员、管理用户权限函数，保留 `has_admin_privileges()` 为超级管理员判断。
- 修改 `code_review_server/backend/app/services/cch_sync_service.py`：保护人工设置的部门管理员角色，规范 `is_superuser`。
- 修改 `code_review_server/backend/app/api/routes/users.py`：用户列表和详情支持部门管理员读取范围；用户写接口保持超级管理员；新增部门管理员必须绑定部门校验。
- 修改 `code_review_server/backend/app/api/routes/review_tasks.py`：拆分任务读取与写入权限；统计和搜索按角色范围工作。
- 修改 `code_review_server/backend/app/api/routes/review_focus_directions.py`：方向库读写按超级管理员和部门管理员分流；共享方向仅超级管理员维护。
- 修改 `code_review_server/backend/app/api/routes/feedback.py`：仅做回归保护，部门管理员继续按本人反馈口径。
- 修改测试：
  - `code_review_server/backend/tests/api/routes/test_users_roles.py`
  - `code_review_server/backend/tests/services/test_cch_sync_service.py`
  - `code_review_server/backend/tests/api/routes/test_users.py`
  - `code_review_server/backend/tests/api/routes/test_review_tasks.py`
  - `code_review_server/backend/tests/api/routes/test_review_focus_directions.py`
  - `code_review_server/backend/tests/api/routes/test_feedback.py`

前端 Web：

- 修改 `code_review_server/frontend/src/lib/authz.ts`：新增三类权限判断。
- 修改 `code_review_server/frontend/src/lib/admin-route.ts`：新增 `requirePlatformAdminUser()`、`requireManagementUser()`，保留兼容导出。
- 修改 `code_review_server/frontend/src/routes/_layout/admin.tsx`：移除父路由超级管理员硬守卫。
- 修改 `code_review_server/frontend/src/routes/_layout/admin.users.tsx`、`admin.review-focus-directions.tsx`、`admin.skills.tsx`、`admin.client-releases.tsx`、`items.tsx`：按页面应用对应守卫。
- 修改 `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`：部门管理员菜单显示用户管理、重点审查方向、意见管理、任务管理。
- 修改 `code_review_server/frontend/src/components/Admin/UsersPage.tsx`、`columns.tsx`、`AddUser.tsx`、`EditUser.tsx`、用户操作菜单组件：部门管理员用户管理只读；超级管理员表单支持部门管理员角色。
- 修改 `code_review_server/frontend/src/components/Admin/ReviewFocusDirectionsPage.tsx`：部门管理员隐藏跨部门/全局/统计导出等平台级控件。
- 重新生成 `code_review_server/frontend/src/client/*.gen.ts`。

Electron：

- 修改 `code_review_electron/src/shared/types.ts`：`CurrentUser.role` 增加 `department_admin`。
- 修改 `code_review_electron/src/renderer/src/App.tsx`：部门管理员未绑定部门时显示联系超级管理员提示，不进入自选部门流程。
- 修改 `code_review_electron/src/renderer/src/App.test.tsx`：覆盖部门管理员未绑定部门行为。

---

### Task 1: 后端角色枚举与权限辅助函数

**Files:**

- Modify: `code_review_server/backend/app/models.py`
- Modify: `code_review_server/backend/app/api/deps.py`
- Test: `code_review_server/backend/tests/api/routes/test_users_roles.py`

- [ ] **Step 1: 写失败测试**

在 `code_review_server/backend/tests/api/routes/test_users_roles.py` 追加：

```python
from fastapi import HTTPException

from app.api.deps import (
    ensure_department_admin_has_department,
    has_admin_privileges,
    has_department_admin_privileges,
    has_management_privileges,
    has_platform_admin_privileges,
)


def test_department_admin_role_exists_and_is_not_platform_admin() -> None:
    user = User(role=UserRole.department_admin)

    assert user.role == UserRole.department_admin
    assert has_platform_admin_privileges(user) is False
    assert has_admin_privileges(user) is False


def test_department_admin_requires_department_for_department_privileges() -> None:
    user = User(role=UserRole.department_admin, department_id=None)

    assert has_department_admin_privileges(user) is False
    assert has_management_privileges(user) is True


def test_department_admin_with_department_has_department_privileges() -> None:
    user = User(role=UserRole.department_admin)

    assert user.department_id is not None
    assert has_department_admin_privileges(user) is True
    assert has_management_privileges(user) is True


def test_ensure_department_admin_has_department_rejects_unbound_admin() -> None:
    user = User(role=UserRole.department_admin, department_id=None)

    try:
        ensure_department_admin_has_department(user)
    except HTTPException as exc:
        assert exc.status_code == 403
        assert exc.detail == "当前账号未绑定部门，请联系超级管理员。"
    else:
        raise AssertionError("Expected HTTPException")
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_users_roles.py -q
```

Expected: FAIL，原因是 `UserRole.department_admin` 和新权限函数不存在。

- [ ] **Step 3: 实现角色与权限函数**

在 `code_review_server/backend/app/models.py` 修改：

```python
class UserRole(str, Enum):
    admin = "admin"
    department_admin = "department_admin"
    user = "user"
```

在 `code_review_server/backend/app/api/deps.py` 修改：

```python
def has_platform_admin_privileges(user: User) -> bool:
    return user.role == UserRole.admin


def has_admin_privileges(user: User) -> bool:
    return has_platform_admin_privileges(user)


def has_department_admin_privileges(user: User) -> bool:
    return user.role == UserRole.department_admin and user.department_id is not None


def has_management_privileges(user: User) -> bool:
    return user.role in {UserRole.admin, UserRole.department_admin}


def ensure_department_admin_has_department(user: User) -> None:
    if user.role == UserRole.department_admin and user.department_id is None:
        raise HTTPException(
            status_code=403,
            detail="当前账号未绑定部门，请联系超级管理员。",
        )


def get_current_active_admin(current_user: CurrentUser) -> User:
    if not has_platform_admin_privileges(current_user):
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user


def get_current_active_management_user(current_user: CurrentUser) -> User:
    if not has_management_privileges(current_user):
        raise HTTPException(status_code=403, detail="没有足够权限")
    ensure_department_admin_has_department(current_user)
    return current_user
```

保留：

```python
get_current_active_superuser = get_current_active_admin
```

- [ ] **Step 4: 运行测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_users_roles.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add code_review_server/backend/app/models.py code_review_server/backend/app/api/deps.py code_review_server/backend/tests/api/routes/test_users_roles.py
git commit -m "新增部门管理员角色权限基础"
```

---

### Task 2: CCH 同步保护部门管理员角色

**Files:**

- Modify: `code_review_server/backend/app/services/cch_sync_service.py`
- Test: `code_review_server/backend/tests/services/test_cch_sync_service.py`

- [ ] **Step 1: 写失败测试**

在 `code_review_server/backend/tests/services/test_cch_sync_service.py` 追加：

```python
from datetime import datetime, timezone

from app.models import AuthSource, Department, User, UserRole
from app.services.cch_sync_service import CchSyncService, CchUserRow


def test_cch_sync_preserves_existing_department_admin_role_and_department(
    db: Session,
) -> None:
    department = Department(name=f"CCH部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    user = User(
        full_name="部门管理员",
        auth_source=AuthSource.cch,
        cch_user_id=9001,
        role=UserRole.department_admin,
        department_id=department.id,
        is_superuser=False,
    )
    db.add(user)
    db.commit()

    result = CchSyncService().sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=9001,
                full_name="同步后的姓名",
                role=UserRole.user,
                is_superuser=False,
            )
        ],
        keys=[],
        synced_at=datetime.now(timezone.utc),
    )

    db.refresh(user)
    assert result.updated == 1
    assert user.role == UserRole.department_admin
    assert user.department_id == department.id
    assert user.is_superuser is False


def test_cch_sync_normalizes_department_admin_when_source_provides_it() -> None:
    assert CchSyncService()._normalize_role("department_admin") == UserRole.department_admin


def test_cch_sync_aligns_is_superuser_with_final_role(db: Session) -> None:
    user = User(
        full_name="普通用户",
        auth_source=AuthSource.cch,
        cch_user_id=9002,
        role=UserRole.user,
        is_superuser=False,
    )
    db.add(user)
    db.commit()

    CchSyncService().sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=9002,
                full_name="普通用户",
                role=UserRole.user,
                is_superuser=True,
            )
        ],
        keys=[],
        synced_at=datetime.now(timezone.utc),
    )

    db.refresh(user)
    assert user.role == UserRole.user
    assert user.is_superuser is False
```

如果文件缺少导入，补齐：

```python
from sqlmodel import Session
from tests.utils.utils import random_lower_string
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py -q
```

Expected: FAIL，原因是同步会把 `department_admin` 降级为 `user`，且 `_normalize_role("department_admin")` 不支持。

- [ ] **Step 3: 实现 CCH 同步规则**

在 `code_review_server/backend/app/services/cch_sync_service.py` 修改 `_normalize_role()`：

```python
def _normalize_role(self, role: str | UserRole) -> UserRole:
    if isinstance(role, UserRole):
        return role
    if role == UserRole.admin.value:
        return UserRole.admin
    if role == UserRole.department_admin.value:
        return UserRole.department_admin
    return UserRole.user
```

新增：

```python
def _final_role_for_user(self, user: User | None, row: CchUserRow) -> UserRole:
    synced_role = self._sync_role(row)
    if user is not None and user.role == UserRole.department_admin:
        if synced_role == UserRole.user:
            return UserRole.department_admin
    return synced_role
```

在 `sync_rows()` 用户循环内把：

```python
role = self._sync_role(row)
```

改为：

```python
role = self._final_role_for_user(user, row)
```

把：

```python
user.is_superuser = row.is_superuser
```

改为：

```python
user.is_superuser = role == UserRole.admin
```

不要写入 `user.department_id`，保持现有部门归属不被 CCH 同步覆盖。

- [ ] **Step 4: 运行测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py tests/api/routes/test_users_roles.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add code_review_server/backend/app/services/cch_sync_service.py code_review_server/backend/tests/services/test_cch_sync_service.py
git commit -m "保护CCH同步中的部门管理员角色"
```

---

### Task 3: 用户接口支持部门管理员只读范围

**Files:**

- Modify: `code_review_server/backend/app/api/routes/users.py`
- Test: `code_review_server/backend/tests/api/routes/test_users.py`

- [ ] **Step 1: 写失败测试**

在 `code_review_server/backend/tests/api/routes/test_users.py` 追加：

```python
from app.models import Department, UserRole
from tests.utils.user import authentication_token_from_key, create_key_user
from tests.utils.utils import random_lower_string


def _create_department_admin(
    *,
    client: TestClient,
    db: Session,
    department: Department | None,
) -> dict[str, object]:
    user, api_key = create_key_user(db)
    user.role = UserRole.department_admin
    user.is_superuser = False
    user.department_id = department.id if department else None
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "user": user,
        "headers": authentication_token_from_key(client=client, key=api_key.key, db=db),
    }


def test_department_admin_lists_only_own_department_users(
    client: TestClient,
    db: Session,
) -> None:
    department_a = Department(name=f"部门A-{random_lower_string()}")
    department_b = Department(name=f"部门B-{random_lower_string()}")
    db.add(department_a)
    db.add(department_b)
    db.commit()
    db.refresh(department_a)
    db.refresh(department_b)
    admin_context = _create_department_admin(client=client, db=db, department=department_a)
    user_a, _ = create_key_user(db)
    user_a.department_id = department_a.id
    user_b, _ = create_key_user(db)
    user_b.department_id = department_b.id
    db.add(user_a)
    db.add(user_b)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/users/",
        headers=admin_context["headers"],
    )

    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["data"]}
    assert str(user_a.id) in ids
    assert str(admin_context["user"].id) in ids
    assert str(user_b.id) not in ids


def test_department_admin_user_list_requires_department(
    client: TestClient,
    db: Session,
) -> None:
    admin_context = _create_department_admin(client=client, db=db, department=None)

    response = client.get(
        f"{settings.API_V1_STR}/users/",
        headers=admin_context["headers"],
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "当前账号未绑定部门，请联系超级管理员。"


def test_department_admin_can_read_same_department_user(
    client: TestClient,
    db: Session,
) -> None:
    department = Department(name=f"部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    admin_context = _create_department_admin(client=client, db=db, department=department)
    user, _ = create_key_user(db)
    user.department_id = department.id
    db.add(user)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=admin_context["headers"],
    )

    assert response.status_code == 200
    assert response.json()["id"] == str(user.id)


def test_department_admin_cannot_read_other_department_user(
    client: TestClient,
    db: Session,
) -> None:
    department_a = Department(name=f"部门A-{random_lower_string()}")
    department_b = Department(name=f"部门B-{random_lower_string()}")
    db.add(department_a)
    db.add(department_b)
    db.commit()
    db.refresh(department_a)
    db.refresh(department_b)
    admin_context = _create_department_admin(client=client, db=db, department=department_a)
    user, _ = create_key_user(db)
    user.department_id = department_b.id
    db.add(user)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=admin_context["headers"],
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "没有足够权限"


def test_department_admin_cannot_create_update_or_delete_users(
    client: TestClient,
    db: Session,
) -> None:
    department = Department(name=f"部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    admin_context = _create_department_admin(client=client, db=db, department=department)
    user, _ = create_key_user(db)

    create_response = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=admin_context["headers"],
        json={"svn_username": f"svn-{random_lower_string()}", "role": "user"},
    )
    update_response = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=admin_context["headers"],
        json={"full_name": "不允许修改"},
    )
    delete_response = client.delete(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=admin_context["headers"],
    )

    assert create_response.status_code == 403
    assert update_response.status_code == 403
    assert delete_response.status_code == 403


def test_create_department_admin_requires_department(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json={
            "svn_username": f"svn-{random_lower_string()}",
            "role": "department_admin",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "部门管理员必须绑定部门。"
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_users.py -q
```

Expected: FAIL，原因是 `GET /users/` 仍依赖超级管理员，且 `department_admin` 创建未校验部门。

- [ ] **Step 3: 实现用户接口权限**

在 `users.py` 导入：

```python
from app.api.deps import (
    CurrentUser,
    SessionDep,
    ensure_department_admin_has_department,
    get_current_active_admin,
    has_admin_privileges,
    has_management_privileges,
)
```

新增：

```python
def _ensure_department_admin_can_read_user(
    *, current_user: User, target_user: User
) -> None:
    if current_user.role != UserRole.department_admin:
        return
    ensure_department_admin_has_department(current_user)
    if target_user.department_id != current_user.department_id:
        raise HTTPException(status_code=403, detail="没有足够权限")


def _ensure_department_admin_role_has_department(
    *, session: SessionDep, role: UserRole | None, department_id: uuid.UUID | None
) -> Department | None:
    department = _ensure_department_exists(session=session, department_id=department_id)
    if role == UserRole.department_admin:
        if department is None:
            raise HTTPException(status_code=400, detail="部门管理员必须绑定部门。")
        if not department.is_active:
            raise HTTPException(status_code=400, detail="部门不存在或已停用。")
    return department
```

把 `read_users()` decorator 从：

```python
dependencies=[Depends(get_current_active_admin)]
```

改为无 dependency，并在函数签名加入：

```python
current_user: CurrentUser,
```

函数开头：

```python
if not has_management_privileges(current_user):
    raise HTTPException(status_code=403, detail="没有足够权限")
filters = []
if current_user.role == UserRole.department_admin:
    ensure_department_admin_has_department(current_user)
    filters.append(User.department_id == current_user.department_id)
```

保留搜索逻辑，把搜索过滤 append 到同一个 `filters`。

在 `create_user()` 中用 `_ensure_department_admin_role_has_department()` 替换当前部门校验：

```python
department = _ensure_department_admin_role_has_department(
    session=session,
    role=user_in.role,
    department_id=user_in.department_id,
)
```

在 `read_user_by_id()` 中，`user is None` 判断应在权限判断前：

```python
if user is None:
    raise HTTPException(status_code=404, detail="User not found")
if user == current_user:
    ...
if has_admin_privileges(current_user):
    ...
if current_user.role == UserRole.department_admin:
    _ensure_department_admin_can_read_user(
        current_user=current_user,
        target_user=user,
    )
    return _user_public(...)
raise HTTPException(status_code=403, detail="The user doesn't have enough privileges")
```

在 `update_user()` 中，如果 `user_in.role` 是 `department_admin` 或正在把用户改成部门管理员，调用 `_ensure_department_admin_role_has_department()`。如果 `role` 未传但原用户已是部门管理员且更新部门为空，也返回 400。

在 `update_user_me_department()` 开头新增：

```python
if current_user.role == UserRole.department_admin:
    raise HTTPException(
        status_code=403,
        detail="当前账号未绑定部门，请联系超级管理员。",
    )
```

- [ ] **Step 4: 运行测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_users.py tests/api/routes/test_users_roles.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add code_review_server/backend/app/api/routes/users.py code_review_server/backend/tests/api/routes/test_users.py
git commit -m "限制部门管理员用户管理范围"
```

---

### Task 4: 任务报告读取与写入权限拆分

**Files:**

- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`

- [ ] **Step 1: 写失败测试**

在 `code_review_server/backend/tests/api/routes/test_review_tasks.py` 追加：

```python
def _create_department_admin_headers(
    *, client: TestClient, db: Session, department: Department
) -> dict[str, str]:
    user, api_key = create_key_user(db)
    user.role = UserRole.department_admin
    user.department_id = department.id
    user.is_superuser = False
    db.add(user)
    db.commit()
    return authentication_token_from_key(client=client, key=api_key.key, db=db)


def _create_department_user_headers(
    *, client: TestClient, db: Session, department: Department
) -> tuple[dict[str, str], object]:
    user, api_key = create_key_user(db)
    user.department_id = department.id
    db.add(user)
    db.commit()
    db.refresh(user)
    return authentication_token_from_key(client=client, key=api_key.key, db=db), user


def test_department_admin_lists_only_department_tasks(
    client: TestClient,
    db: Session,
) -> None:
    department_a = Department(name=f"任务部门A-{random_lower_string()}")
    department_b = Department(name=f"任务部门B-{random_lower_string()}")
    db.add(department_a)
    db.add(department_b)
    db.commit()
    db.refresh(department_a)
    db.refresh(department_b)
    admin_headers = _create_department_admin_headers(
        client=client, db=db, department=department_a
    )
    headers_a, user_a = _create_department_user_headers(
        client=client, db=db, department=department_a
    )
    headers_b, user_b = _create_department_user_headers(
        client=client, db=db, department=department_b
    )
    task_a = _create_review_task(client, headers_a, old_revision="101")
    task_b = _create_review_task(client, headers_b, old_revision="201")

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=admin_headers,
    )

    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["data"]}
    assert task_a["id"] in ids
    assert task_b["id"] not in ids
    assert str(user_a.id) != str(user_b.id)


def test_department_admin_can_download_department_report(
    client: TestClient,
    db: Session,
    tmp_path: Path,
) -> None:
    department = Department(name=f"报告部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    admin_headers = _create_department_admin_headers(
        client=client, db=db, department=department
    )
    user_headers, _ = _create_department_user_headers(
        client=client, db=db, department=department
    )
    task = _create_review_task(client, user_headers, old_revision="301")
    report = tmp_path / "代码审查报告.md"
    report.write_text("# 报告", encoding="utf-8")
    db_task = db.get(ReviewTask, UUID(task["id"]))
    assert db_task is not None
    db_task.report_path = str(report)
    db_task.report_name = "代码审查报告.md"
    db.add(db_task)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/download",
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.text == "# 报告"


def test_department_admin_cannot_delete_member_task(
    client: TestClient,
    db: Session,
) -> None:
    department = Department(name=f"写权限部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    admin_headers = _create_department_admin_headers(
        client=client, db=db, department=department
    )
    user_headers, _ = _create_department_user_headers(
        client=client, db=db, department=department
    )
    task = _create_review_task(client, user_headers, old_revision="401")

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=admin_headers,
    )

    assert response.status_code == 403


def test_department_admin_can_update_own_task_status(
    client: TestClient,
    db: Session,
) -> None:
    department = Department(name=f"自有任务部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    admin_headers = _create_department_admin_headers(
        client=client, db=db, department=department
    )
    task = _create_review_task(client, admin_headers, old_revision="501")

    response = client.patch(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/status",
        headers=admin_headers,
        json={"status": "running_codex"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "running_codex"
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -q
```

Expected: FAIL，原因是部门管理员按普通用户处理，无法读取本部门成员任务。

- [ ] **Step 3: 实现任务读写范围**

在 `review_tasks.py` 导入：

```python
from app.api.deps import (
    CurrentUser,
    SessionDep,
    ensure_department_admin_has_department,
    has_admin_privileges,
)
from app.models import UserRole
```

替换 `_task_scope_filters()`：

```python
def _task_read_scope_filters(current_user: CurrentUser) -> list[Any]:
    if has_admin_privileges(current_user):
        return []
    if current_user.role == UserRole.department_admin:
        ensure_department_admin_has_department(current_user)
        return [ReviewTask.department_id == current_user.department_id]
    return [ReviewTask.user_id == current_user.id]
```

新增：

```python
def _can_write_task(current_user: CurrentUser, task: ReviewTask) -> bool:
    return has_admin_privileges(current_user) or task.user_id == current_user.id


def _get_task_for_read(
    *, session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> ReviewTask:
    task = session.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Review task not found")
    if has_admin_privileges(current_user):
        return task
    if current_user.role == UserRole.department_admin:
        ensure_department_admin_has_department(current_user)
        if task.department_id == current_user.department_id:
            return task
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if task.user_id == current_user.id:
        return task
    raise HTTPException(status_code=403, detail="Not enough permissions")


def _get_task_for_write(
    *, session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> ReviewTask:
    task = session.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Review task not found")
    if not _can_write_task(current_user, task):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return task
```

将读接口调用改为 `_get_task_for_read()`：

- `read_review_task`
- `read_review_task_report`
- `download_review_task_report`
- `download_review_task_pdf_report`

将写接口调用改为 `_get_task_for_write()`：

- `delete_review_task`
- `update_review_task_status`
- `upload_review_task_report`
- `upload_review_task_pdf_report`
- `upload_review_task_requirement_file`

`read_review_tasks()` filters 开头改为：

```python
filters = [*_task_read_scope_filters(current_user)]
```

`read_review_task_stats()` filters 改为：

```python
filters = [
    *_task_read_scope_filters(current_user),
    *_range_filters(range),
]
```

`reports_by_user` 条件改为管理用户可见：

```python
if has_admin_privileges(current_user) or current_user.role == UserRole.department_admin:
    ...
```

- [ ] **Step 4: 运行测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add code_review_server/backend/app/api/routes/review_tasks.py code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "拆分部门管理员任务读写权限"
```

---

### Task 5: 重点审查方向库部门管理员权限

**Files:**

- Modify: `code_review_server/backend/app/api/routes/review_focus_directions.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_focus_directions.py`

- [ ] **Step 1: 写失败测试**

在 `code_review_server/backend/tests/api/routes/test_review_focus_directions.py` 追加：

```python
from app.models import ReviewFocusDirectionDepartment, UserRole


def _department_admin_headers(
    *, client: TestClient, db: Session, department: Department
) -> dict[str, str]:
    user, api_key = create_key_user(db)
    user.role = UserRole.department_admin
    user.department_id = department.id
    db.add(user)
    db.commit()
    return authentication_token_from_key(client=client, key=api_key.key, db=db)


def test_department_admin_can_create_own_department_direction(
    client: TestClient,
    db: Session,
) -> None:
    department = _create_department(db)
    headers = _department_admin_headers(client=client, db=db, department=department)

    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=headers,
        json={
            "title": "本部门方向",
            "content": "检查本部门权限边界",
            "department_id": str(department.id),
            "is_active": True,
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["title"] == "本部门方向"
    assert content["departments"][0]["id"] == str(department.id)


def test_department_admin_cannot_create_global_or_other_department_direction(
    client: TestClient,
    db: Session,
) -> None:
    department = _create_department(db, "部门A-" + random_lower_string())
    other_department = _create_department(db, "部门B-" + random_lower_string())
    headers = _department_admin_headers(client=client, db=db, department=department)

    global_response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=headers,
        json={"title": "全局", "content": "不允许", "is_active": True},
    )
    other_response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=headers,
        json={
            "title": "其他部门",
            "content": "不允许",
            "department_id": str(other_department.id),
            "is_active": True,
        },
    )

    assert global_response.status_code == 403
    assert global_response.json()["detail"] == "只能维护本部门审查方向。"
    assert other_response.status_code == 403
    assert other_response.json()["detail"] == "只能维护本部门审查方向。"


def test_department_admin_cannot_edit_shared_direction(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department = _create_department(db, "共享A-" + random_lower_string())
    other_department = _create_department(db, "共享B-" + random_lower_string())
    headers = _department_admin_headers(client=client, db=db, department=department)
    create_response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json={
            "title": "共享方向",
            "content": "共享内容",
            "department_ids": [str(department.id), str(other_department.id)],
            "is_active": True,
        },
    )
    assert create_response.status_code == 200
    direction_id = create_response.json()["id"]

    response = client.patch(
        f"{settings.API_V1_STR}/review-focus-directions/{direction_id}",
        headers=headers,
        json={"title": "尝试修改"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "共享方向只能由超级管理员维护。"
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_focus_directions.py -q
```

Expected: FAIL，原因是方向库接口仍统一依赖 `_ensure_admin()`。

- [ ] **Step 3: 实现方向库权限**

在 `review_focus_directions.py` 导入：

```python
from app.api.deps import (
    CurrentUser,
    SessionDep,
    ensure_department_admin_has_department,
    has_admin_privileges,
    has_management_privileges,
)
from app.models import UserRole
```

新增：

```python
def _ensure_management_user(current_user: CurrentUser) -> None:
    if not has_management_privileges(current_user):
        raise HTTPException(status_code=403, detail="没有足够权限")
    ensure_department_admin_has_department(current_user)


def _ensure_department_admin_direction_input(
    *, current_user: CurrentUser, department_ids: list[uuid.UUID]
) -> None:
    if current_user.role != UserRole.department_admin:
        return
    ensure_department_admin_has_department(current_user)
    if department_ids != [current_user.department_id]:
        raise HTTPException(status_code=403, detail="只能维护本部门审查方向。")


def _is_single_department_direction_for_current_user(
    *, current_user: CurrentUser, departments: list[Department]
) -> bool:
    return (
        current_user.role == UserRole.department_admin
        and len(departments) == 1
        and departments[0].id == current_user.department_id
    )
```

把管理列表、创建、更新、删除 decorator 的 `dependencies=[Depends(_ensure_admin)]` 移除，改为函数体内调用 `_ensure_management_user(current_user)`。

在 `read_review_focus_directions()` 中：

```python
_ensure_management_user(current_user)
if current_user.role == UserRole.department_admin:
    conditions.append(
        exists().where(
            (ReviewFocusDirectionDepartment.direction_id == ReviewFocusDirection.id)
            & (ReviewFocusDirectionDepartment.department_id == current_user.department_id)
        )
    )
```

在 `_create_direction()` 中，算出 `department_ids` 后调用：

```python
_ensure_department_admin_direction_input(
    current_user=current_user,
    department_ids=department_ids,
)
```

在 `update_review_focus_direction()` 获取 `departments` 后：

```python
if current_user.role == UserRole.department_admin:
    existing_departments = _departments_by_direction(
        session=session,
        direction_ids=[direction.id],
    ).get(direction.id, [])
    if not _is_single_department_direction_for_current_user(
        current_user=current_user,
        departments=existing_departments,
    ):
        raise HTTPException(
            status_code=403,
            detail="共享方向只能由超级管理员维护。",
        )
    if department_input_was_set:
        _ensure_department_admin_direction_input(
            current_user=current_user,
            department_ids=_department_ids_from_input(direction_in) or [],
        )
```

在 `delete_review_focus_direction()` 中同样加载已有 departments；部门管理员只能停用单部门且为自己部门的方向，否则 403。

保持以下接口仅超级管理员：

- `/usage-stats`
- `/usage-stats/state`
- `/usage-stats/export`
- `/from-usage`

- [ ] **Step 4: 运行测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_focus_directions.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add code_review_server/backend/app/api/routes/review_focus_directions.py code_review_server/backend/tests/api/routes/test_review_focus_directions.py
git commit -m "限制部门管理员方向库维护范围"
```

---

### Task 6: 意见反馈部门管理员口径回归

**Files:**

- Modify: `code_review_server/backend/tests/api/routes/test_feedback.py`
- Modify only if needed: `code_review_server/backend/app/api/routes/feedback.py`

- [ ] **Step 1: 写回归测试**

在 `code_review_server/backend/tests/api/routes/test_feedback.py` 追加：

```python
from app.models import Department, UserRole
from tests.utils.user import authentication_token_from_key, create_key_user
from tests.utils.utils import random_lower_string


def _feedback_department_admin_headers(
    *, client: TestClient, db: Session, department: Department
) -> dict[str, str]:
    user, api_key = create_key_user(db)
    user.role = UserRole.department_admin
    user.department_id = department.id
    db.add(user)
    db.commit()
    return authentication_token_from_key(client=client, key=api_key.key, db=db)


def test_department_admin_feedback_scope_remains_self_only(
    client: TestClient,
    db: Session,
) -> None:
    department = Department(name=f"反馈部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    admin_headers = _feedback_department_admin_headers(
        client=client, db=db, department=department
    )
    member_user, member_key = create_key_user(db)
    member_user.department_id = department.id
    db.add(member_user)
    db.commit()
    member_headers = authentication_token_from_key(
        client=client, key=member_key.key, db=db
    )
    member_response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=member_headers,
        data={"description": "成员反馈"},
    )
    assert member_response.status_code == 200
    own_response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=admin_headers,
        data={"description": "本人反馈"},
    )
    assert own_response.status_code == 200

    list_response = client.get(
        f"{settings.API_V1_STR}/feedback",
        headers=admin_headers,
    )
    stats_response = client.get(
        f"{settings.API_V1_STR}/feedback/stats?range=all",
        headers=admin_headers,
    )

    assert list_response.status_code == 200
    descriptions = {item["description"] for item in list_response.json()["data"]}
    assert "本人反馈" in descriptions
    assert "成员反馈" not in descriptions
    assert stats_response.status_code == 200
    assert stats_response.json()["total"] == 1
```

- [ ] **Step 2: 运行测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_feedback.py -q
```

Expected: PASS。

- [ ] **Step 3: 确认反馈接口保持本人范围**

确认 `feedback.py` 中的 `_feedback_scope_filters()` 保持以下代码：

```python
def _feedback_scope_filters(current_user: CurrentUser) -> list[Any]:
    if has_admin_privileges(current_user):
        return []
    return [Feedback.user_id == current_user.id]
```

确认 `read_feedback()` 中使用以下管理员判断：

```python
is_admin = has_admin_privileges(current_user)
```

如果代码已保持上述实现，不修改 `feedback.py`。

- [ ] **Step 4: 重新运行测试**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_feedback.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add code_review_server/backend/tests/api/routes/test_feedback.py code_review_server/backend/app/api/routes/feedback.py
git commit -m "明确部门管理员反馈本人范围"
```

---

### Task 7: 前端 Web 权限、菜单、用户只读和方向库界面

**Files:**

- Modify: `code_review_server/frontend/src/lib/authz.ts`
- Modify: `code_review_server/frontend/src/lib/admin-route.ts`
- Modify: `code_review_server/frontend/src/routes/_layout/admin.tsx`
- Modify: `code_review_server/frontend/src/routes/_layout/admin.users.tsx`
- Modify: `code_review_server/frontend/src/routes/_layout/admin.review-focus-directions.tsx`
- Modify: `code_review_server/frontend/src/routes/_layout/admin.skills.tsx`
- Modify: `code_review_server/frontend/src/routes/_layout/admin.client-releases.tsx`
- Modify: `code_review_server/frontend/src/routes/_layout/items.tsx`
- Modify: `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/UsersPage.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/AddUser.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/EditUser.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/columns.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/ReviewFocusDirectionsPage.tsx`
- Generated: `code_review_server/frontend/src/client/*.gen.ts`

- [ ] **Step 1: 更新权限工具函数**

在 `authz.ts` 改为：

```typescript
import type { UserPublic } from "@/client"

type UserWithRole = UserPublic & {
  role?: string | null
}

export function hasPlatformAdminPrivileges(user: UserWithRole | null | undefined) {
  return user?.role === "admin"
}

export function hasDepartmentAdminPrivileges(user: UserWithRole | null | undefined) {
  return user?.role === "department_admin"
}

export function hasManagementPrivileges(user: UserWithRole | null | undefined) {
  return hasPlatformAdminPrivileges(user) || hasDepartmentAdminPrivileges(user)
}

export const hasAdminPrivileges = hasPlatformAdminPrivileges
```

在 `admin-route.ts` 增加：

```typescript
import {
  hasManagementPrivileges,
  hasPlatformAdminPrivileges,
} from "@/lib/authz"

async function readCurrentUserOrRedirect() {
  try {
    return await UsersService.readUserMe()
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      localStorage.removeItem("access_token")
      throw redirect({ to: "/login" })
    }
    throw error
  }
}

export async function requirePlatformAdminUser() {
  const user = await readCurrentUserOrRedirect()
  if (!hasPlatformAdminPrivileges(user)) {
    throw redirect({ to: "/" })
  }
  return user
}

export async function requireManagementUser() {
  const user = await readCurrentUserOrRedirect()
  if (!hasManagementPrivileges(user)) {
    throw redirect({ to: "/" })
  }
  return user
}

export const requireAdminUser = requirePlatformAdminUser
```

- [ ] **Step 2: 调整路由守卫**

`admin.tsx` 删除 `beforeLoad` 中的 `requireAdminUser()`，只保留 Outlet。

`admin.users.tsx` 和 `admin.review-focus-directions.tsx` 使用：

```typescript
import { requireManagementUser } from "@/lib/admin-route"

beforeLoad: async () => {
  await requireManagementUser()
}
```

`admin.skills.tsx`、`admin.client-releases.tsx`、`items.tsx` 使用：

```typescript
import { requirePlatformAdminUser } from "@/lib/admin-route"

beforeLoad: async () => {
  await requirePlatformAdminUser()
}
```

- [ ] **Step 3: 调整侧边栏菜单**

在 `AppSidebar.tsx` 新增：

```typescript
const departmentAdminItems: Item[] = [
  { icon: Home, title: "主页", path: "/" },
  { icon: Users, title: "用户管理", path: "/admin/users" },
  {
    icon: Target,
    title: "重点审查方向",
    path: "/admin/review-focus-directions",
  },
  { icon: MessageSquareText, title: "意见管理", path: "/feedback" },
  {
    icon: ListChecks,
    title: "任务管理",
    children: [
      {
        icon: ListChecks,
        title: "代码审查任务管理",
        path: "/tasks/review",
      },
    ],
  },
]
```

选择菜单：

```typescript
const items = hasPlatformAdminPrivileges(currentUser)
  ? adminItems
  : hasDepartmentAdminPrivileges(currentUser)
    ? departmentAdminItems
    : userItems
```

- [ ] **Step 4: 用户管理只读与角色表单**

在 `UsersPage.tsx` 计算：

```typescript
const isPlatformAdmin = hasPlatformAdminPrivileges(currentUser)
const isDepartmentAdmin = hasDepartmentAdminPrivileges(currentUser)
```

只在 `isPlatformAdmin` 时渲染 `<AddUser />` 和操作列。部门管理员显示列表和搜索；如果接口返回 403 且当前用户是部门管理员，显示“当前账号未绑定部门，请联系超级管理员。”

在 `AddUser.tsx` 和 `EditUser.tsx` 中把 schema 改为：

```typescript
const formSchema = z
  .object({
    full_name: z.string().optional(),
    svn_username: z.string().trim().min(1, { message: "请填写 SVN 账号" }),
    role: z.enum(["admin", "department_admin", "user"]),
    department_id: z.string().nullable(),
    is_active: z.boolean(),
  })
  .refine((data) => data.role !== "department_admin" || Boolean(data.department_id), {
    message: "部门管理员必须选择部门",
    path: ["department_id"],
  })
```

`EditUser.tsx` 不包含 `is_active` 时使用同样的 `role` 和 `department_id` refine。

角色下拉：

```tsx
<SelectItem value="admin">超级管理员</SelectItem>
<SelectItem value="department_admin">部门管理员</SelectItem>
<SelectItem value="user">普通用户</SelectItem>
```

在 `columns.tsx` 角色展示：

```typescript
const roleLabel = {
  admin: "超级管理员",
  department_admin: "部门管理员",
  user: "普通用户",
}[row.original.role ?? "user"]
```

- [ ] **Step 5: 方向库页面按角色隐藏平台级控件**

在 `ReviewFocusDirectionsPage.tsx` 读取当前用户后计算：

```typescript
const isPlatformAdmin = hasPlatformAdminPrivileges(currentUser)
const isDepartmentAdmin = hasDepartmentAdminPrivileges(currentUser)
```

部门管理员模式：

```typescript
const canUseDepartmentFilters = isPlatformAdmin
const canViewUsageStats = isPlatformAdmin
const canEditDirection = (direction: ReviewFocusDirectionPublic) =>
  isPlatformAdmin ||
  (isDepartmentAdmin &&
    direction.departments?.length === 1 &&
    direction.departments[0]?.id === currentUser?.department_id)
```

表单提交时，部门管理员强制发送自己的部门：

```typescript
department_ids: isDepartmentAdmin && currentUser?.department_id
  ? [currentUser.department_id]
  : value.department_ids,
```

隐藏：

- 部门多选控件。
- 全局方向说明和创建入口。
- 用户输入统计 Tab 或统计区域。
- 导出按钮。
- 共享方向编辑按钮。

- [ ] **Step 6: 生成前端客户端**

后端启动方式按项目现有 `scripts/generate-client.sh`。Run:

```bash
cd code_review_server
./scripts/generate-client.sh
```

Expected: `frontend/src/client/*.gen.ts` 包含 `department_admin`。

- [ ] **Step 7: 验证前端构建**

Run:

```bash
cd code_review_server/frontend
npm run build
```

Expected: PASS，TypeScript 无类型错误，Vite build 成功。

- [ ] **Step 8: 提交**

```bash
git add code_review_server/frontend/src code_review_server/frontend/src/client
git commit -m "调整部门管理员前端管理入口"
```

---

### Task 8: Electron 类型与未绑定部门管理员提示

**Files:**

- Modify: `code_review_electron/src/shared/types.ts`
- Modify: `code_review_electron/src/renderer/src/App.tsx`
- Test: `code_review_electron/src/renderer/src/App.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `App.test.tsx` 添加一个登录后未绑定部门管理员的测试。使用现有测试文件里的 mock 风格，新增断言：

```typescript
it("shows contact-admin message when department admin has no department", async () => {
  vi.mocked(window.codeReview.keyLogin).mockResolvedValue({ needSvnBinding: false })
  vi.mocked(window.codeReview.getCurrentUser).mockResolvedValue({
    id: "dept-admin-1",
    full_name: "部门管理员",
    svn_username: "dept-admin",
    department_id: null,
    department_name: null,
    role: "department_admin",
  })

  render(<App />)

  await userEvent.type(screen.getByLabelText("Key"), "sk-test")
  await userEvent.click(screen.getByRole("button", { name: "登录" }))

  expect(
    await screen.findByText("当前账号未绑定部门，请联系超级管理员。")
  ).toBeInTheDocument()
  expect(window.codeReview.listAvailableDepartments).not.toHaveBeenCalled()
})
```

如果当前 `App.test.tsx` 使用不同的 label 或登录按钮文案，按文件现有查询方式替换，但保留断言：不调用 `listAvailableDepartments()`，显示中文提示。

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd code_review_electron
npm test -- App.test.tsx
```

Expected: FAIL，原因是 `role` 类型不支持 `department_admin` 或当前仍进入部门选择流程。

- [ ] **Step 3: 更新共享类型**

在 `types.ts` 修改：

```typescript
role?: 'admin' | 'department_admin' | 'user'
```

- [ ] **Step 4: 更新 App 部门绑定行为**

在 `startAuthenticatedSession()` 中，把当前未绑定部门分支改成：

```typescript
if (!currentUser.department_id) {
  if (currentUser.role === 'department_admin') {
    setPendingDepartmentSession(null)
    setDepartments([])
    setDepartmentError('')
    throw new Error('当前账号未绑定部门，请联系超级管理员。')
  }
  setPendingDepartmentSession({ displayName, needSvnBinding })
  setDepartmentError('')
  setIsLoadingDepartments(true)
  try {
    const result = await window.codeReview.listAvailableDepartments()
    setDepartments(result.data)
  } catch (error) {
    setDepartments([])
    setDepartmentError(error instanceof Error ? error.message : '部门列表加载失败，请重试。')
  } finally {
    setIsLoadingDepartments(false)
  }
  return
}
```

`LoginPage` 已捕获 `onKeyLogin` 和 `onSvnLogin` 抛出的错误并用 `.form-error` 展示，因此这里通过 `throw new Error(...)` 复用现有登录错误区域，不打开部门选择弹窗。

- [ ] **Step 5: 运行 Electron 测试和类型检查**

Run:

```bash
cd code_review_electron
npm test -- App.test.tsx
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add code_review_electron/src/shared/types.ts code_review_electron/src/renderer/src/App.tsx code_review_electron/src/renderer/src/App.test.tsx
git commit -m "同步Electron部门管理员角色"
```

---

### Task 9: 全量回归、格式化与最终提交检查

**Files:**

- Verify all touched files.
- Update if generated client or formatter changed files.

- [ ] **Step 1: 后端目标测试**

Run:

```bash
cd code_review_server/backend
uv run pytest \
  tests/api/routes/test_users_roles.py \
  tests/services/test_cch_sync_service.py \
  tests/api/routes/test_users.py \
  tests/api/routes/test_review_tasks.py \
  tests/api/routes/test_review_focus_directions.py \
  tests/api/routes/test_feedback.py \
  -q
```

Expected: PASS。

- [ ] **Step 2: 后端格式和类型检查**

Run:

```bash
cd code_review_server/backend
./scripts/lint.sh
```

Expected: PASS。如果脚本会自动格式化，检查 `git diff` 并只保留相关格式化改动。

- [ ] **Step 3: 前端构建**

Run:

```bash
cd code_review_server/frontend
npm run build
```

Expected: PASS。

- [ ] **Step 4: Electron 验证**

Run:

```bash
cd code_review_electron
npm test -- App.test.tsx
npm run typecheck
```

Expected: PASS。

- [ ] **Step 5: 检查无意改动**

Run:

```bash
git status --short
git diff --stat
```

Expected:

- 只包含本计划相关文件。
- 不暂存 `.understand-anything/`、`code_review_server/package-lock.json`、`docs/training/`，除非用户另行要求。

- [ ] **Step 6: 验证后提交收尾修复**

Step 1-4 全部通过且没有相关已修改文件时，运行 `git status --short` 记录状态，然后跳过提交。

如果 Step 1-4 产生修复，暂存本计划涉及的源码和测试目录：

```bash
git add \
  code_review_server/backend/app \
  code_review_server/backend/tests \
  code_review_server/frontend/src \
  code_review_electron/src
git commit -m "完善部门管理员权限回归验证"
```

---

## 自审清单

规格覆盖：

- `department_admin` 角色、超级管理员兼容、普通用户兼容：Task 1、Task 3。
- CCH 同步保护角色和部门：Task 2。
- 用户管理只读本部门：Task 3、Task 7。
- 任务报告读取、下载、统计和写权限隔离：Task 4、Task 7。
- 方向库本部门维护、共享方向只读：Task 5、Task 7。
- 意见管理本人范围：Task 6。
- 前端路由守卫下沉和菜单：Task 7。
- Electron 类型和未绑定部门管理员提示：Task 8。
- 客户端生成、构建和回归：Task 7、Task 9。

占位扫描：

- 本计划不使用占位词或延后实现标记。
- 每个任务都包含具体文件、测试、实现片段、命令和预期结果。

类型一致性：

- 后端角色枚举统一使用 `UserRole.department_admin` 和字符串值 `department_admin`。
- 前端权限函数统一使用 `hasPlatformAdminPrivileges()`、`hasDepartmentAdminPrivileges()`、`hasManagementPrivileges()`。
- 路由守卫统一使用 `requirePlatformAdminUser()` 和 `requireManagementUser()`。
- 任务权限函数统一使用 `_get_task_for_read()` 与 `_get_task_for_write()`。
