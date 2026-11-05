from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy import select
from urllib.parse import quote
from typing import Literal
from ..security import DB, CurrentUser, authorize, DomainError
from ..models import Asset, WorkingCopy, Member, now
from ..requests import AssetPatch, ImageReview, SceneReferenceCreate
from ..geometry import structure_hash, content_hash, validate_scene
from ..storage import (
    normalize_image,
    save_asset,
    asset_view,
    read,
    put,
    thumb_key,
    make_thumbnail,
)

router = APIRouter()


@router.post("/projects/{project_id}/scene-references", status_code=201)
def capture_reference(
    project_id: str, body: SceneReferenceCreate, user: CurrentUser, db: DB
):
    """A labelled local WebGL capture, not a real room photograph or measurement."""
    import base64
    from shapely.geometry import Point, Polygon
    from ..ai_context import measured_context

    authorize(db, user, project_id, write=True)
    w = db.get(WorkingCopy, (project_id, user.id))
    if not w or w.revision != body.baseRevision:
        raise DomainError(
            "REVISION_CONFLICT", "请先保存当前场景，再创建视角参考。", 409
        )
    report = validate_scene(body.scene)
    if not report["valid"]:
        raise DomainError("GEOMETRY_INVALID", "请先修正场景，再创建参考。", 422, report)
    if structure_hash(body.scene) != structure_hash(w.scene_json) or content_hash(
        body.scene["layout"]["furniture"]
    ) != content_hash(w.scene_json["layout"]["furniture"]):
        raise DomainError(
            "REFERENCE_SCENE_CHANGED", "取景期间场景已变化，请重新取景。", 409
        )
    context = measured_context(w.scene_json, body.roomId)
    room = next(
        r for f in w.scene_json["floors"] for r in f["rooms"] if r["id"] == body.roomId
    )
    if (
        not Polygon(room["boundaryMm"])
        .buffer(100)
        .covers(Point(body.camera.positionMm[:2]))
        or not 50 <= body.camera.positionMm[2] <= room["heightMm"]
    ):
        raise DomainError(
            "REFERENCE_CAMERA_OUTSIDE",
            "请把相机移回房间内，并保持在本层地面与顶面之间。",
        )
    prefix = "data:image/jpeg;base64,"
    if not body.imageDataUrl.startswith(prefix):
        raise DomainError("INVALID_REFERENCE_IMAGE", "请使用3D视图创建 JPEG 参考。")
    try:
        raw = base64.b64decode(body.imageDataUrl[len(prefix) :], validate=True)
    except ValueError:
        raise DomainError("INVALID_REFERENCE_IMAGE", "参考图片编码无效。") from None
    data, meta = normalize_image(raw)
    reference = {
        "structureHash": context["structureHash"],
        "layoutHash": context["layoutHash"],
        "camera": body.camera.model_dump(mode="json"),
        "roomId": body.roomId,
        "floorId": context["floorId"],
        "confirmationBasis": context["confirmationBasis"],
    }
    a = save_asset(
        db,
        project_id,
        user.id,
        data,
        "3D场景视角参考（非实拍）.jpg",
        metadata={
            **meta,
            "referenceType": "scene_capture",
            "sceneReference": reference,
        },
        room_id=body.roomId,
    )
    return asset_view(a)


@router.get("/assets/{asset_id}/reference")
def reference_snapshot(asset_id: str, user: CurrentUser, db: DB):
    import base64
    from ..ai_context import reference_image

    a = db.get(Asset, asset_id)
    if (
        not a
        or a.state != "ready"
        or a.kind != "generated"
        or not a.metadata_json.get("geometryReference")
    ):
        raise DomainError("ASSET_NOT_FOUND", "参考快照不存在。", 404)
    authorize(db, user, a.project_id)
    return {
        "imageDataUrl": "data:image/png;base64,"
        + base64.b64encode(
            reference_image(a.metadata_json["geometryReference"])
        ).decode()
    }


@router.patch("/assets/{asset_id}/review")
def review_image(asset_id: str, body: ImageReview, user: CurrentUser, db: DB):
    a = db.get(Asset, asset_id)
    if not a or a.state != "ready" or a.kind != "generated":
        raise DomainError("ASSET_NOT_FOUND", "生成结果不存在。", 404)
    authorize(db, user, a.project_id, write=True)
    keys = {"walls", "doors", "windows", "furniture", "proportions"}
    if set(body.checks) != keys or not a.metadata_json.get("geometryReference"):
        raise DomainError("INVALID_REVIEW", "请完整核对五项结构与比例。")
    w = db.get(WorkingCopy, (a.project_id, user.id))
    context = a.metadata_json["geometryReference"]
    changed = bool(
        w
        and (
            structure_hash(w.scene_json) != context["structureHash"]
            or (
                context.get("layoutHash")
                and content_hash(w.scene_json["layout"]["furniture"])
                != context["layoutHash"]
            )
        )
    )
    result = dict(
        checks=body.checks,
        notes=body.notes,
        reviewedBy=user.id,
        reviewedAt=now(),
        contextChanged=changed,
        automatedRisk=a.metadata_json.get("structuralAudit", {}).get("risk", "unknown"),
        status="needs_revision"
        if changed
        or "different" in body.checks.values()
        or a.metadata_json.get("structuralAudit", {}).get("decision")
        == "needs_revision"
        else "reviewed"
        if all(v == "consistent" for v in body.checks.values())
        else "pending",
    )
    a.metadata_json = {**a.metadata_json, "review": result}
    db.flush()
    return asset_view(a)


