from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import (
    Department,
    ReviewFocusDirection,
    ReviewTask,
    ReviewTaskStatus,
    User,
)
from tests.utils.utils import random_lower_string


def _department_payload(name: str | None = None) -> dict:
    suffix = random_lower_string()
    return {
        "name": name or f"研发部-{suffix}",
        "description": f"部门说明-{suffix}",
        "is_active": True,
    }


def _create_department(
    client: TestClient, superuser_token_headers: dict[str, str], name: str | None = None
) -> dict:
    response = client.post(
        f"{settings.API_V1_STR}/departments",
        headers=superuser_token_headers,
        json=_department_payload(name),
    )
    assert response.status_code == 200
    return response.json()


def test_admin_can_create_and_list_departments(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payload = _department_payload()

    create_response = client.post(
        f"{settings.API_V1_STR}/departments",
        headers=superuser_token_headers,
        json=payload,
    )

    assert create_response.status_code == 200
    created = create_response.json()
    assert created["name"] == payload["name"]
    assert created["description"] == payload["description"]
    assert created["is_active"] is True

    list_response = client.get(
        f"{settings.API_V1_STR}/departments",
        headers=superuser_token_headers,
    )
    assert list_response.status_code == 200
    content = list_response.json()
    assert content["count"] >= 1
    assert any(department["id"] == created["id"] for department in content["data"])


def test_normal_user_cannot_create_department(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/departments",
        headers=normal_user_token_headers,
        json=_department_payload(),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "没有足够权限"


def test_normal_user_can_list_available_departments(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
) -> None:
    active_department = Department(
        name=f"可选部门-{random_lower_string()}",
        is_active=True,
    )
    inactive_department = Department(
        name=f"停用部门-{random_lower_string()}",
        is_active=False,
    )
    db.add(active_department)
    db.add(inactive_department)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/departments/available",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    department_ids = {department["id"] for department in content["data"]}
    assert str(active_department.id) in department_ids
    assert str(inactive_department.id) not in department_ids


def test_admin_can_update_department(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    department = _create_department(client, superuser_token_headers)
    update_payload = {
        "name": f"质量保障部-{random_lower_string()}",
        "description": "更新后的部门说明",
        "is_active": False,
    }

    response = client.patch(
        f"{settings.API_V1_STR}/departments/{department['id']}",
        headers=superuser_token_headers,
        json=update_payload,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["id"] == department["id"]
    assert content["name"] == update_payload["name"]
    assert content["description"] == update_payload["description"]
    assert content["is_active"] is False


def test_delete_missing_department_returns_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/departments/{uuid4()}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "部门不存在"


def test_create_duplicate_department_name_returns_409(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    name = f"平台部-{random_lower_string()}"
    _create_department(client, superuser_token_headers, name)

    response = client.post(
        f"{settings.API_V1_STR}/departments",
        headers=superuser_token_headers,
        json=_department_payload(name),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "部门名称已存在"


def test_update_duplicate_department_name_returns_409(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    existing = _create_department(client, superuser_token_headers)
    target = _create_department(client, superuser_token_headers)

    response = client.patch(
        f"{settings.API_V1_STR}/departments/{target['id']}",
        headers=superuser_token_headers,
        json={"name": existing["name"]},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "部门名称已存在"


def test_delete_linked_department_returns_409(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department = _create_department(client, superuser_token_headers)
    user = User(
        full_name=f"关联用户-{random_lower_string()}",
        department_id=UUID(department["id"]),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    task = ReviewTask(
        user_id=user.id,
        svn_url="https://svn.example.com/project/trunk",
        old_revision="r1",
        new_revision="r2",
        department_id=UUID(department["id"]),
        department_name=department["name"],
        status=ReviewTaskStatus.created,
    )
    direction = ReviewFocusDirection(
        title=f"重点方向-{random_lower_string()}",
        content="检查高风险变更",
        department_id=UUID(department["id"]),
    )
    db.add(task)
    db.add(direction)
    db.commit()

    response = client.delete(
        f"{settings.API_V1_STR}/departments/{department['id']}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "该部门已关联用户、任务或重点审查方向，不能删除，请先停用。"
    )


def test_delete_department_linked_by_focus_direction_department_returns_409(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    department_payload = _create_department(client, superuser_token_headers)
    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json={
            "title": "关联部门方向",
            "content": "检查部门关联删除保护",
            "department_ids": [department_payload["id"]],
            "is_active": True,
        },
    )
    assert response.status_code == 200

    delete_response = client.delete(
        f"{settings.API_V1_STR}/departments/{department_payload['id']}",
        headers=superuser_token_headers,
    )

    assert delete_response.status_code == 409
    assert (
        delete_response.json()["detail"]
        == "该部门已关联用户、任务或重点审查方向，不能删除，请先停用。"
    )


def test_delete_unlinked_department_returns_success_message(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department = _create_department(client, superuser_token_headers)

    response = client.delete(
        f"{settings.API_V1_STR}/departments/{department['id']}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["message"] == "部门删除成功"
    assert db.get(Department, UUID(department["id"])) is None
