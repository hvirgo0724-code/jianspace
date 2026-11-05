"""All structural audit responses are fixtures; these tests never use a live key."""

import copy
import io
import json

import httpx
import pytest
from PIL import Image
from pydantic import ValidationError

from interior import structure_review
from interior.ai_context import measured_context
from interior.catalog import single_room_scene
from interior.config import settings


@pytest.fixture
def context():
    s = single_room_scene()
    return measured_context(s, s["floors"][0]["rooms"][0]["id"])


def assessment():
    return {
        "checks": {
            key: {"verdict": "consistent", "evidence": "测试可见区域未发现明显差异"}
            for key in structure_review.CHECK_KEYS
        },
        "observed": {
            "sourceDoorCount": 0,
            "resultDoorCount": 0,
            "sourceWindowCount": 0,
            "resultWindowCount": 0,
            "sourceViewComplete": True,
            "resultViewComplete": True,
        },
        "summary": "测试夹具，不代表真实模型能力。",
    }


@pytest.fixture
def fake_vision(monkeypatch):
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "fake-vision-key-never-live")
    monkeypatch.setattr(settings, "dashscope_vision_model", "qwen3-vl-plus")
    monkeypatch.setattr(
        settings, "dashscope_api_base", "https://dashscope.aliyuncs.com"
    )
    raw = io.BytesIO()
    Image.new("RGB", (400, 400), "white").save(raw, "JPEG")
    image = raw.getvalue()
    calls = []
    responses = []

    class Client:
        def __init__(self, **kwargs):
            calls.append({"clientOptions": kwargs})

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            calls.append({"url": url, "json": kwargs["json"]})
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

    monkeypatch.setattr(structure_review.httpx, "Client", Client)
    return responses, calls, image


def response(payload=None, **extra):
    return httpx.Response(
        200,
        json={
            "id": "fixture-review-id",
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {"content": json.dumps(payload or assessment())},
                }
            ],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 200,
                "total_tokens": 300,
            },
            **extra,
        },
    )


def test_default_is_no_paid_request_and_pending(context, fake_vision):
    _, calls, image = fake_vision
    result = structure_review.review_structure(context, [image], image)
    assert result["status"] == "skipped" and result["decision"] == "pending"
    assert result["manualReviewRequired"] is True and calls == []


def test_global_opt_in_and_key_are_required(context, fake_vision, monkeypatch):
    _, calls, image = fake_vision
    monkeypatch.setattr(settings, "allow_ai_calls", False)
    result = structure_review.review_structure(context, [image], image, enabled=True)
    assert result["reason"] == "not_configured" and not calls
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "")
    assert (
        structure_review.review_structure(context, [image], image, enabled=True)[
            "reason"
        ]
        == "not_configured"
    )
    assert not calls


