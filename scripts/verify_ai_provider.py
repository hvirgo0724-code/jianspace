"""Explicit, single-call live QA using only the named synthetic reference fixture.

This does not confirm real measurements or exercise production job billing.
It stores a clearly labelled verification asset in the fictional QA project.
"""

import argparse
import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps/api"))

from interior.ai_context import measured_context, reference_image
from interior.config import settings
from interior.database import SessionLocal
from interior.geometry import content_hash
from interior.models import Asset, Project, WorkingCopy
from interior.providers import generate_image, provider_base
from interior.security import DomainError
from interior.storage import save_asset

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--confirm-paid",
    action="store_true",
    help="Authorize one real image call; provider fees can apply",
)
args = parser.parse_args()
if not args.confirm_paid:
    parser.error("Requires --confirm-paid; no request sent.")
if not settings.ai_ready:
    parser.error("AI key/call switch not configured; no request sent.")

pid = "ca593ec9-d882-47c9-a9ec-2451bf27a45d"
source_id = "c151cc75-3d2e-4ef5-8996-2702ee7ae3d1"
provider_base()
model = settings.image_model_chain[0]
out_dir = root / "artifacts" / "ai-live-validation"
out_dir.mkdir(parents=True, exist_ok=True)
report_path = out_dir / "result.json"
# Re-running must not silently buy another image after a success or uncertain call.
if report_path.exists():
    parser.error(
        "A live verification report already exists. Review it before authorizing another call."
    )

with SessionLocal() as db:
    p = db.get(Project, pid)
    source = db.get(Asset, source_id)
    w = db.get(WorkingCopy, (pid, p.owner_id)) if p else None
    if (
        not p
        or p.name != "三项目标验收 · 虚构数据"
        or p.deleted
        or not w
        or not source
        or source.project_id != pid
        or source.kind != "photo"
        or source.state != "ready"
        or source.name != "合成3D参考（非实拍）.png"
    ):
        parser.error(
            "Named fictional project and synthetic fixture must match; no request sent."
        )
    scene = copy.deepcopy(w.scene_json)
    scene_before = content_hash(scene)
    context = measured_context(scene, source.room_id)
    (out_dir / "reference.png").write_bytes(reference_image(context))
    report = {
        "verificationOnly": True,
        "referenceKind": "synthetic-3d-not-a-real-room-photo",
        "measurementStatus": scene["confirmation"]["status"],
        "projectId": pid,
        "sourceAssetId": source_id,
        "model": model,
        "fallbackEnabledForThisProbe": False,
        "applicationCreditsCharged": 0,
        "providerBilling": "Check Alibaba Cloud records; this report does not read balance or free quota.",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "status": "started",
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # Explicitly one primary attempt for this development probe, not the normal fallback workflow.
    settings.dashscope_image_fallback_models = ""
    try:
        data, metadata = generate_image(
            [source],
            "原木自然",
            "这是合成3D模型参考而非真实住宅照片。保留房间布局及两件床头柜，改善墙面、木地板和光照质感，去除界面按钮和文字。",
            geometry=context,
        )
    except DomainError as exc:
        report.update(status="failed", error={"code": exc.code, "message": exc.message})
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=True, indent=2))
        raise SystemExit(1) from None
    except Exception:
        report.update(
            status="uncertain",
            error={
                "code": "VERIFY_UNEXPECTED_ERROR",
                "message": "Check provider records before another request.",
            },
        )
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=True, indent=2))
        raise SystemExit(1) from None
    (out_dir / "generated.jpg").write_bytes(data)
    metadata = {
        **metadata,
        "verificationOnly": True,
        "referenceKind": report["referenceKind"],
        "applicationCreditsCharged": 0,
        "geometryReference": context,
        "referenceAssetIds": [source_id],
        "review": {
            "checks": {
                k: "uncertain"
                for k in ("walls", "doors", "windows", "furniture", "proportions")
            },
            "notes": "真实服务商接口开发验收，输入为合成3D参考与虚构尺寸，不代表真实住宅。",
            "status": "pending",
        },
    }
    asset = save_asset(
        db,
        pid,
        p.owner_id,
        data,
        "真实接口验收 · 合成参考（非实拍）.jpg",
        "generated",
        "image/jpeg",
        metadata,
        source.room_id,
    )
    assert content_hash(w.scene_json) == scene_before
    db.commit()
    report.update(
        status="succeeded",
        finishedAt=datetime.now(timezone.utc).isoformat(),
        assetId=asset.id,
        metadata=metadata,
        sceneUnchanged=True,
    )
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "status",
                    "model",
                    "assetId",
                    "sceneUnchanged",
                    "applicationCreditsCharged",
                )
            },
            ensure_ascii=True,
            indent=2,
        )
    )
