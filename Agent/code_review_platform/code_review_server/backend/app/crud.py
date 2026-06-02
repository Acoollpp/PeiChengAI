import uuid
from typing import Any

from sqlmodel import Session, select

from app.models import Item, ItemCreate, User, UserApiKey, UserCreate, UserUpdate


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(user_create)
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    db_user.sqlmodel_update(user_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_svn_username(
    *, session: Session, svn_username: str
) -> User | None:
    statement = select(User).where(User.svn_username == svn_username)
    return session.exec(statement).first()


def get_user_by_cch_user_id(*, session: Session, cch_user_id: int) -> User | None:
    statement = select(User).where(User.cch_user_id == cch_user_id)
    return session.exec(statement).first()


def get_user_api_key_by_key(*, session: Session, key: str) -> UserApiKey | None:
    statement = select(UserApiKey).where(
        UserApiKey.key == key, UserApiKey.is_active.is_(True)
    )
    return session.exec(statement).first()


def get_user_api_key_by_cch_key_id(
    *, session: Session, cch_key_id: int
) -> UserApiKey | None:
    statement = select(UserApiKey).where(UserApiKey.cch_key_id == cch_key_id)
    return session.exec(statement).first()


def create_item(*, session: Session, item_in: ItemCreate, owner_id: uuid.UUID) -> Item:
    db_item = Item.model_validate(item_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)
    return db_item
