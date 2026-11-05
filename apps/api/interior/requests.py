from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import re


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Register(Strict):
    email: str = Field(max_length=254)
    password: str = Field(min_length=12, max_length=128)
    displayName: str = Field(min_length=1, max_length=80)

    @field_validator("email")
    @classmethod
    def email_valid(cls, v):
        v = v.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", v):
            raise ValueError("请输入有效邮箱。")
        return v


class Login(Strict):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class ProjectCreate(Strict):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    templateId: Literal[
        "two-room",
        "empty",
        "single-room",
        "one-bedroom",
        "two-bedroom",
        "three-bedroom",
        "three-bedroom-plus",
        "loft",
        "duplex",
        "villa",
        "courtyard",
    ] = "two-room"


class ProjectPatch(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    baseRevision: int = Field(ge=0)


class WorkingSave(Strict):
    scene: dict[str, Any]
    baseRevision: int = Field(ge=0)
    baseDesignId: str | None = None


class GeometryCreate(Strict):
    scene: dict[str, Any]
    baseRevision: int = Field(ge=0)
    measurementBatchId: str | None = None


class GeometryConfirm(Strict):
    expectedStructureHash: str
    basis: Literal["user_measured", "demo"] = "user_measured"
    confirmMeasuredDimensions: bool = False
    confirmDemoDimensions: bool = False
    acknowledgedIssueCodes: list[str] = []

    @model_validator(mode="after")
    def matching_acknowledgement(self):
        if self.basis == "user_measured" and (
            not self.confirmMeasuredDimensions or self.confirmDemoDimensions
        ):
            raise ValueError("真实实测确认需要核对实际量房数据。")
        if self.basis == "demo" and (
            not self.confirmDemoDimensions or self.confirmMeasuredDimensions
        ):
            raise ValueError("演示尺寸确认须明确承认数据为虚构参考。")
        return self


class DesignCreate(Strict):
    title: str = Field(min_length=1, max_length=120)
    geometryVersionId: str
    parentDesignId: str | None = None
    scene: dict[str, Any]
    baseRevision: int = Field(ge=0)


class JobCreate(Strict):
    type: Literal["layout", "style", "inpaint", "recognize", "render", "export"]
    geometryVersionId: str | None = None
    inputDesignId: str | None = None
    assetIds: list[str] = Field(default_factory=list, max_length=3)
    roomIds: list[str] = Field(default_factory=list, max_length=20)
    styleIds: list[str] = Field(default_factory=list, max_length=3)
    instruction: str = Field(default="", max_length=2000)
    maskDataUrl: str = Field(default="", max_length=8_000_000)
    parameters: dict[str, Any] = Field(default_factory=dict)
    maxCredits: int = Field(default=0, ge=0, le=300)
    pricingVersion: str = "2026-10-v1"


class BudgetCreate(Strict):
    designId: str
    currency: Literal["CNY"] = "CNY"
    assumptions: dict[str, Any] = Field(default_factory=dict)
    priceSourceIds: list[str] = []


class SceneRoomRequest(WorkingSave):
    roomId: str = Field(min_length=1, max_length=100)


class ReferenceCamera(Strict):
    positionMm: tuple[float, float, float]
    targetMm: tuple[float, float, float]
    fovDeg: float = Field(ge=10, le=110)
    aspectRatio: float = Field(ge=0.2, le=5)

    @field_validator("positionMm", "targetMm")
    @classmethod
    def bounded_points(cls, value):
        import math

        if any(not math.isfinite(v) or abs(v) > 1_000_000 for v in value):
            raise ValueError("相机坐标无效。")
        return value


class SceneReferenceCreate(SceneRoomRequest):
    imageDataUrl: str = Field(min_length=30, max_length=22_000_000)
    camera: ReferenceCamera


class ImageReview(Strict):
    checks: dict[str, Literal["consistent", "different", "uncertain"]]
    notes: str = Field(default="", max_length=2000)


class AssetPatch(Strict):
    """Photo organisation fields; only keys present in the request are changed."""

    roomId: str | None = Field(default=None, max_length=100)
    direction: (
        Literal[
            "north",
            "northeast",
            "east",
            "southeast",
            "south",
            "southwest",
            "west",
            "northwest",
        ]
        | None
    ) = None
    position: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)


class ShareCreate(Strict):
    designId: str
    expiresInHours: int = Field(default=72, ge=1, le=720)
    includeBudget: bool = False


class CommentCreate(Strict):
    designId: str
    body: str = Field(min_length=1, max_length=2000)
    roomId: str | None = None
    objectId: str | None = None
