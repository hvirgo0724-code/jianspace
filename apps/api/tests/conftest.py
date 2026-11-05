import os, sys, tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="jianspace-tests-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (tmp / "test.db").as_posix()
os.environ["STORAGE_ROOT"] = str(tmp / "assets")
os.environ["APP_ENV"] = "test"
# Test runs must never inherit credentials or paid-call settings from a local .env.
os.environ["ALLOW_AI_CALLS"] = "false"
os.environ["REGISTRATION_CREDITS"] = "6"
os.environ["FAMILY_TRIAL_CREDITS"] = "30"
os.environ["FAMILY_TRIAL_DAYS"] = "14"
os.environ["DASHSCOPE_API_KEY"] = ""
os.environ["DASHSCOPE_IMAGE_MODEL"] = "qwen-image-2.0-pro"
os.environ["DASHSCOPE_IMAGE_FALLBACK_MODELS"] = ""
os.environ["DASHSCOPE_API_BASE"] = "https://dashscope.aliyuncs.com"
os.environ["AI_STRUCTURE_REVIEW_ENABLED"] = "false"
os.environ["DASHSCOPE_VISION_MODEL"] = "qwen3-vl-plus"
os.environ["DASHSCOPE_TEXT_MODEL"] = ""
os.environ["WEATHER_DEFAULT_CITY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from fastapi.testclient import TestClient
from interior.main import app
from interior.database import Base, engine
from interior.security import _limits


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    _limits.clear()
    # Avoid a dispatcher racing controlled test transitions.
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


@pytest.fixture
def signed(client):
    r = client.post("/api/auth/demo", json={})
    assert r.status_code == 200, r.text
    client.headers["X-CSRF-Token"] = r.json()["csrfToken"]
    return client


@pytest.fixture
def project(signed):
    p = signed.post("/api/projects", json={"name": "测试的家"})
    assert p.status_code == 201, p.text
    pid = p.json()["id"]
    w = signed.get(f"/api/projects/{pid}/working-copy").json()
    return pid, w


@pytest.fixture
def confirmed(signed, project):
    pid, w = project
    g = signed.post(
        f"/api/projects/{pid}/geometry-versions",
        json={"scene": w["scene"], "baseRevision": w["revision"]},
    )
    assert g.status_code == 201, g.text
    g = g.json()
    r = signed.post(
        f"/api/projects/{pid}/geometry-versions/{g['id']}/confirm",
        json={
            "expectedStructureHash": g["structureHash"],
            "confirmMeasuredDimensions": True,
        },
    )
    assert r.status_code == 200, r.text
    return pid, signed.get(f"/api/projects/{pid}/working-copy").json()
