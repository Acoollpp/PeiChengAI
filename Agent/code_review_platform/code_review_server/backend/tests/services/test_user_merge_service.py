from sqlmodel import Session, select

from app.models import AuditLog, ReviewTask, User, UserSvnCredential
from app.services.credential_service import CredentialService
from app.services.user_merge_service import UserMergeService
from tests.utils.user import create_key_user, create_random_user
from tests.utils.utils import random_lower_string


def _review_task_for(user: User) -> ReviewTask:
    return ReviewTask(
        user_id=user.id,
        svn_url=f"https://svn.example.com/{random_lower_string()}",
        old_revision="1",
        new_revision="2",
    )


def test_merge_svn_user_moves_review_tasks_and_disables_old_user(
    db: Session,
) -> None:
    old_user = create_random_user(db)
    current_user, _ = create_key_user(db)
    svn_username = old_user.svn_username
    task = _review_task_for(old_user)
    db.add(task)
    db.commit()
    db.refresh(task)

    UserMergeService.merge_svn_user_into_current_user(
        db,
        old_user=old_user,
        current_user=current_user,
        svn_username=svn_username,
    )

    db.refresh(task)
    db.refresh(old_user)
    db.refresh(current_user)
    audit_log = db.exec(
        select(AuditLog).where(
            AuditLog.action == "svn_user_merged",
            AuditLog.actor_user_id == current_user.id,
            AuditLog.target_user_id == old_user.id,
        )
    ).one()

    assert task.user_id == current_user.id
    assert current_user.svn_username == svn_username
    assert old_user.svn_username is None
    assert old_user.is_active is False
    assert old_user.disabled_reason == "merged_into_cch_user"
    assert audit_log.metadata_json == {"svn_username": svn_username}


def test_merge_svn_user_moves_credential_when_current_user_has_none(
    db: Session,
) -> None:
    old_user = create_random_user(db)
    current_user, _ = create_key_user(db)
    svn_username = old_user.svn_username
    service = CredentialService("test-master-key")
    service.save_svn_password(db, old_user.id, "old-password")

    UserMergeService.merge_svn_user_into_current_user(
        db,
        old_user=old_user,
        current_user=current_user,
        svn_username=svn_username,
    )

    assert service.get_svn_password(db, current_user.id) == "old-password"
    assert service.get_svn_password(db, old_user.id) is None


def test_merge_svn_user_deletes_old_credential_when_current_user_has_one(
    db: Session,
) -> None:
    old_user = create_random_user(db)
    current_user, _ = create_key_user(db)
    svn_username = old_user.svn_username
    service = CredentialService("test-master-key")
    service.save_svn_password(db, old_user.id, "old-password")
    service.save_svn_password(db, current_user.id, "current-password")

    UserMergeService.merge_svn_user_into_current_user(
        db,
        old_user=old_user,
        current_user=current_user,
        svn_username=svn_username,
    )

    old_credential = db.exec(
        select(UserSvnCredential).where(UserSvnCredential.user_id == old_user.id)
    ).first()

    assert service.get_svn_password(db, current_user.id) == "current-password"
    assert old_credential is None


def test_merge_same_user_only_sets_svn_username(db: Session) -> None:
    current_user, _ = create_key_user(db)
    svn_username = f"svn-{random_lower_string()}"

    UserMergeService.merge_svn_user_into_current_user(
        db,
        old_user=current_user,
        current_user=current_user,
        svn_username=svn_username,
    )

    db.refresh(current_user)

    assert current_user.svn_username == svn_username
    assert current_user.is_active is True
