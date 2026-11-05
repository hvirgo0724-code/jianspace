"""Read-only endpoint connectivity check: no key, model request, or image is sent."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))
import httpx
from interior.providers import provider_base

try:
    response = httpx.get(provider_base(), timeout=10, follow_redirects=False)
    result = {
        "reachable": True,
        "httpStatus": response.status_code,
        "credentialsSent": False,
    }
except httpx.TransportError as exc:
    chain = []
    current = exc
    while current and len(chain) < 8:
        chain.append(current)
        current = current.__cause__ or current.__context__
    result = {
        "reachable": False,
        "transportType": type(exc).__name__,
        "causeTypes": [type(item).__name__ for item in chain],
        "windowsErrors": [
            getattr(item, "winerror", None)
            for item in chain
            if getattr(item, "winerror", None) is not None
        ],
        "permissionDenied": any(
            "10013" in str(item) or "Permission denied" in str(item) for item in chain
        ),
        "certificateError": any(
            "CERTIFICATE_VERIFY_FAILED" in str(item) for item in chain
        ),
        "credentialsSent": False,
    }
print(json.dumps(result, indent=2))
