import copy
from typing import Literal
from ..plans import check_project_quota
from fastapi import APIRouter
from pydantic import Field, field_validator
from sqlalchemy import select, update, func, or_
from ..security import DB, CurrentUser, authorize, DomainError
from ..models import (
    Project,
    Member,
    WorkingCopy,
    GeometryVersion,
    DesignVersion,
    MeasurementBatch,
    Share,
    Job,
    Audit,
    Asset,
    uid,
    now,
)
from ..requests import (
    ProjectCreate,
    ProjectPatch,
    WorkingSave,
    GeometryCreate,
    GeometryConfirm,
    DesignCreate,
    Strict,
    SceneRoomRequest,
)
from ..geometry import (
    validate_scene,
    normalized,
    structure_hash,
    content_hash,
    validator,
    SCHEMA,
)
from jsonschema import Draft202012Validator, FormatChecker
from ..catalog import example_scene
from ..templates import template_scene
from ..catalog import budget_for

router = APIRouter()


@router.post("/projects/{project_id}/ai-context")
def ai_context(project_id: str, body: SceneRoomRequest, user: CurrentUser, db: DB):
    from ..ai_context import preview_context

    authorize(db, user, project_id, write=True)
    scene = checked_scene(body.scene, db, project_id)
    report = validate_scene(scene)
    if not report["valid"]:
        raise DomainError("GEOMETRY_INVALID", "请先修正当前场景。", 422, report)
    return preview_context(scene, body.roomId)


