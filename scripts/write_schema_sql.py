"""离线编译 PostgreSQL 建表 SQL，用于审查；生产以 Alembic 迁移为准。

用法：python scripts/write_schema_sql.py
输出：docs/schema.postgresql.sql
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api"))

from sqlalchemy.schema import CreateTable  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402

from interior import models  # noqa: F401,E402  — 注册全部表
from interior.database import Base  # noqa: E402


HEADER = """-- 由 SQLAlchemy 模型离线编译生成，请勿手改。
-- 生成命令：python scripts/write_schema_sql.py
-- 生产库结构以 apps/api/migrations 的 Alembic 迁移为准。
"""


def main() -> None:
    dialect = postgresql.dialect()
    lines = [HEADER]
    for table in Base.metadata.sorted_tables:
        ddl = str(CreateTable(table).compile(dialect=dialect)).strip()
        lines.append(ddl + "\n")
    target = ROOT / "docs" / "schema.postgresql.sql"
    target.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {len(Base.metadata.sorted_tables)} tables to {target}")


if __name__ == "__main__":
    main()
