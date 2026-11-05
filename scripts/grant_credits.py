"""Controlled development/operations grant; no public recharge or payment spoof."""

import argparse, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))
from sqlalchemy import select, update
from interior.database import session_scope
from interior.models import User, CreditAccount, CreditLedger

parser = argparse.ArgumentParser(
    description="经运维授权发放应用积分；不是付款或服务商充值。"
)
parser.add_argument("--email", required=True)
parser.add_argument("--amount", type=int, required=True)
parser.add_argument("--event-key", required=True)
args = parser.parse_args()
if not 1 <= args.amount <= 10000:
    parser.error("amount must be 1..10000")
with session_scope() as db:
    if db.scalar(
        select(CreditLedger).where(CreditLedger.event_key == "ops:" + args.event_key)
    ):
        raise SystemExit("该 event-key 已使用，不会重复发放。")
    u = db.scalar(
        select(User).where(
            User.email == args.email.lower().strip(), User.status == "active"
        )
    )
    if not u:
        raise SystemExit("账户不存在。")
    db.execute(
        update(CreditAccount)
        .where(CreditAccount.user_id == u.id)
        .values(available=CreditAccount.available + args.amount)
    )
    db.add(
        CreditLedger(
            user_id=u.id,
            event_key="ops:" + args.event_key,
            event_type="operations_grant",
            delta_available=args.amount,
            delta_reserved=0,
        )
    )
    print(f"Granted {args.amount} application credits to {u.id}; event recorded.")