@router.post("/projects/{project_id}/estimate")
def estimate(project_id: str, body: WorkingSave, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    scene = checked_scene(body.scene, db, project_id)
    report = validate_scene(scene, check_layout=False)
    if not report["valid"]:
        raise DomainError("GEOMETRY_INVALID", "房间轮廓或报价关联无效。", 422, report)
    return budget_for(scene)


@router.post("/projects/{project_id}/layout-review")
def layout_review(project_id: str, body: WorkingSave, user: CurrentUser, db: DB):
    from ..layout_quality import assess_layout

    authorize(db, user, project_id)
    scene = checked_scene(body.scene, db, project_id)
    report = validate_scene(scene)
    if not report["valid"]:
        raise DomainError(
            "GEOMETRY_INVALID", "请先修正场景几何与碰撞问题。", 422, report
        )
    return assess_layout(scene)


def pview(p, scene=None):
    d = {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "revision": p.revision,
        "currentGeometryId": p.current_geometry_id,
        "currentDesignId": p.current_design_id,
        "archived": p.archived,
        "updatedAt": p.updated_at,
        "createdAt": p.created_at,
    }
    if scene:
        d["areaM2"] = (
            sum(
                r["computedAreaMm2"]
                for f in scene["floors"]
                for r in f["rooms"]
                if r["type"] not in ("courtyard", "terrace", "stairwell")
            )
            / 1e6
        )
        d["rooms"] = sum(len(f["rooms"]) for f in scene["floors"])
        d["styleId"] = scene["layout"]["styleId"]
        d["scenePreview"] = scene
        d["confirmationBasis"] = scene["confirmation"].get("basis")
        d["geometryStatus"] = scene["confirmation"]["status"]
    return d


def dview(d):
    return {
        "id": d.id,
        "projectId": d.project_id,
        "title": d.title,
        "geometryVersionId": d.geometry_version_id,
        "scene": d.scene_json,
        "sceneHash": d.scene_hash,
        "createdAt": d.created_at,
        "parentDesignId": d.parent_id,
    }


def gview(g):
    return {
        "id": g.id,
        "projectId": g.project_id,
        "versionNo": g.version_no,
        "status": g.status,
        "structureHash": g.structure_hash,
        "scene": g.scene_json,
        "validation": g.validation_json,
        "createdAt": g.created_at,
    }


def wview(w):
    return {
        "scene": w.scene_json,
        "revision": w.revision,
        "baseDesignId": w.base_design_id,
        "updatedAt": w.updated_at,
    }


def assert_owned(model, db, id, pid):
    obj = db.get(model, id)
    if not obj or obj.project_id != pid:
        raise DomainError("RESOURCE_NOT_FOUND", "该版本不存在或不属于当前项目。", 404)
    return obj


def checked_scene(scene, db, pid):
    errors = list(validator.iter_errors(scene))
    if errors:
        raise DomainError(
            "INVALID_SCENE",
            "场景格式不正确。",
            422,
            {
                "issues": [
                    {
                        "code": "SCHEMA_INVALID",
                        "message": e.message,
                        "field": ".".join(map(str, e.path)),
                        "objectIds": [],
                    }
                    for e in errors[:30]
                ]
            },
        )
    source_ids = {aid for m in scene["measurements"] for aid in m["sourceAssetIds"]}
    if scene["layout"].get("planSource"):
        source = assert_owned(Asset, db, scene["layout"]["planSource"]["assetId"], pid)
        if source.kind != "floorplan":
            raise DomainError("PLAN_IMAGE_REQUIRED", "识别来源必须为本项目的平面图。")
    for aid in source_ids:
        asset = assert_owned(Asset, db, aid, pid)
        if asset.state != "ready":
            raise DomainError("ASSET_NOT_FOUND", "测量来源文件不可用。")
    return normalized(scene)


@router.get("/projects")
def projects(
    user: CurrentUser,
    db: DB,
    limit: int = 24,
    offset: int = 0,
    archived: bool | None = None,
    q: str = "",
    status: Literal["all", "draft", "confirmed"] = "all",
    sort: Literal["updated", "name", "area"] = "updated",
):
    query = (
        select(Project)
        .join(Member, Member.project_id == Project.id)
        .where(Member.user_id == user.id, Project.deleted == False)
    )
    if archived is not None:
        query = query.where(Project.archived == archived)
    term = q.strip().lower()[:120]
    if term:
        query = query.where(
            or_(
                func.lower(Project.name).contains(term, autoescape=True),
                func.lower(Project.description).contains(term, autoescape=True),
            )
        )
    total = (
        db.scalar(
            select(func.count()).select_from(query.with_only_columns(Project.id).subquery())
        )
        or 0
    )
    active_total = (
        db.scalar(
            select(func.count())
            .select_from(Project)
            .join(Member, Member.project_id == Project.id)
            .where(
                Member.user_id == user.id,
                Project.deleted == False,
                Project.archived == False,
            )
        )
        or 0
    )
    start = max(offset, 0)
    page_size = min(max(limit, 1), 100)

    def row(p):
        w = db.get(WorkingCopy, (p.id, user.id))
        d = db.get(DesignVersion, p.current_design_id) if p.current_design_id else None
        return pview(p, w.scene_json if w else d.scene_json if d else None)

    if status != "all" or sort == "area":
        # Area and confirmation come from each member's working copy, so these
        # modes evaluate all matching projects before sorting and slicing.
        items = [row(p) for p in db.scalars(query).all()]
        if status != "all":
            items = [
                item
                for item in items
                if (item.get("geometryStatus") == "confirmed") == (status == "confirmed")
            ]
        items.sort(key=lambda item: item["id"])
        items.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
        if sort == "area":
            items.sort(
                key=lambda item: item.get("areaM2")
                if item.get("areaM2") is not None
                else -1,
                reverse=True,
            )
        total = len(items)
        page = items[start : start + page_size]
        next_offset = start + len(page)
    else:
        if sort == "name":
            query = query.order_by(func.lower(Project.name), Project.id)
        else:
            query = query.order_by(Project.updated_at.desc(), Project.id.desc())
        page = [row(p) for p in db.scalars(query.limit(page_size).offset(start)).all()]
        next_offset = start + len(page)
    return {
        "items": page,
        "total": total,
        "activeTotal": active_total,
        "offset": start,
        "nextCursor": str(next_offset) if next_offset < total else None,
    }


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreate, user: CurrentUser, db: DB):
    check_project_quota(db, user)
    p = Project(
        id=uid(), name=body.name.strip(), description=body.description, owner_id=user.id
    )
    db.add(p)
    db.flush()
    db.add(Member(project_id=p.id, user_id=user.id, role="owner"))
    s = template_scene(body.templateId)
    db.add(WorkingCopy(project_id=p.id, user_id=user.id, scene_json=s, revision=0))
    db.add(Audit(actor_id=user.id, project_id=p.id, action="project.create"))
    return pview(p, s)


@router.get("/projects/{project_id}")
def get_project(project_id: str, user: CurrentUser, db: DB):
    p = authorize(db, user, project_id)
    return pview(p)


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: ProjectPatch, user: CurrentUser, db: DB):
    authorize(db, user, project_id, write=True)
    values = {"updated_at": now(), "revision": body.baseRevision + 1}
    if body.name is not None:
        values["name"] = body.name.strip()
    if body.description is not None:
        values["description"] = body.description
    r = db.execute(
        update(Project)
        .where(Project.id == project_id, Project.revision == body.baseRevision)
        .values(**values)
    )
    if r.rowcount != 1:
        raise DomainError("REVISION_CONFLICT", "项目已更新，请刷新后再试。", 409)
    db.flush()
    return pview(db.get(Project, project_id))


