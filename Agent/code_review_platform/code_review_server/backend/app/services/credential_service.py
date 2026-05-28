import uuid

from sqlmodel import Session, select

from app.core.security import build_fernet
from app.models import UserSvnCredential, get_datetime_utc


class CredentialService:
    def __init__(self, master_key: str) -> None:
        self._fernet = build_fernet(master_key)

    def save_svn_password(
        self, session: Session, user_id: uuid.UUID, password: str
    ) -> None:
        encrypted_password = self._fernet.encrypt(password.encode()).decode()
        credentials = session.exec(
            select(UserSvnCredential).where(UserSvnCredential.user_id == user_id)
        ).all()

        if credentials:
            credential = credentials[0]
            credential.encrypted_password = encrypted_password
            credential.encryption_version = "fernet-sha256-v1"
            credential.updated_at = get_datetime_utc()
            session.add(credential)
            for duplicate in credentials[1:]:
                session.delete(duplicate)
        else:
            session.add(
                UserSvnCredential(
                    user_id=user_id,
                    encrypted_password=encrypted_password,
                    encryption_version="fernet-sha256-v1",
                )
            )

        session.commit()

    def get_svn_password(self, session: Session, user_id: uuid.UUID) -> str | None:
        credential = session.exec(
            select(UserSvnCredential).where(UserSvnCredential.user_id == user_id)
        ).first()
        if credential is None:
            return None

        return self._fernet.decrypt(credential.encrypted_password.encode()).decode()
