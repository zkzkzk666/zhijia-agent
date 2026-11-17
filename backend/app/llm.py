import json
import re
from typing import AsyncIterator

from openai import AsyncOpenAI

from .config import settings
from .prompt import SYSTEM_PROMPT


async def stream_chat(
    messages: list[dict],
    base_url: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
) -> AsyncIterator[str]:
    client = AsyncOpenAI(
        base_url=base_url or settings.llm_base_url,
        api_key=api_key or settings.llm_api_key,
    )
    payload = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

    stream = await client.chat.completions.create(
        model=model or settings.llm_model,
        messages=payload,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def extract_json(text: str) -> dict | None:
    """从 LLM 回复中提取首个 JSON 对象（用于结构化能力扩展）。"""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
