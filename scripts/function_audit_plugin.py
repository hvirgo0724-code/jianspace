"""Pytest-only HTTP operation audit; records route/status counts, never request data.

Run: python -m pytest apps/api/tests -q -p scripts.function_audit_plugin
The normal conftest isolates database/storage and disables paid AI calls.
"""

import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

from fastapi.testclient import TestClient

_original = TestClient.request
_requests = Counter()


def pytest_addoption(parser):
    parser.addoption(
        "--function-audit-output",
        default="artifacts/full-regression/api-operations.json",
    )


def pytest_sessionstart(session):
    def audited(client, method, url, *args, **kwargs):
        response = _original(client, method, url, *args, **kwargs)
        _requests[(method.upper(), urlsplit(str(url)).path, response.status_code)] += 1
        return response

    TestClient.request = audited


def pytest_sessionfinish(session, exitstatus):
    TestClient.request = _original
    from interior.main import app

    operations = []
    for path, methods in app.openapi()["paths"].items():
        if not path.startswith("/api/"):
            continue
        pattern = re.compile(
            "^"
            + "/".join(
                "[^/]+" if part.startswith("{") else re.escape(part)
                for part in path.split("/")
            )
            + "$"
        )
        for method in sorted(
            key.upper()
            for key in methods
            if key.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}
        ):
            statuses = Counter()
            for (verb, requested_path, status), count in _requests.items():
                if verb == method and pattern.fullmatch(requested_path):
                    statuses[str(status)] += count
            operations.append(
                {"method": method, "route": path, "responses": dict(statuses)}
            )
    report = {
        "testsCollected": session.testscollected,
        "testsFailed": session.testsfailed,
        "exitStatus": int(exitstatus),
        "totalOperations": len(operations),
        "exercisedOperations": sum(bool(o["responses"]) for o in operations),
        "operations": operations,
    }
    target = Path(__file__).resolve().parents[1] / session.config.getoption(
        "--function-audit-output"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
