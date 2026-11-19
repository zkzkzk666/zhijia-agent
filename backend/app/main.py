import json
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .llm import stream_chat
from .prompt import PRESET_TOPICS, ROLES

app = FastAPI(title="智驾辅助 Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(os.path.dirname(BACKEND_DIR), "frontend")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    role: str = "general"
    system_prompt: str | None = None
    kb_context: str | None = None
    temperature: float = 0.7
    max_tokens: int | None = None


class SettingsResponse(BaseModel):
    base_url: str
    model: str
    has_api_key: bool
    preset_topics: list[str]
    roles: dict[str, dict]


@app.get("/api/settings")
async def get_settings() -> SettingsResponse:
    return SettingsResponse(
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        has_api_key=bool(settings.llm_api_key),
        preset_topics=PRESET_TOPICS,
        roles={k: {"name": v["name"], "icon": v["icon"]} for k, v in ROLES.items()},
    )


@app.get("/api/prompt")
async def get_prompt(role: str = "general") -> dict:
    from .prompt import build_system_prompt

    return {"prompt": build_system_prompt(role, None)}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    messages = [m.model_dump() for m in req.messages]
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="last message must be from user")

    if not (req.api_key or settings.llm_api_key):
        raise HTTPException(status_code=400, detail="LLM API Key 未配置")

    async def event_stream():
        try:
            async for piece in stream_chat(
                messages,
                base_url=req.base_url,
                api_key=req.api_key,
                model=req.model,
                role=req.role,
                system_prompt=req.system_prompt,
                kb_context=req.kb_context,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            ):
                yield f"data: {json.dumps({'delta': piece}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


app.mount(
    "/static",
    StaticFiles(directory=FRONTEND_DIR),
    name="static",
)
