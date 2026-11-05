"""Create a consistent local backup: SQLite database + private asset files.

Usage:
  python scripts/backup.py --output backups
  python scripts/backup.py --output backups --label before-upgrade

Only the local SQLite + local storage layout is copied. PostgreSQL deployments
must use pg_dump and their object-store versioning instead.
"""

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))
from interior.config import ROOT, settings


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description="备份本地数据库与私有资产（不包含密钥）。")
    parser.add_argument("--output", default="backups", help="备份根目录")
    parser.add_argument("--label", default="", help="可选标签，便于识别备份用途")
    args = parser.parse_args()

    url = settings.database_url
    if not url.startswith("sqlite:///"):
        parser.error("当前脚本只支持本地 SQLite；PostgreSQL 请使用 pg_dump 与对象存储版本。")
    source = Path(url[len("sqlite:///") :])
    if not source.is_absolute():
        source = (ROOT / source).resolve()
    if not source.exists():
        parser.error(f"数据库不存在：{source}")

    storage = settings.storage_root
    storage = storage if storage.is_absolute() else (ROOT / storage).resolve()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    name = f"{stamp}-{args.label}" if args.label else stamp
    target = (Path(args.output) if Path(args.output).is_absolute() else ROOT / args.output) / name
    target.mkdir(parents=True, exist_ok=False)
    if storage.exists() and target.resolve().is_relative_to(storage.resolve()):
        parser.error("备份目录不能位于资产目录内，避免递归复制。")

    db_copy = target / "jianspace.db"
    with sqlite3.connect(source) as src, sqlite3.connect(db_copy) as dst:
        src.backup(dst)

    asset_files = 0
    asset_bytes = 0
    if settings.storage_backend == "local" and storage.exists():
        shutil.copytree(storage, target / "assets", dirs_exist_ok=True)
        for file in (target / "assets").rglob("*"):
            if file.is_file():
                asset_files += 1
                asset_bytes += file.stat().st_size
    else:
        print("跳过资产复制：存储后端不是本地目录。")

    manifest = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "label": args.label,
        "database": {
            "file": "jianspace.db",
            "bytes": db_copy.stat().st_size,
            "sha256": sha256(db_copy),
        },
        "assets": {
            "included": settings.storage_backend == "local",
            "files": asset_files,
            "bytes": asset_bytes,
        },
        "storageBackend": settings.storage_backend,
        "note": "备份不包含 .env 或服务商密钥；恢复时同时替换数据库与 assets 目录。",
    }
    (target / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"备份完成：{target}")
    print(f"数据库 {manifest['database']['bytes']} 字节；资产 {asset_files} 个文件 / {asset_bytes} 字节")


if __name__ == "__main__":
    main()
