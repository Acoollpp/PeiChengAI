from app.session import (
    SESSION_COOKIE_NAME,
    SessionManager,
    normalize_phone,
)


def test_normalize_phone_removes_spaces_dashes_and_country_prefix():
    assert normalize_phone(" +86 138-0013-8000 ") == "13800138000"


def test_normalize_phone_rejects_too_short_value():
    try:
        normalize_phone("123")
    except ValueError as exc:
        assert "phone" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")


def test_session_manager_round_trips_user_id():
    manager = SessionManager("secret")
    cookie = manager.create_cookie_value("user-1")

    assert manager.read_user_id(cookie) == "user-1"


def test_session_manager_rejects_tampered_cookie():
    manager = SessionManager("secret")

    assert manager.read_user_id("invalid") is None


def test_session_cookie_name_is_stable():
    assert SESSION_COOKIE_NAME == "code_review_session"
