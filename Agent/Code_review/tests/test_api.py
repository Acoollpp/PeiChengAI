from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import create_app
from app.models import TaskStatus


PUBLIC_SVN_URL = "https://192.168.0.233/svn/documents/spec.md"
HOME_SVN_URL = "https://192.168.0.233/svn/src_home/project/trunk"
POWER_SVN_URL = "https://192.168.0.233/svn/src_power/project/trunk"
VALID_SVN_URL = PUBLIC_SVN_URL


def create_task(client, **overrides):
    payload = {
        "svn_url": VALID_SVN_URL,
        "old_revision": "100",
        "new_revision": "r101",
        "requester": "alice",
    }
    payload.update(overrides)
    return client.post("/api/tasks", json=payload)


def login(client, name="张三", phone="13800138000"):
    return client.post("/api/session", json={"name": name, "phone": phone})


def login_admin(client):
    return login(client, name="admin", phone="15866582922")


def create_logged_in_task(client, **overrides):
    login(client, name="alice")
    return create_task(client, **overrides)


@pytest.fixture
def admin_api_client(api_paths, api_repository, api_scheduler, api_event_bus):
    custom_settings = replace(settings, admin_phones=("15866582922",))
    app = create_app(
        **api_paths,
        start_worker=False,
        repo=api_repository,
        scheduler=api_scheduler,
        event_bus=api_event_bus,
        app_settings=custom_settings,
    )
    with TestClient(app) as client:
        yield client


def test_root_serves_static_frontend_and_api_routes_still_work(api_client):
    root_response = api_client.get("/")

    assert root_response.status_code == 200
    assert root_response.headers["content-type"].startswith("text/html")
    assert "Code Review Task Console" in root_response.text

    login(api_client)
    api_response = api_client.get("/api/tasks")

    assert api_response.status_code == 200
    assert api_response.headers["content-type"].startswith("application/json")


def test_login_creates_session_and_get_session_returns_user(api_client):
    login_response = login(api_client)

    assert login_response.status_code == 200
    assert "code_review_session" in login_response.headers["set-cookie"]

    session_response = api_client.get("/api/session")

    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True
    assert session_response.json()["user"]["name"] == "张三"


def test_events_requires_login(api_client):
    response = api_client.get("/api/events")

    assert response.status_code == 401


def test_admin_phone_login_marks_user_as_admin(
    api_paths,
    api_repository,
    api_scheduler,
    api_event_bus,
):
    custom_settings = replace(settings, admin_phones=("15866582922",))
    app = create_app(
        **api_paths,
        start_worker=False,
        repo=api_repository,
        scheduler=api_scheduler,
        event_bus=api_event_bus,
        app_settings=custom_settings,
    )

    with TestClient(app) as client:
        response = login(client, name="admin", phone="15866582922")

    assert response.status_code == 200
    assert response.json()["user"]["is_admin"] is True
    assert response.json()["user"]["is_active"] is True


def test_login_page_is_served(api_client):
    response = api_client.get("/login")

    assert response.status_code == 200
    assert "login-form" in response.text


def test_post_tasks_requires_login(api_client):
    response = create_task(api_client)

    assert response.status_code == 401


def test_admin_users_requires_admin(api_client):
    login(api_client, name="alice", phone="13800138000")

    response = api_client.get("/api/admin/users")

    assert response.status_code == 403


def test_admin_can_create_and_list_users(admin_api_client):
    login_admin(admin_api_client)

    create_response = admin_api_client.post(
        "/api/admin/users",
        json={"name": "bob", "phone": "13900139000", "is_admin": False, "is_active": True},
    )
    list_response = admin_api_client.get("/api/admin/users")

    assert create_response.status_code == 200
    assert create_response.json()["phone"] == "13900139000"
    assert list_response.status_code == 200
    assert any(user["phone"] == "13900139000" for user in list_response.json())


def test_admin_create_user_rejects_duplicate_phone(admin_api_client):
    login_admin(admin_api_client)
    payload = {"name": "bob", "phone": "13900139000", "is_admin": False, "is_active": True}
    assert admin_api_client.post("/api/admin/users", json=payload).status_code == 200

    response = admin_api_client.post("/api/admin/users", json=payload)

    assert response.status_code == 409


