"""Dry-run by default. Purge only explicitly soft-deleted, aged projects."""

import argparse, sys, time
from pathlib import Path
from datetime import datetime, timezone, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))
from sqlalchemy import select, delete, update
from interior.database import session_scope
from interior import models as m
from interior.storage import remove


def main():
    parser = argparse.ArgumentParser(
        description="预览或物理清理已软删除项目（默认仅预览）。"
    )
    parser.add_argument("--older-than-days", type=int, default=30)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if args.older_than_days < 1:
        parser.error("至少保留 1 天，防止误清理刚删除的项目。")
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=args.older_than_days)
    ).isoformat()
    with session_scope() as db:
        projects = list(
            db.scalars(
                select(m.Project).where(
                    m.Project.deleted == True, m.Project.updated_at < cutoff
                )
            )
        )
        print(
            f"{len(projects)} aged deleted projects; mode={'EXECUTE' if args.execute else 'DRY RUN'}"
        )
        for p in projects:
            jobs = list(db.scalars(select(m.Job).where(m.Job.project_id == p.id)))
            if any(j.status not in ("succeeded", "failed", "cancelled") for j in jobs):
                print(f"SKIP {p.id}: active jobs")
                continue
            assets = list(db.scalars(select(m.Asset).where(m.Asset.project_id == p.id)))
            print(f"{p.id}: {len(assets)} stored objects, {len(jobs)} tasks")
            if not args.execute:
                continue
            for a in assets:
                remove(a.object_key)
            ids = [j.id for j in jobs]
            db.execute(delete(m.Outbox).where(m.Outbox.job_id.in_(ids)))
            db.execute(
                update(m.CreditLedger)
                .where(m.CreditLedger.job_id.in_(ids))
                .values(job_id=None)
            )
            db.execute(
                delete(m.Idempotency).where(m.Idempotency.route == f"{p.id}/jobs")
            )
            db.execute(
                update(m.DesignVersion)
                .where(m.DesignVersion.project_id == p.id)
                .values(parent_id=None)
            )
            for model in (
                m.Share,
                m.Budget,
                m.Comment,
                m.Approval,
                m.Asset,
                m.MeasurementBatch,
                m.WorkingCopy,
                m.Member,
                m.SupportReport,
                m.Audit,
                m.DesignVersion,
                m.GeometryVersion,
                m.Job,
            ):
                db.execute(delete(model).where(model.project_id == p.id))
            db.delete(p)
        if args.execute:
            db.execute(
                delete(m.UserSession).where(m.UserSession.expires_epoch < time.time())
            )
            db.execute(
                delete(m.Challenge).where(m.Challenge.expires_epoch < time.time())
            )


if __name__ == "__main__":
    main()