@router.post("/projects/{project_id}/assets", status_code=201)
async def upload(
    project_id: str,
    user: CurrentUser,
    db: DB,
    file: UploadFile = File(...),
    roomId: str | None = Form(None),
    kind: Literal["photo", "floorplan"] = Form("photo"),
):
    authorize(db, user, project_id, write=True)
    if roomId:
        w = db.get(WorkingCopy, (project_id, user.id))
        if not w or roomId not in [
            r["id"] for f in w.scene_json["floors"] for r in f["rooms"]
        ]:
            raise DomainError("ROOM_MISSING", "照片关联的房间不存在。")
    raw = await file.read(15 * 1024 * 1024 + 1)
    data, meta = normalize_image(raw)
    a = save_asset(
        db,
        project_id,
        user.id,
        data,
        file.filename or "房间照片.jpg",
        kind=kind,
        metadata=meta,
        room_id=roomId,
    )
    return asset_view(a)


@router.patch("/assets/{asset_id}")
def organize_photo(asset_id: str, body: AssetPatch, user: CurrentUser, db: DB):
    """Attach a photo to a room, shooting direction, capture position and note."""
    a = db.get(Asset, asset_id)
    if not a or a.state != "ready":
        raise DomainError("ASSET_NOT_FOUND", "文件不存在。", 404)
    authorize(db, user, a.project_id, write=True)
    if a.kind != "photo":
        raise DomainError("ASSET_NOT_PHOTO", "只有房间照片可以整理拍摄信息。")
    fields = body.model_fields_set
    if "roomId" in fields and body.roomId:
        w = db.get(WorkingCopy, (a.project_id, user.id))
        rooms = [
            r["id"] for f in (w.scene_json["floors"] if w else []) for r in f["rooms"]
        ]
        if body.roomId not in rooms:
            raise DomainError("ROOM_MISSING", "照片关联的房间不存在。")
    metadata = dict(a.metadata_json)
    if "roomId" in fields:
        a.room_id = body.roomId
    for key, meta_key in (
        ("direction", "direction"),
        ("position", "capturePosition"),
        ("note", "note"),
    ):
        if key not in fields:
            continue
        value = getattr(body, key)
        value = value.strip() if isinstance(value, str) else value
        if value:
            metadata[meta_key] = value
        else:
            metadata.pop(meta_key, None)
    a.metadata_json = metadata
    db.flush()
    return asset_view(a)


@router.get("/projects/{project_id}/assets")
def assets(project_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    viewer = db.get(Member, (project_id, user.id)).role == "viewer"
    return {
        "items": [
            asset_view(a)
            for a in db.scalars(
                select(Asset)
                .where(
                    Asset.project_id == project_id,
                    Asset.state == "ready",
                    Asset.kind.notin_(["photo", "floorplan", "mask"]) if viewer else True,
                )
                .order_by(Asset.created_at.desc())
                .limit(200)
            )
        ]
    }


@router.get("/assets/{asset_id}/content")
def content(asset_id: str, user: CurrentUser, db: DB):
    a = db.get(Asset, asset_id)
    if not a or a.state != "ready":
        raise DomainError("ASSET_NOT_FOUND", "文件不存在。", 404)
    authorize(db, user, a.project_id)
    if (
        a.kind in ("photo", "floorplan", "mask")
        and db.get(Member, (a.project_id, user.id)).role == "viewer"
    ):
        raise DomainError("ASSET_FORBIDDEN", "查看者不能访问原始房间照片。", 403)
    try:
        data = read(a.object_key)
    except FileNotFoundError:
        raise DomainError("ASSET_NOT_FOUND", "文件已移除。", 404)
    return Response(
        data,
        media_type=a.media_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(a.name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/assets/{asset_id}/thumbnail")
def thumbnail(asset_id: str, user: CurrentUser, db: DB):
    a = db.get(Asset, asset_id)
    if not a or a.state != "ready" or not a.media_type.startswith("image/"):
        raise DomainError("ASSET_NOT_FOUND", "缩略图不存在。", 404)
    authorize(db, user, a.project_id)
    if (
        a.kind in ("photo", "floorplan", "mask")
        and db.get(Member, (a.project_id, user.id)).role == "viewer"
    ):
        raise DomainError("ASSET_FORBIDDEN", "查看者不能访问原始房间照片。", 403)
    try:
        data = read(thumb_key(a.object_key))
    except FileNotFoundError:
        try:
            source = read(a.object_key)
        except FileNotFoundError:
            raise DomainError("ASSET_NOT_FOUND", "文件已移除。", 404)
        data = make_thumbnail(source)
        try:
            put(thumb_key(a.object_key), data, "image/jpeg")
        except Exception:
            pass  # A cache-write failure must not hide an otherwise valid image.
    return Response(
        data,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/assets/{asset_id}", status_code=204)
def delete(asset_id: str, user: CurrentUser, db: DB):
    a = db.get(Asset, asset_id)
    if not a:
        raise DomainError("ASSET_NOT_FOUND", "文件不存在。", 404)
    authorize(db, user, a.project_id, write=True)
    a.state = "deleted"
