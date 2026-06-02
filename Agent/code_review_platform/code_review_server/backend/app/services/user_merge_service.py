from sqlmodel import Session, select

from app.models import AuditLog, ReviewTask, User, UserSvnCredential


class UserMergeService:
    @staticmethod
    def merge_svn_user_into_current_user(
        session: Session,
        *,
        old_user: User,
        current_user: User,
        svn_username: str,
    ) -> None:
        if old_user.id == current_user.id:
            current_user.svn_username = svn_username
            session.add(current_user)
            session.commit()
            return

        old_user.svn_username = None
        session.add(old_user)
        session.flush()

        tasks = session.exec(
            select(ReviewTask).where(ReviewTask.user_id == old_user.id)
        ).all()
        for task in tasks:
            task.user_id = current_user.id
            session.add(task)

        old_credential = session.exec(
            select(UserSvnCredential).where(UserSvnCredential.user_id == old_user.id)
        ).first()
        current_credential = session.exec(
            select(UserSvnCredential).where(UserSvnCredential.user_id == current_user.id)
        ).first()
        if old_credential is not None:
            if current_credential is None:
                old_credential.user_id = current_user.id
                session.add(old_credential)
            else:
                session.delete(old_credential)

        current_user.svn_username = svn_username
        old_user.is_active = False
        old_user.disabled_reason = "merged_into_cch_user"
        session.add(current_user)
        session.add(old_user)
        session.add(
            AuditLog(
                action="svn_user_merged",
                actor_user_id=current_user.id,
                target_user_id=old_user.id,
                metadata_json={"svn_username": svn_username},
            )
        )
        session.commit()
