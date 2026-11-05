"""List and resolve assistant handoff tickets from the operations terminal."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))
from sqlalchemy import func, select
from interior.database import session_scope
from interior.models import AssistantHandoff, AssistantMessage, Project, User


def main():
    parser = argparse.ArgumentParser(description="小筑转人工工单：查看与回复。")
    parser.add_argument("--status", choices=["pending", "in_progress", "resolved"])
    parser.add_argument("--id", help="工单 ID 或前 8 位")
    parser.add_argument("--resolution", default="", help="人工处理说明，会写回对话")
    parser.add_argument(
        "--set-status", choices=["pending", "in_progress", "resolved"], default=None
    )
    args = parser.parse_args()

    with session_scope() as db:
        if not args.id:
            query = select(AssistantHandoff)
            if args.status:
                query = query.where(AssistantHandoff.status == args.status)
            rows = list(
                db.scalars(
                    query.order_by(AssistantHandoff.created_at.desc()).limit(50)
                )
            )
            for row in rows:
                user = db.get(User, row.user_id)
                project = db.get(Project, row.project_id) if row.project_id else None
                print(
                    f"{row.id[:8]}  {row.status:<11}  {row.reason:<12}  "
                    f"{(user.email if user else '?')}  {project.name if project else '-'}"
                )
            print(f"{len(rows)} ticket(s)")
            return

        rows = list(
            db.scalars(
                select(AssistantHandoff).where(AssistantHandoff.id.startswith(args.id))
            )
        )
        if len(rows) != 1:
            print("未找到唯一匹配的工单，请提供更完整的 ID。")
            return
        row = rows[0]
        if args.set_status:
            row.status = args.set_status
        if args.resolution:
            row.resolution = args.resolution
            if row.conversation_id:
                seq = (
                    db.scalar(
                        select(func.max(AssistantMessage.seq)).where(
                            AssistantMessage.conversation_id == row.conversation_id
                        )
                    )
                    or 0
                ) + 1
                db.add(
                    AssistantMessage(
                        conversation_id=row.conversation_id,
                        role="assistant",
                        content="【人工客服】" + args.resolution,
                        intent="handoff",
                        seq=seq,
                        mode="human",
                    )
                )
        print(f"{row.id} status={row.status} resolution={row.resolution or '-'}")


if __name__ == "__main__":
    main()
