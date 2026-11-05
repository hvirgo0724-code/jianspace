import hashlib, io, warnings, logging
from PIL import Image, ImageOps
from .config import settings, ROOT
from .security import DomainError
from .models import Asset, uid

log = logging.getLogger(__name__)


def root():
    p = settings.storage_root
    return p if p.is_absolute() else ROOT / p


def s3():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url or None,
        aws_access_key_id=settings.s3_access_key_id or None,
        aws_secret_access_key=settings.s3_secret_access_key or None,
    )


def put(key, data, media_type):
    if settings.storage_backend == "s3":
        s3().put_object(
            Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=media_type
        )
    else:
        p = (root() / key).resolve()
        if not p.is_relative_to(root().resolve()):
            raise ValueError("Invalid storage key")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)


def read(key):
    if settings.storage_backend == "s3":
        return s3().get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()
    p = (root() / key).resolve()
    if not p.is_relative_to(root().resolve()):
        raise ValueError("Invalid storage key")
    return p.read_bytes()


def remove(key):
    if settings.storage_backend == "s3":
        s3().delete_object(Bucket=settings.s3_bucket, Key=key)
    else:
        path = (root() / key).resolve()
        if not path.is_relative_to(root().resolve()):
            raise ValueError("Invalid storage key")
        path.unlink(missing_ok=True)


def normalize_image(raw):
    if len(raw) > 15 * 1024 * 1024:
        raise DomainError("FILE_TOO_LARGE", "单张照片不能超过 15 MB。", 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            im = Image.open(io.BytesIO(raw))
            if im.format not in ("JPEG", "PNG", "WEBP"):
                raise ValueError("format")
            if im.width * im.height > 40_000_000:
                raise ValueError("pixels")
            im = ImageOps.exif_transpose(im)
            im.thumbnail((2048, 2048))
            im = im.convert("RGB")
            out = io.BytesIO()
            im.save(out, "JPEG", quality=90)
            return out.getvalue(), {
                "width": im.width,
                "height": im.height,
                "exifRemoved": True,
            }
    except Exception as exc:
        raise DomainError(
            "INVALID_IMAGE", "请上传有效的 JPEG、PNG 或 WebP 照片，像素不超过 4000 万。"
        ) from exc


def save_asset(
    db,
    pid,
    user_id,
    data,
    name,
    kind="photo",
    media="image/jpeg",
    metadata=None,
    room_id=None,
):
    aid = uid()
    ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "application/pdf": "pdf",
        "application/json": "json",
        "text/csv": "csv",
    }.get(media, "bin")
    key = f"{pid}/{aid}.{ext}"
    a = Asset(
        id=aid,
        project_id=pid,
        uploader_id=user_id,
        name=name[:240],
        kind=kind,
        object_key=key,
        media_type=media,
        bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        metadata_json=metadata or {},
        room_id=room_id,
    )
    db.add(a)
    # Check DB references before writing an object. The caller owns the outer
    # transaction; a later commit failure still requires orphan-file maintenance.
    db.flush()
    try:
        put(key, data, media)
    except Exception:
        try:
            remove(key)
        except Exception:
            # Preserve the write exception without logging URLs or credentials.
            log.warning("Could not clean failed asset write %s", aid)
        raise
    return a


def thumb_key(key):
    return key + ".thumb.jpg"


def make_thumbnail(raw, size=480):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            im = Image.open(io.BytesIO(raw))
            im = ImageOps.exif_transpose(im).convert("RGB")
            im.thumbnail((size, size))
            out = io.BytesIO()
            im.save(out, "JPEG", quality=82)
            return out.getvalue()
    except Exception as exc:
        raise DomainError("THUMBNAIL_FAILED", "缩略图生成失败。", 500) from exc


def asset_view(a):
    return {
        "id": a.id,
        "projectId": a.project_id,
        "name": a.name,
        "kind": a.kind,
        "mediaType": a.media_type,
        "bytes": a.bytes,
        "roomId": a.room_id,
        "metadata": a.metadata_json,
        "createdAt": a.created_at,
        "url": f"/api/assets/{a.id}/content",
        "thumbUrl": f"/api/assets/{a.id}/thumbnail"
        if a.media_type.startswith("image/")
        else None,
    }