@router.delete("/projects/{project_id}", status_code=202)
def remove_project(project_id: str, user: CurrentUser, db: DB):
    p = authorize(db, user, project_id, owner=True)
    p.deleted = True
    p.updated_at = now()
    db.execute(update(Share).where(Share.project_id == project_id).values(revoked=True))
    db.execute(
        update(Job)
        .where(
            Job.project_id == project_id,
            Job.status.in_(["queued", "running", "waiting_provider", "retry_wait"]),
        )
        .values(status="cancel_requested")
    )
    db.add(Audit(actor_id=user.id, project_id=p.id, action="project.delete"))
    return {
        "status": "deleted",
        "cleanupPolicy": "访问立即撤销；本地物理清理由清理命令执行。",
    }


class Archive(Strict):
    archived: bool
    baseRevision: int


@router.post("/projects/{project_id}/archive")
def archive(project_id: str, body: Archive, user: CurrentUser, db: DB):
    p = authorize(db, user, project_id, owner=True)
    if p.revision != body.baseRevision:
        raise DomainError("REVISION_CONFLICT", "项目已更新。", 409)
    if p.archived and not body.archived:
        check_project_quota(db, user)
    p.archived = body.archived
    p.revision += 1
    return pview(p)


class CopyRequest(Strict):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def nonempty_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("请输入副本项目名称。")
        return value


@router.post("/projects/{project_id}/copy", status_code=201)
def copy_project(project_id: str, body: CopyRequest, user: CurrentUser, db: DB):
    p = authorize(db, user, project_id)
    check_project_quota(db, user)
    w = db.get(WorkingCopy, (p.id, user.id))
    d = db.get(DesignVersion, p.current_design_id) if p.current_design_id else None
    s = copy.deepcopy(w.scene_json if w else d.scene_json if d else example_scene())
    s["sceneId"] = uid()
    s["geometryVersionId"] = uid()
    s["confirmation"] = {"status": "draft", "measurementRevision": 1}
    # Private attachments belong to the source project and are not copied.
    # Retaining this foreign reference makes the new draft impossible to save.
    s["layout"].pop("planSource", None)
    for m in s["measurements"]:
        m["sourceAssetIds"] = []
    q = Project(
        id=uid(),
        name=body.name,
        owner_id=user.id,
        description="从已有方案复制；尺寸来源需重新核对",
    )
    db.add(q)
    db.flush()
    db.add(Member(project_id=q.id, user_id=user.id, role="owner"))
    db.add(WorkingCopy(project_id=q.id, user_id=user.id, scene_json=s))
    return pview(q, s)


@router.get("/projects/{project_id}/working-copy")
def get_working(project_id: str, user: CurrentUser, db: DB):
    p = authorize(db, user, project_id)
    w = db.get(WorkingCopy, (project_id, user.id))
    if not w:
        d = db.get(DesignVersion, p.current_design_id) if p.current_design_id else None
        owner = db.get(WorkingCopy, (project_id, p.owner_id))
        s = copy.deepcopy(d.scene_json if d else owner.scene_json)
        w = WorkingCopy(project_id=p.id, user_id=user.id, scene_json=s)
        db.add(w)
        db.flush()
    return wview(w)


@router.put("/projects/{project_id}/working-copy")
def save_working(project_id: str, body: WorkingSave, user: CurrentUser, db: DB):
    p = authorize(db, user, project_id, write=True)
    report = validate_scene(body.scene, check_layout=False)
    # A geometrically inconsistent draft is retained; its JSON structure must remain valid.
    if any(i["code"] == "SCHEMA_INVALID" for i in report["issues"]):
        raise DomainError("INVALID_SCENE", "场景格式不正确。", 422, report)
    if body.baseDesignId:
        assert_owned(DesignVersion, db, body.baseDesignId, project_id)
    scene = checked_scene(body.scene, db, project_id)
    geometry = db.get(GeometryVersion, scene["geometryVersionId"])
    if (
        not geometry
        or geometry.project_id != project_id
        or geometry.status != "confirmed"
        or geometry.structure_hash != structure_hash(scene)
    ):
        scene["confirmation"] = {
            "status": "draft",
            "measurementRevision": scene["confirmation"]["measurementRevision"],
        }
    else:
        scene["confirmation"] = copy.deepcopy(geometry.scene_json["confirmation"])
    r = db.execute(
        update(WorkingCopy)
        .where(
            WorkingCopy.project_id == p.id,
            WorkingCopy.user_id == user.id,
            WorkingCopy.revision == body.baseRevision,
        )
        .values(
            scene_json=scene,
            revision=body.baseRevision + 1,
            updated_at=now(),
            base_design_id=body.baseDesignId,
        )
    )
    if r.rowcount != 1:
        raise DomainError(
            "REVISION_CONFLICT",
            "另一会话保存了新版本。你的修改已保留在浏览器，可另存副本。",
            409,
        )
    p.updated_at = now()
    db.flush()
    db.expire_all()
    return wview(db.get(WorkingCopy, (p.id, user.id)))