def test_request_uses_three_labelled_images_json_and_non_thinking_without_mutating_context(
    context, fake_vision
):
    responses, calls, image = fake_vision
    responses.append(response())
    original = copy.deepcopy(context)
    result = structure_review.review_structure(context, [image], image, enabled=True)
    request = calls[1]
    assert (
        request["url"]
        == "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    )
    body = request["json"]
    assert (
        body["response_format"] == {"type": "json_object"}
        and body["enable_thinking"] is False
    )
    assert body["max_tokens"] == 1800 and body["stream"] is False
    images = [
        item for item in body["messages"][0]["content"] if item["type"] == "image_url"
    ]
    assert len(images) == 3 and images[0]["image_url"]["url"].startswith(
        "data:image/png;base64,"
    )
    assert "JSON" in body["messages"][0]["content"][0]["text"]
    assert "遮挡" in body["messages"][0]["content"][0]["text"]
    assert result["status"] == "completed" and result["decision"] == "pending"
    assert result["checks"]["proportions"]["verdict"] == "uncertain"
    assert (
        result["manualReviewRequired"] is True
        and result["requestId"] == "fixture-review-id"
    )
    assert result["usage"]["total_tokens"] == 300 and context == original
    assert "fake-vision-key-never-live" not in str(result)


@pytest.mark.parametrize("key,singular", [("doors", "Door"), ("windows", "Window")])
def test_zero_measured_openings_and_new_visible_openings_force_high_risk(
    context, key, singular
):
    payload = assessment()
    payload["observed"][f"result{singular}Count"] = 2
    payload["observed"]["resultViewComplete"] = False
    result = structure_review.assess_payload(payload, context)
    assert result["risk"] == "high" and result["decision"] == "needs_revision"
    assert result["checks"][key]["verdict"] == "different"
    assert "实测资料记录 0" in result["checks"][key]["evidence"]


def test_partial_view_cannot_prove_a_measured_door_is_missing(context):
    context["openings"] = [{"kind": "door"}]
    payload = assessment()
    payload["checks"]["doors"]["verdict"] = "different"
    payload["observed"].update(
        sourceDoorCount=1, resultDoorCount=0, resultViewComplete=False
    )
    result = structure_review.assess_payload(payload, context)
    assert result["checks"]["doors"]["verdict"] == "uncertain"
    assert result["decision"] == "pending"


def test_complete_visible_count_difference_is_reported(context):
    context["openings"] = [{"kind": "door"}]
    payload = assessment()
    payload["observed"].update(sourceDoorCount=1, resultDoorCount=0)
    result = structure_review.assess_payload(payload, context)
    assert result["checks"]["doors"]["verdict"] == "different"


def test_unknown_counts_are_not_treated_as_zero_or_consistent(context):
    payload = assessment()
    payload["observed"].update(sourceDoorCount=None, resultDoorCount=None)
    result = structure_review.assess_payload(payload, context)
    assert result["observed"]["resultDoorCount"] is None
    assert result["checks"]["doors"]["verdict"] == "uncertain"
    assert result["decision"] == "pending"


def test_changed_viewpoint_downgrades_position_claims_but_preserves_new_opening_risk(
    context,
):
    payload = assessment()
    payload["checks"]["viewpoint"]["verdict"] = "different"
    payload["checks"]["walls"]["verdict"] = "different"
    payload["observed"]["resultDoorCount"] = 2
    result = structure_review.assess_payload(payload, context)
    assert result["checks"]["walls"]["verdict"] == "uncertain"
    assert result["checks"]["furniture"]["verdict"] == "uncertain"
    assert result["checks"]["doors"]["verdict"] == "different"
    assert result["risk"] == "high"


@pytest.mark.parametrize(
    "mutation",
    [
        lambda payload: payload["checks"].pop("viewpoint"),
        lambda payload: payload["checks"]["doors"].update(verdict="approved"),
        lambda payload: payload["checks"]["doors"].update(evidence=""),
        lambda payload: payload["checks"]["doors"].update(evidence="   "),
        lambda payload: payload["checks"]["doors"].update(evidence="x" * 601),
        lambda payload: payload.update(approved=True),
        lambda payload: payload.update(summary=" \n "),
        lambda payload: payload["observed"].update(resultDoorCount=True),
        lambda payload: payload["observed"].update(resultDoorCount=-1),
        lambda payload: payload["observed"].update(resultDoorCount=101),
        lambda payload: payload["observed"].update(resultViewComplete="true"),
    ],
)
def test_schema_rejects_incomplete_or_untrusted_assessments(context, mutation):
    payload = assessment()
    mutation(payload)
    with pytest.raises(ValidationError):
        structure_review.assess_payload(payload, context)


@pytest.mark.parametrize(
    "service_response",
    [
        httpx.Response(401, json={"message": "fake-vision-key-never-live"}),
        httpx.Response(429, json={"message": "quota"}),
        httpx.Response(500, json={"message": "server error"}),
        httpx.ReadTimeout("fixture timeout"),
        httpx.Response(200, json={"choices": []}),
        httpx.Response(
            200, json={"choices": [{"message": {"content": "```json\n{}\n```"}}]}
        ),
        httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "{}"}, "finish_reason": "length"}]
            },
        ),
        httpx.Response(200, content=b"a" * (structure_review.MAX_RESPONSE_BYTES + 1)),
    ],
)
def test_service_failures_remain_pending_and_do_not_retry(
    context, fake_vision, service_response
):
    responses, calls, image = fake_vision
    responses.append(service_response)
    result = structure_review.review_structure(context, [image], image, enabled=True)
    assert result["status"] == "failed" and result["decision"] == "pending"
    assert result["risk"] == "unknown" and result["manualReviewRequired"] is True
    assert len([call for call in calls if "url" in call]) == 1
    assert "fake-vision-key-never-live" not in str(result)
    assert not responses


