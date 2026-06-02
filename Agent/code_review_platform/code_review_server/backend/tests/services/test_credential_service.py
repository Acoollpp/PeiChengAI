from sqlmodel import Session, select

from app import crud
from app.models import UserCreate, UserSvnCredential
from app.services.credential_service import CredentialService
from tests.utils.utils import random_lower_string


def test_user_svn_credential_user_id_is_unique() -> None:
    user_id_column = UserSvnCredential.__table__.c.user_id

    assert user_id_column.unique is True
    assert user_id_column.index is True


def test_save_svn_password_encrypts_and_returns_plain_password(db: Session) -> None:
    password = "svn-password-1"
    user = crud.create_user(
        session=db,
        user_create=UserCreate(full_name=f"SVN User {random_lower_string()}"),
    )
    service = CredentialService(master_key="test-master-key")

    service.save_svn_password(db, user.id, password)

    credential = db.exec(
        select(UserSvnCredential).where(UserSvnCredential.user_id == user.id)
    ).one()
    assert credential.encrypted_password != password
    assert service.get_svn_password(db, user.id) == password


def test_save_svn_password_updates_existing_credential(db: Session) -> None:
    first_password = "svn-password-1"
    second_password = "svn-password-2"
    user = crud.create_user(
        session=db,
        user_create=UserCreate(full_name=f"SVN User {random_lower_string()}"),
    )
    service = CredentialService(master_key="test-master-key")

    service.save_svn_password(db, user.id, first_password)
    service.save_svn_password(db, user.id, second_password)

    credentials = db.exec(
        select(UserSvnCredential).where(UserSvnCredential.user_id == user.id)
    ).all()
    assert len(credentials) == 1
    assert credentials[0].encrypted_password != second_password
    assert service.get_svn_password(db, user.id) == second_password
