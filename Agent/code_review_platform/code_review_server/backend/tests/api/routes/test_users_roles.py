from app.models import ReviewTask, ReviewTaskStatus, User, UserPublic, UserRole


def test_user_has_svn_username_and_role() -> None:
    user = User(
        email="reviewer@example.com",
        hashed_password="not-a-real-hash",
        svn_username="svn-reviewer",
    )

    assert user.svn_username == "svn-reviewer"
    assert user.role == UserRole.user


def test_review_task_defaults_to_created() -> None:
    task = ReviewTask(
        user_id=User(email="reviewer@example.com", hashed_password="not-a-real-hash").id,
        svn_url="https://svn.example.com/project/trunk",
        old_revision="100",
        new_revision="101",
    )

    assert task.status == ReviewTaskStatus.created


def test_user_public_exposes_management_identity_fields() -> None:
    assert "svn_username" in UserPublic.model_fields
    assert "role" in UserPublic.model_fields