@pytest.mark.parametrize(
    "images,timeout",
    [
        ([], 45),
        ([b"not-an-image"], 45),
        ([b"x"] * 3, 45),
        ([b"x"], float("inf")),
        ([b"x"], 0),
    ],
)
def test_invalid_input_never_makes_a_paid_request(
    context, fake_vision, images, timeout
):
    _, calls, image = fake_vision
    result = structure_review.review_structure(
        context, images, image, enabled=True, timeout_seconds=timeout
    )
    assert (
        result["status"] == "failed"
        and result["reason"] == "invalid_input"
        and not calls
    )


def test_invalid_model_and_host_never_send_a_request_or_expose_config(
    context, fake_vision, monkeypatch
):
    _, calls, image = fake_vision
    monkeypatch.setattr(
        settings, "dashscope_vision_model", "fake-vision-key-never-live"
    )
    result = structure_review.review_structure(context, [image], image, enabled=True)
    assert result[
        "reason"
    ] == "invalid_config" and "fake-vision-key-never-live" not in str(result)
    monkeypatch.setattr(settings, "dashscope_vision_model", "qwen3-vl-plus")
    monkeypatch.setattr(
        settings,
        "dashscope_api_base",
        "https://foreign.example.com?key=fake-vision-key-never-live",
    )
    result = structure_review.review_structure(context, [image], image, enabled=True)
    assert result["reason"] == "invalid_config" and not calls
    assert "fake-vision-key-never-live" not in str(result)


@pytest.mark.parametrize(
    "model,expected",
    [
        ("qwen3-vl-plus", True),
        (" qwen3-vl-flash ", True),
        ("qwen3-vl-plus-2025-12-19", True),
        ("qwen-vl-plus", True),
        ("qwen-vl-max", True),
        ("qwen-vl-plus-latest", False),
        ("qwen-plus", False),
        ("qwen-image-2.0-pro", False),
        (None, False),
    ],
)
def test_preflight_model_validator(model, expected):
    assert structure_review.validate_structure_review_model(model) is expected


@pytest.mark.parametrize(
    "text",
    [
        '{"checks":{},"checks":{"doors":{"verdict":"consistent"}}}',
        '{"checks":{"doors":{"verdict":"different","verdict":"consistent"}}}',
        '{"observed":{"resultDoorCount":NaN}}',
        '{"observed":{"resultDoorCount":Infinity}}',
    ],
)
def test_duplicate_fields_and_nonstandard_json_are_rejected(text):
    with pytest.raises(ValueError):
        structure_review.parse_assessment_json(text)


def test_prompt_stays_compact_without_dropping_known_opening_counts(context):
    context["openings"] = [{"kind": "door", "id": "x" * 100}] * 1500 + [
        {"kind": "window"}
    ] * 500
    context["walls"] = [{"id": "x" * 100, "extra": "y" * 1000}] * 2000
    context["boundaryMm"] = [[i, i] for i in range(200)]
    context["camera"] = {
        "positionMm": [1000, 2000, 1600],
        "targetMm": [0, 0, 0],
        "fov": 60,
        "aspect": 1.6,
    }
    prompt = structure_review.review_prompt(context)
    assert len(prompt.encode("utf-8")) < 4000
    assert '"knownOpenings":{"doors":1500,"windows":500}' in prompt
    assert '"boundaryVertexCount":200' in prompt
    assert "x" * 100 not in prompt and '"camera"' in prompt


def test_unknown_observations_cannot_claim_complete_visibility(context):
    payload = assessment()
    payload["observed"].update(sourceDoorCount=None, resultDoorCount=None)
    result = structure_review.assess_payload(payload, context)
    assert result["observed"]["sourceViewComplete"] is False
    assert result["observed"]["resultViewComplete"] is False


def test_current_capture_camera_fields_are_preserved_in_compact_prompt(context):
    context["camera"] = {
        "positionMm": [1000, 2000, 1600],
        "targetMm": [3000, 4000, 1600],
        "fovDeg": 62,
        "aspectRatio": 1.7777777777777,
    }
    prompt = structure_review.review_prompt(context)
    assert '"fovDeg":62' in prompt and '"aspectRatio":1.778' in prompt


def test_oversized_unnormalized_images_are_not_sent_to_the_vision_service(
    context, fake_vision
):
    _, calls, image = fake_vision
    raw = io.BytesIO()
    Image.new("RGB", (2049, 100), "white").save(raw, "PNG")
    result = structure_review.review_structure(
        context, [raw.getvalue()], image, enabled=True
    )
    assert (
        result["status"] == "failed"
        and result["reason"] == "invalid_input"
        and not calls
    )
