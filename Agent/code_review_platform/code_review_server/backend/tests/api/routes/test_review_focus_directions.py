from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import Department, ReviewFocusDirection, ReviewTask
from tests.utils.user import authentication_token_from_key, create_key_user
from tests.utils.utils import random_lower_string


def _create_department(db: Session, name: str | None = None) -> Department:
    department = Department(name=name or f"方向部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


def _direction_payload(department_id: UUID) -> dict:
    suffix = random_lower_string()
    return {
        "title": f"权限审查-{suffix}",
        "content": "重点检查权限边界和异常处理",
        "department_id": str(department_id),
        "is_active": True,
    }


def _create_focus_direction(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
    *,
    department: Department | None = None,
) -> dict:
    target_department = department or _create_department(db)
    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json=_direction_payload(target_department.id),
    )
    assert response.status_code == 200
    return response.json()


def _create_task_with_focus_snapshot(
    *,
    client: TestClient,
    db: Session,
    department: Department,
    snapshot: str | None,
    minutes_ago: int,
) -> dict:
    user, api_key = create_key_user(db)
    user.department_id = department.id
    db.add(user)
    db.commit()
    db.refresh(user)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=headers,
        json={
            "svn_url": "svn://repo/project",
            "old_revision": str(10 + minutes_ago),
            "new_revision": str(20 + minutes_ago),
            "focus_direction_snapshot": snapshot,
        },
    )
    assert response.status_code == 200
    task = response.json()
    db_task = db.get(ReviewTask, UUID(task["id"]))
    assert db_task is not None
    used_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        minutes=minutes_ago
    )
    db_task.created_at = used_at
    db_task.updated_at = used_at
    db.add(db_task)
    db.commit()
    return task


def test_admin_can_create_and_list_focus_directions(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department = _create_department(db)
    payload = _direction_payload(department.id)

    create_response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json=payload,
    )

    assert create_response.status_code == 200
    created = create_response.json()
    assert created["title"] == payload["title"]
    assert created["content"] == payload["content"]
    assert created["department_id"] == str(department.id)
    assert created["department_name"] == department.name
    assert created["is_active"] is True
    assert created["usage_count"] == 0
    assert created["created_by_user_id"] is not None

    list_response = client.get(
        f"{settings.API_V1_STR}/review-focus-directions?skip=0&limit=100",
        headers=superuser_token_headers,
    )
    assert list_response.status_code == 200
    content = list_response.json()
    assert content["count"] >= 1
    assert any(direction["id"] == created["id"] for direction in content["data"])


def test_normal_user_cannot_create_focus_direction(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
) -> None:
    department = _create_department(db)

    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=normal_user_token_headers,
        json=_direction_payload(department.id),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "没有足够权限"


def test_admin_can_update_focus_direction(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    direction = _create_focus_direction(client, db, superuser_token_headers)
    department = _create_department(db)
    update_payload = {
        "title": f"性能审查-{random_lower_string()}",
        "content": "重点检查缓存穿透和慢查询",
        "department_id": str(department.id),
        "is_active": False,
    }

    response = client.patch(
        f"{settings.API_V1_STR}/review-focus-directions/{direction['id']}",
        headers=superuser_token_headers,
        json=update_payload,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["id"] == direction["id"]
    assert content["title"] == update_payload["title"]
    assert content["content"] == update_payload["content"]
    assert content["department_id"] == str(department.id)
    assert content["department_name"] == department.name
    assert content["is_active"] is False
    assert content["updated_at"] != direction["updated_at"]


def test_delete_focus_direction_soft_deletes(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    direction = _create_focus_direction(client, db, superuser_token_headers)

    response = client.delete(
        f"{settings.API_V1_STR}/review-focus-directions/{direction['id']}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["message"] == "重点审查方向已停用"
    db_direction = db.get(ReviewFocusDirection, UUID(direction["id"]))
    assert db_direction is not None
    assert db_direction.is_active is False
    assert db_direction.updated_at is not None


def test_missing_focus_direction_returns_404(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.patch(
        f"{settings.API_V1_STR}/review-focus-directions/{uuid4()}",
        headers=superuser_token_headers,
        json={"title": "不存在方向"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "重点审查方向不存在"


def test_create_or_update_with_missing_department_returns_400(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    create_response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json=_direction_payload(uuid4()),
    )

    assert create_response.status_code == 400
    assert create_response.json()["detail"] == "部门不存在"

    direction = _create_focus_direction(client, db, superuser_token_headers)
    update_response = client.patch(
        f"{settings.API_V1_STR}/review-focus-directions/{direction['id']}",
        headers=superuser_token_headers,
        json={"department_id": str(uuid4())},
    )

    assert update_response.status_code == 400
    assert update_response.json()["detail"] == "部门不存在"


def test_admin_can_read_usage_stats_grouped_by_normalized_content(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department_a = _create_department(db, "研发一部-" + random_lower_string())
    department_b = _create_department(db, "研发二部-" + random_lower_string())
    _create_task_with_focus_snapshot(
        client=client,
        db=db,
        department=department_a,
        snapshot="  检查   权限\n边界  ",
        minutes_ago=30,
    )
    _create_task_with_focus_snapshot(
        client=client,
        db=db,
        department=department_b,
        snapshot="检查 权限 边界",
        minutes_ago=10,
    )
    _create_task_with_focus_snapshot(
        client=client,
        db=db,
        department=department_a,
        snapshot="\t检查 SQL 注入\t",
        minutes_ago=20,
    )
    _create_task_with_focus_snapshot(
        client=client,
        db=db,
        department=department_a,
        snapshot="   \n  ",
        minutes_ago=5,
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-focus-directions/usage-stats",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert payload["data"][0]["content"] == "检查 权限 边界"
    assert payload["data"][0]["usage_count"] == 2
    assert payload["data"][0]["latest_used_at"] is not None
    assert payload["data"][0]["departments"] == sorted(
        [department_a.name, department_b.name]
    )
    assert payload["data"][1]["content"] == "检查 SQL 注入"
    assert payload["data"][1]["usage_count"] == 1
    assert payload["data"][1]["departments"] == [department_a.name]


def test_admin_can_create_focus_direction_from_usage(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department = _create_department(db)

    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions/from-usage",
        headers=superuser_token_headers,
        json={
            "title": "权限边界审查",
            "content": "  检查   权限\n边界  ",
            "department_id": str(department.id),
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["title"] == "权限边界审查"
    assert content["content"] == "检查 权限 边界"
    assert content["department_id"] == str(department.id)
    assert content["department_name"] == department.name
    assert content["is_active"] is True
