from contextlib import contextmanager
from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .config import settings, ROOT


class Base(DeclarativeBase):
    pass


url = settings.database_url
if url.startswith("sqlite:///./"):
    url = "sqlite:///" + (ROOT / url.removeprefix("sqlite:///./")).as_posix()
if url.startswith("sqlite:///") and ":memory:" not in url:
    Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(
    url,
    connect_args={"check_same_thread": False, "timeout": 30}
    if url.startswith("sqlite:")
    else {},
    pool_pre_ping=True,
)
if url.startswith("sqlite:"):

    @event.listens_for(engine, "connect")
    def sqlite_pragmas(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")


SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as db:
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise


@contextmanager
def session_scope():
    with SessionLocal() as db:
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
