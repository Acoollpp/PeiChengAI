from sqlmodel import Session, select

from app.models import User, UserApiKey


class UserApiKeyService:
    def authenticate(self, session: Session, key: str) -> User | None:
        api_key = session.exec(
            select(UserApiKey).where(
                UserApiKey.key == key, UserApiKey.is_active.is_(True)
            )
        ).first()
        if api_key is None:
            return None

        user = session.get(User, api_key.user_id)
        if user is None or not user.is_active:
            return None

        return user
