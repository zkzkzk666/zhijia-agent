import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "gpt-4o-mini")
    port: int = _get_int("PORT", 8000)
    host: str = os.getenv("HOST", "127.0.0.1")
    cors_origins: list = field(
        default_factory=lambda: [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
    )
    max_upload_mb: int = _get_int("MAX_UPLOAD_MB", 20)
    llm_timeout: int = _get_int("LLM_TIMEOUT", 300)


settings = Settings()
