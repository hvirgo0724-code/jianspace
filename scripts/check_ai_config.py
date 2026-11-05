"""Read-only configuration diagnostics. Never prints API keys or makes paid requests."""

import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps/api"))
from interior.config import settings
from interior.providers import provider_base, validate_provider_configuration
from interior.security import DomainError

try:
    config = validate_provider_configuration()
    if config["configurationError"]:
        raise ValueError(config["configurationError"])
    models = config["models"]
    api_host = provider_base()
    config_error = None
except (ValueError, DomainError) as exc:
    models = []
    api_host = None
    config_error = exc.message if isinstance(exc, DomainError) else str(exc)

print(
    json.dumps(
        {
            "envFileExists": (root / ".env").exists(),
            "keyConfigured": bool(settings.dashscope_api_key),
            "paidCallsEnabled": settings.allow_ai_calls,
            "ready": settings.ai_ready and config_error is None,
            "modelOrder": models,
            "apiHost": api_host,
            "configurationError": config_error,
            "structuralAuditEnabled": settings.ai_structure_review_enabled,
            "structuralAuditModel": settings.dashscope_vision_model
            if config_error is None and settings.ai_structure_review_enabled
            else None,
            "note": "Only configuration presence checked; no provider call or key disclosure.",
        },
        ensure_ascii=False,
        indent=2,
    )
)
