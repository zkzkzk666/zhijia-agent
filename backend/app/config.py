import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "gpt-4o-mini")
    port: int = int(os.getenv("PORT", "8000"))


settings = Settings()
