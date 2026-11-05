from pathlib import Path
import re
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", extra="ignore", case_sensitive=False
    )
    app_env: str = "development"
    database_url: str = f"sqlite:///{(ROOT / 'data/jianspace.db').as_posix()}"
    storage_root: Path = ROOT / "data/assets"
    app_origins: str = (
        "http://127.0.0.1:5180,http://localhost:5180,http://127.0.0.1:8000"
    )
    cookie_secure: bool = False
    task_backend: str = "database"
    redis_url: str = "redis://localhost:6379/0"
    storage_backend: str = "local"
    s3_endpoint_url: str = ""
    s3_bucket: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    dashscope_api_key: str = ""
    dashscope_image_model: str = "qwen-image-2.0-pro"
    dashscope_image_fallback_models: str = ""
    dashscope_vision_model: str = "qwen3-vl-plus"
    dashscope_text_model: str = ""
    support_email: str = ""
    weather_enabled: bool = True
    weather_default_city: str = ""
    weather_api_base: str = "https://api.open-meteo.com"
    weather_geocoding_base: str = "https://geocoding-api.open-meteo.com"
    weather_timeout_seconds: float = 8
    ai_structure_review_enabled: bool = False
    dashscope_api_base: str = "https://dashscope.aliyuncs.com"
    allow_ai_calls: bool = False
    ai_image_credits: int = 10
    ai_inpaint_credits: int = 8
    ai_plan_credits: int = 5
    ai_daily_limit: int = 30
    registration_credits: int = Field(default=6, ge=0, le=1000)
    family_trial_credits: int = Field(default=30, ge=0, le=1000)
    family_trial_days: int = Field(default=14, ge=1, le=90)
    allow_self_register: bool = True
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    public_url: str = "http://127.0.0.1:5180"
    local_recognition_backend: str = "dashscope"
    local_inference_device: str = "cuda"
    yolov8_weights: str = "yolov8n-floorplan.pt"
    controlnet_model: str = "diffusers/controlnet-canny-sdxl-1.0"
    controlnet_base_model: str = "stabilityai/stable-diffusion-xl-base-1.0"
    controlnet_steps: int = Field(default=28, ge=8, le=60)
    controlnet_seed: int = 20260101

    @property
    def production(self):
        return self.app_env == "production"

    @property
    def ai_ready(self):
        return self.allow_ai_calls and bool(self.dashscope_api_key)

    @property
    def image_model_chain(self):
        """Ordered, distinct models using this adapter's multi-image edit contract."""
        models = list(
            dict.fromkeys(
                m.strip()
                for m in [
                    self.dashscope_image_model,
                    *self.dashscope_image_fallback_models.split(","),
                ]
                if m.strip()
            )
        )
        if not self.dashscope_image_model.strip() or not 1 <= len(models) <= 3:
            raise ValueError("必须配置一个主模型，主模型与备用模型合计最多三个。")
        if any(
            not re.fullmatch(r"qwen-image-2\.0(?:-pro)?(?:-\d{4}-\d{2}-\d{2})?", m)
            for m in models
        ):
            raise ValueError(
                "当前图像编辑适配器支持 qwen-image-2.0、qwen-image-2.0-pro 及其日期快照。"
            )
        return models


settings = Settings()
