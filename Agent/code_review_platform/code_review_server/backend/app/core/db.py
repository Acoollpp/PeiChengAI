from sqlmodel import Session, create_engine, select

from app.core.config import settings
from app.models import AuthSource, User, UserRole

engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))
DEFAULT_LOCAL_ADMIN_NAME = "Local Admin"


# make sure all SQLModel models are imported (app.models) before initializing DB
# otherwise, SQLModel might fail to initialize relationships properly
# for more details: https://github.com/fastapi/full-stack-fastapi-template/issues/28


def init_db(session: Session) -> None:
    # Tables should be created with Alembic migrations
    # But if you don't want to use migrations, create
    # the tables un-commenting the next lines
    # from sqlmodel import SQLModel

    # This works because the models are already imported and registered from app.models
    # SQLModel.metadata.create_all(engine)

    superuser = session.exec(select(User).where(User.is_superuser)).first()
    if superuser:
        return

    superuser = session.exec(
        select(User).where(User.full_name == settings.FIRST_SUPERUSER)
    ).first()
    if not superuser:
        superuser = User(
            full_name=DEFAULT_LOCAL_ADMIN_NAME,
            is_active=True,
            is_superuser=True,
            role=UserRole.admin,
            auth_source=AuthSource.local,
        )
        session.add(superuser)
        session.commit()
        session.refresh(superuser)