@router.post("/projects/{project_id}/geometry-drafts/validate")
def validate(project_id: str, body: WorkingSave, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return validate_scene(body.scene)


@router.post("/projects/{project_id}/geometry-versions", status_code=201)
def create_geometry(project_id: str, body: GeometryCreate, user: CurrentUser, db: DB):
    p = authorize(db, user, project_id, write=True)
    w = db.get(WorkingCopy, (p.id, user.id))
    if not w or w.revision != body.baseRevision:
        raise DomainError("REVISION_CONFLICT", "请先保存最新草稿。", 409)
    s = checked_scene(body.scene, db, p.id)
    report = validate_scene(s, check_layout=False)
    if not report["valid"]:
        raise DomainError("GEOMETRY_INVALID", "户型还有需要修正的问题。", 422, report)
    version_no = (
        db.scalar(
            select(func.max(GeometryVersion.version_no)).where(
                GeometryVersion.project_id == p.id
            )
        )
        or 0
    ) + 1
    s["geometryVersionId"] = uid()
    s["confirmation"] = {
        "status": "draft",
        "measurementRevision": s["confirmation"]["measurementRevision"],
    }
    g = GeometryVersion(
        id=s["geometryVersionId"],
        project_id=p.id,
        version_no=version_no,
        scene_json=s,
        structure_hash=structure_hash(s),
        validation_json=report,
        status="draft",
    )
    db.add(g)
    db.flush()
    return gview(g)


@router.get("/projects/{project_id}/geometry-versions")
def geometries(project_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return {
        "items": [
            gview(g)
            for g in db.scalars(
                select(GeometryVersion)
                .where(GeometryVersion.project_id == project_id)
                .order_by(GeometryVersion.version_no.desc())
            )
        ],
        "nextCursor": None,
    }


@router.get("/projects/{project_id}/geometry-versions/{version_id}")
def geometry(project_id: str, version_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return gview(assert_owned(GeometryVersion, db, version_id, project_id))


@router.post("/projects/{project_id}/geometry-versions/{version_id}/confirm")
def confirm(
    project_id: str, version_id: str, body: GeometryConfirm, user: CurrentUser, db: DB
):
    p = authorize(db, user, project_id, write=True)
    g = assert_owned(GeometryVersion, db, version_id, p.id)
    if g.structure_hash != body.expectedStructureHash:
        raise DomainError("REVISION_CONFLICT", "户型摘要不一致。", 409)
    if g.status == "confirmed":
        if g.scene_json["confirmation"].get("basis", "user_measured") != body.basis:
            raise DomainError(
                "CONFIRMATION_BASIS_CONFLICT",
                "已冻结版本的尺寸来源不能更改，请创建新几何版本。",
                409,
            )
        return gview(g)
    if not validate_scene(g.scene_json, check_layout=False)["valid"]:
        raise DomainError("GEOMETRY_INVALID", "户型校验未通过。")
    s = copy.deepcopy(g.scene_json)
    s["confirmation"] = {
        "status": "confirmed",
        "measurementRevision": s["confirmation"]["measurementRevision"],
        "confirmedBy": user.id,
        "confirmedAt": now(),
        "basis": body.basis,
    }
    g.scene_json = s
    g.status = "confirmed"
    g.confirmed_by = user.id
    g.confirmed_at = now()
    p.current_geometry_id = g.id
    w = db.get(WorkingCopy, (p.id, user.id))
    # Do not replace another tab's newer draft with the confirmation snapshot.
    if w and structure_hash(w.scene_json) == g.structure_hash:
        ws = copy.deepcopy(w.scene_json)
        ws["geometryVersionId"] = g.id
        ws["confirmation"] = s["confirmation"]
        w.scene_json = ws
        w.revision += 1
    db.add(
        Audit(
            actor_id=user.id,
            project_id=p.id,
            action="geometry.confirm",
            detail_json={"versionId": g.id, "basis": body.basis},
        )
    )
    return gview(g)


@router.get("/projects/{project_id}/designs")
def designs(project_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return {
        "items": [
            dview(d)
            for d in db.scalars(
                select(DesignVersion)
                .where(DesignVersion.project_id == project_id)
                .order_by(DesignVersion.created_at.desc())
                .limit(100)
            )
        ],
        "nextCursor": None,
    }


@router.get("/projects/{project_id}/designs/{design_id}")
def design(project_id: str, design_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return dview(assert_owned(DesignVersion, db, design_id, project_id))


@router.post("/projects/{project_id}/designs", status_code=201)
def save_design(project_id: str, body: DesignCreate, user: CurrentUser, db: DB):
    p = authorize(db, user, project_id, write=True)
    g = assert_owned(GeometryVersion, db, body.geometryVersionId, p.id)
    w = db.get(WorkingCopy, (p.id, user.id))
    if not w or w.revision != body.baseRevision:
        raise DomainError("REVISION_CONFLICT", "请先保存最新草稿再冻结方案。", 409)
    s = checked_scene(body.scene, db, p.id)
    if g.status != "confirmed" or g.structure_hash != structure_hash(s):
        raise DomainError("MEASUREMENT_UNCONFIRMED", "请先确认这份户型的实测数据。")
    s["geometryVersionId"] = g.id
    s["confirmation"] = copy.deepcopy(g.scene_json["confirmation"])
    report = validate_scene(s)
    if not report["valid"]:
        raise DomainError(
            "GEOMETRY_INVALID", "方案中还有家具冲突，请先修正。", 422, report
        )
    if body.parentDesignId:
        assert_owned(DesignVersion, db, body.parentDesignId, p.id)
    d = DesignVersion(
        id=uid(),
        project_id=p.id,
        geometry_version_id=g.id,
        parent_id=body.parentDesignId,
        title=body.title,
        scene_json=s,
        scene_hash=content_hash(s),
        creator_id=user.id,
    )
    db.add(d)
    db.flush()
    p.current_design_id = d.id
    p.updated_at = now()
    w.base_design_id = d.id
    w.revision += 1
    w.updated_at = now()
    return dview(d)


class Measurements(Strict):
    schemaVersion: str = "1.0"
    records: list[dict]
    sourceAssetIds: list[str] = []
    supersedesId: str | None = None


@router.post("/projects/{project_id}/measurements", status_code=201)
def measurements(project_id: str, body: Measurements, user: CurrentUser, db: DB):
    authorize(db, user, project_id, write=True)
    if len(body.records) > 10000:
        raise DomainError("INVALID_PAYLOAD", "测量记录过多。")
    check = Draft202012Validator(
        {"$defs": SCHEMA["$defs"], "$ref": "#/$defs/measurement"},
        format_checker=FormatChecker(),
    )
    for record in body.records:
        if not check.is_valid(record):
            raise DomainError("MEASUREMENT_INVALID", "测量记录不符合场景格式要求。")
        factor = {"mm": 1, "cm": 10, "m": 1000}[record["rawUnit"]]
        if round(record["rawValue"] * factor) != record["normalizedMm"]:
            raise DomainError("MEASUREMENT_UNIT_MISMATCH", "原始单位与毫米值不一致。")
    for aid in set(body.sourceAssetIds) | {
        a for r in body.records for a in r["sourceAssetIds"]
    }:
        assert_owned(Asset, db, aid, project_id)
    if body.supersedesId:
        assert_owned(MeasurementBatch, db, body.supersedesId, project_id)
    b = MeasurementBatch(
        id=uid(),
        project_id=project_id,
        user_id=user.id,
        records_json=body.records,
        source_asset_ids=body.sourceAssetIds,
    )
    db.add(b)
    return {
        "id": b.id,
        "projectId": project_id,
        "records": body.records,
        "schemaVersion": "1.0",
    }


@router.get("/projects/{project_id}/measurements")
def list_measurements(project_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return {
        "items": [
            {"id": x.id, "records": x.records_json, "createdAt": x.created_at}
            for x in db.scalars(
                select(MeasurementBatch)
                .where(MeasurementBatch.project_id == project_id)
                .order_by(MeasurementBatch.created_at.desc())
            )
        ],
        "nextCursor": None,
    }
