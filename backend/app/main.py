import io
import json
import os

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .llm import stream_chat, summarize_messages, web_search
from .prompt import PRESET_TOPICS, ROLES

app = FastAPI(title="智驾辅助 Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(os.path.dirname(BACKEND_DIR), "frontend")

MAX_UPLOAD = settings.max_upload_mb * 1024 * 1024
MAX_IMAGE = 10 * 1024 * 1024  # 单张图片 base64 上限


class ChatMessage(BaseModel):
    role: str
    content: str


class ImageAttachment(BaseModel):
    name: str = "image"
    mime: str = "image/png"
    b64: str = ""


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    role: str = "general"
    system_prompt: str | None = None
    kb_context: str | None = None
    search_context: str | None = None
    summary_context: str | None = None
    images: list[ImageAttachment] = []
    temperature: float = 0.7
    max_tokens: int | None = None
    top_p: float | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    stream_reasoning: bool = False


class SettingsResponse(BaseModel):
    base_url: str
    model: str
    has_api_key: bool
    preset_topics: list[str]
    roles: dict[str, dict]


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/settings")
async def get_settings() -> SettingsResponse:
    return SettingsResponse(
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        has_api_key=bool(settings.llm_api_key),
        preset_topics=PRESET_TOPICS,
        roles={k: {"name": v["name"], "icon": v["icon"]} for k, v in ROLES.items()},
    )


@app.get("/api/kb")
async def get_builtin_kb() -> dict:
    from .kb import list_builtin_kb

    return {"items": list_builtin_kb()}


@app.get("/api/prompt")
async def get_prompt(role: str = "general") -> dict:
    from .prompt import build_system_prompt

    return {"prompt": build_system_prompt(role, None)}


@app.post("/api/extract")
async def extract(file: UploadFile):
    """抽取上传文件的纯文本（txt/md/csv/json/pdf/docx/xlsx）。"""
    filename = file.filename or "file"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="文件超过 20MB 限制")

    text = ""
    try:
        if ext in ("txt", "md", "markdown", "csv", "log", "json", "yaml", "yml", "xml", "py", "c", "cpp", "h", "hpp"):
            text = data.decode("utf-8", errors="replace")
        elif ext == "pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
        elif ext == "docx":
            from docx import Document

            doc = Document(io.BytesIO(data))
            parts = [p.text for p in doc.paragraphs]
            for table in doc.tables:
                for row in table.rows:
                    parts.append(" | ".join(c.text for c in row.cells))
            text = "\n".join(parts)
        elif ext == "xlsx":
            from openpyxl import load_workbook

            wb = load_workbook(io.BytesIO(data), read_only=True)
            rows = []
            for ws in wb.worksheets:
                rows.append(f"# Sheet: {ws.title}")
                for row in ws.iter_rows(values_only=True):
                    rows.append(" | ".join("" if v is None else str(v) for v in row))
            text = "\n".join(rows)
        else:
            raise HTTPException(status_code=415, detail=f"不支持的文件类型 .{ext}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析失败：{e}")

    if not text.strip():
        raise HTTPException(status_code=400, detail="未能从文件中提取到文本（可能是扫描件/图片型 PDF）")

    return {"filename": filename, "ext": ext, "text": text[:300000], "chars": len(text)}


@app.get("/api/search")
async def search(q: str, max_results: int = 5) -> dict:
    if not q.strip():
        raise HTTPException(status_code=400, detail="q 不能为空")
    try:
        results = await web_search(q, max_results)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"搜索失败：{e}")
    if not results:
        return {"query": q, "results": [], "note": "未获取到结果，可能是网络受限"}
    return {"query": q, "results": results}


@app.post("/api/summarize")
async def summarize(req: ChatRequest):
    messages = [m.model_dump() for m in req.messages]
    if not messages:
        raise HTTPException(status_code=400, detail="messages 不能为空")
    if not (req.api_key or settings.llm_api_key):
        raise HTTPException(status_code=400, detail="LLM API Key 未配置")
    try:
        summary = await summarize_messages(
            messages,
            base_url=req.base_url,
            api_key=req.api_key,
            model=req.model,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"摘要失败：{e}")
    return {"summary": summary}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    messages = [m.model_dump() for m in req.messages]
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="last message must be from user")

    if not (req.api_key or settings.llm_api_key):
        raise HTTPException(status_code=400, detail="LLM API Key 未配置")

    # 多模态：把图片附加到最后一条用户消息
    for img in req.images:
        if len(img.b64) > MAX_IMAGE:
            raise HTTPException(status_code=413, detail=f"图片「{img.name}」过大，超过 10MB 限制")
    if req.images:
        parts = [{"type": "text", "text": messages[-1]["content"]}]
        for img in req.images:
            parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:{img.mime};base64,{img.b64}"},
            })
        messages[-1] = {"role": "user", "content": parts}

    # 合并上下文：知识库 + 联网搜索 + 历史摘要
    extra = []
    if req.search_context:
        extra.append(req.search_context)
    if req.summary_context:
        extra.append(req.summary_context)
    extra_ctx = "\n\n".join(extra)

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
                summary_context=extra_ctx or None,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
                top_p=req.top_p,
                frequency_penalty=req.frequency_penalty,
                presence_penalty=req.presence_penalty,
                stream_reasoning=req.stream_reasoning,
            ):
                yield f"data: {json.dumps(piece, ensure_ascii=False)}\n\n"
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