def test_admin_can_update_user(admin_api_client):
    login_admin(admin_api_client)
    created = admin_api_client.post(
        "/api/admin/users",
        json={"name": "bob", "phone": "13900139000", "is_admin": False, "is_active": True},
    ).json()

    response = admin_api_client.patch(
        f"/api/admin/users/{created['user_id']}",
        json={"name": "Bob Updated", "is_admin": True, "is_active": False},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Bob Updated"
    assert response.json()["is_admin"] is True
    assert response.json()["is_active"] is False


def test_disabled_user_cannot_access_tasks(admin_api_client):
    login_admin(admin_api_client)
    created = admin_api_client.post(
        "/api/admin/users",
        json={"name": "bob", "phone": "13900139000", "is_admin": False, "is_active": False},
    ).json()
    admin_api_client.delete("/api/session")

    login(admin_api_client, name="bob", phone="13900139000")
    response = admin_api_client.get("/api/tasks")

    assert created["is_active"] is False
    assert response.status_code == 403


def test_public_repository_task_is_allowed_for_any_logged_in_user(api_client):
    login(api_client, name="alice", phone="13800138000")

    response = create_task(api_client, svn_url=PUBLIC_SVN_URL)

    assert response.status_code == 200


def test_product_repository_task_requires_permission(api_client):
    login(api_client, name="alice", phone="13800138000")

    response = create_task(api_client, svn_url=HOME_SVN_URL)

    assert response.status_code == 403
    assert response.json()["detail"] == "当前用户没有该 SVN 仓库权限"


def test_product_repository_task_is_allowed_when_granted(api_client, api_repository):
    login(api_client, name="alice", phone="13800138000")
    user = next(user for user in api_repository.users.values() if user["phone"] == "13800138000")
    api_repository.set_user_repository_permissions(user["id"], ["home"])

    response = create_task(api_client, svn_url=HOME_SVN_URL)

    assert response.status_code == 200
    task = api_repository.get_task(response.json()["task_id"])
    assert task["repository_key"] == "home"
    assert task["repository_name"] == "户储"


def test_get_repositories_returns_public_and_granted_repositories(api_client, api_repository):
    login(api_client, name="alice", phone="13800138000")
    user = next(user for user in api_repository.users.values() if user["phone"] == "13800138000")
    api_repository.set_user_repository_permissions(user["id"], ["home"])

    response = api_client.get("/api/repositories")

    assert response.status_code == 200
    body = response.json()
    keys = [repo["key"] for repo in body]
    assert "public_repository" in keys
    assert "documents" in keys
    assert "home" in keys
    assert "power" not in keys


def test_get_repositories_requires_login(api_client):
    response = api_client.get("/api/repositories")

    assert response.status_code == 401


def test_root_places_report_viewer_on_the_right_and_task_list_on_the_left(api_client):
    response = api_client.get("/")

    assert response.status_code == 200
    assert 'class="workspace-grid review-workbench"' in response.text
    assert 'class="left-rail"' in response.text
    assert 'class="right-stage"' in response.text
    assert 'class="panel task-list-panel"' in response.text
    assert 'id="recent-list"' in response.text
    assert response.text.index('class="left-rail"') < response.text.index('class="right-stage"')
    assert response.text.index('id="recent-list"') < response.text.index('id="markdown-preview"')
    assert response.text.index('id="markdown-preview"') < response.text.index('id="download-link"')


def test_post_tasks_creates_pending_task_normalizes_revisions_and_stores_requester(
    api_client,
    api_repository,
    api_paths,
):
    login(api_client, name="alice", phone="13800138000")
    response = create_task(api_client, old_revision=" 100 ", new_revision="R101")

    assert response.status_code == 200
    body = response.json()
    assert body["task_id"]
    assert body["status"] == "pending"

    task = api_repository.get_task(body["task_id"])
    assert task is not None
    assert task["svn_url"] == VALID_SVN_URL
    assert task["old_revision"] == "r100"
    assert task["new_revision"] == "r101"
    assert task["requester"] == "alice"
    assert task["status"] == TaskStatus.pending
    assert task["report_path"] == str((api_paths["reports_dir"] / f"{body['task_id']}.md").resolve())


def test_post_tasks_rejects_invalid_svn_url(api_client):
    login(api_client)
    response = create_task(api_client, svn_url="https://example.test/svn/src_home/project")

    assert response.status_code == 400


def test_post_tasks_rejects_invalid_revision(api_client):
    login(api_client)
    response = create_task(api_client, old_revision="abc")

    assert response.status_code == 400


def test_post_tasks_rejects_same_old_and_new_revision(api_client):
    login(api_client)
    response = create_task(api_client, old_revision="100", new_revision="r100")

    assert response.status_code == 400


def test_get_tasks_lists_recent_tasks(api_client):
    login(api_client)
    first = create_task(api_client, old_revision="1", new_revision="2").json()["task_id"]
    second = create_task(api_client, old_revision="3", new_revision="4").json()["task_id"]

    response = api_client.get("/api/tasks")

    assert response.status_code == 200
    tasks = response.json()
    assert [task["task_id"] for task in tasks[:2]] == [second, first]
    assert all(task["report_available"] is False for task in tasks)


def test_get_task_returns_details_with_report_available_false_for_pending(api_client):
    task_id = create_logged_in_task(api_client).json()["task_id"]

    response = api_client.get(f"/api/tasks/{task_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["task_id"] == task_id
    assert body["requester"] == "alice"
    assert body["created_at"]
    assert body["report_available"] is False


def test_get_task_returns_report_available_true_when_success_report_exists(
    api_client,
    api_repository,
    api_paths,
):
    task_id = create_logged_in_task(api_client).json()["task_id"]
    report_path = api_paths["reports_dir"] / f"{task_id}.md"
    report_path.write_text("# Review\n\nLooks good.\n", encoding="utf-8", newline="\n")
    api_repository.mark_success(task_id)

    response = api_client.get(f"/api/tasks/{task_id}")

    assert response.status_code == 200
    assert response.json()["report_available"] is True


def test_get_report_returns_conflict_before_success(api_client):
    task_id = create_logged_in_task(api_client).json()["task_id"]

    response = api_client.get(f"/api/tasks/{task_id}/report")

    assert response.status_code == 409


def test_get_report_returns_markdown_after_success(api_client, api_repository, api_paths):
    task_id = create_logged_in_task(api_client).json()["task_id"]
    report_text = "# Review\n\nLooks good.\n"
    (api_paths["reports_dir"] / f"{task_id}.md").write_text(
        report_text,
        encoding="utf-8",
        newline="\n",
    )
    api_repository.mark_success(task_id)

    response = api_client.get(f"/api/tasks/{task_id}/report")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert response.text == report_text


def test_get_report_falls_back_to_current_reports_dir_for_copied_database(
    api_client,
    api_repository,
    api_paths,
):
    login(api_client)
    user = api_repository.get_or_create_user(name="alice", phone="13800138000")
    task_id = "copied-database-task"
    report_text = "# Review\n\nCopied database report.\n"
    current_report = api_paths["reports_dir"] / f"{task_id}.md"
    current_report.write_text(report_text, encoding="utf-8", newline="\n")
    task = api_repository.create_task(
        svn_url=VALID_SVN_URL,
        old_revision="r1",
        new_revision="r2",
        requester="alice",
        report_path=str(api_paths["reports_dir"].parent / "old-install" / "reports" / f"{task_id}.md"),
        user_id=user["id"],
        task_id=task_id,
    )
    api_repository.mark_success(task["id"])

    detail_response = api_client.get(f"/api/tasks/{task_id}")
    report_response = api_client.get(f"/api/tasks/{task_id}/report")

    assert detail_response.status_code == 200
    assert detail_response.json()["report_available"] is True
    assert report_response.status_code == 200
    assert report_response.text == report_text


def test_report_endpoint_does_not_serve_success_task_report_outside_reports_dir(
    api_client,
    api_repository,
    api_paths,
    tmp_path,
):
    login(api_client)
    user = api_repository.get_or_create_user(name="alice", phone="13800138000")
    outside_report = tmp_path / "outside-report.md"
    outside_report.write_text("# Private\n\nDo not serve.\n", encoding="utf-8", newline="\n")
    task = api_repository.create_task(
        svn_url=VALID_SVN_URL,
        old_revision="r1",
        new_revision="r2",
        requester="alice",
        report_path=str(outside_report),
        user_id=user["id"],
        task_id="outside-report-task",
    )
    api_repository.mark_success(task["id"])

    report_response = api_client.get(f"/api/tasks/{task['id']}/report")
    download_response = api_client.get(f"/api/tasks/{task['id']}/download")

    assert report_response.status_code == 404
    assert download_response.status_code == 404
    assert "Private" not in report_response.text
    assert "Private" not in download_response.text


def test_get_download_returns_markdown_attachment_after_success(api_client, api_repository, api_paths):
    task_id = create_logged_in_task(api_client).json()["task_id"]
    report_text = "# Review\n\nDownload me.\n"
    (api_paths["reports_dir"] / f"{task_id}.md").write_text(
        report_text,
        encoding="utf-8",
        newline="\n",
    )
    api_repository.mark_success(task_id)

    response = api_client.get(f"/api/tasks/{task_id}/download")

    assert response.status_code == 200
    assert response.text == report_text
    assert response.headers["content-disposition"].startswith("attachment;")
    assert f"code-review-{task_id}.md" in response.headers["content-disposition"]


def test_get_download_returns_conflict_before_success(api_client):
    task_id = create_logged_in_task(api_client).json()["task_id"]

    response = api_client.get(f"/api/tasks/{task_id}/download")

    assert response.status_code == 409


def test_missing_task_returns_404(api_client):
    login(api_client)
    response = api_client.get("/api/tasks/missing-task")

    assert response.status_code == 404


def test_importing_app_main_does_not_create_default_app_storage(monkeypatch, tmp_path):
    import importlib
    import sys

    monkeypatch.setenv("APP_BASE_DIR", str(tmp_path))
    sys.modules.pop("app.main", None)

    module = importlib.import_module("app.main")

    assert not hasattr(module, "app")
    assert not (tmp_path / "data").exists()


def test_post_tasks_uses_session_user_and_enqueues_task(api_client, api_repository, api_scheduler):
    login(api_client, name="李四", phone="13900139000")

    response = create_task(api_client, requester="mallory")

    assert response.status_code == 200
    task_id = response.json()["task_id"]
    task = api_repository.get_task(task_id)
    assert task["requester"] == "李四"
    assert api_scheduler.claim_next_task(lock_ttl_seconds=60)["task_id"] == task_id


def test_user_cannot_read_other_users_task(api_client):
    login(api_client, name="用户一", phone="13100131000")
    task_id = create_task(api_client).json()["task_id"]
    api_client.delete("/api/session")
    login(api_client, name="用户二", phone="13200132000")

    response = api_client.get(f"/api/tasks/{task_id}")

    assert response.status_code == 404
