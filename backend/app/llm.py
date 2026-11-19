from typing import AsyncIterator

from openai import AsyncOpenAI

from .config import settings
from .prompt import build_system_prompt


async def stream_chat(
    messages: list[dict],
    base_url: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
    role: str = "general",
    system_prompt: str | None = None,
    kb_context: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> AsyncIterator[str]:
    client = AsyncOpenAI(
        base_url=base_url or settings.llm_base_url,
        api_key=api_key or settings.llm_api_key,
    )
    system = build_system_prompt(role, system_prompt)
    if kb_context:
        system += "\n\n" + kb_context
    payload = [
        {"role": "system", "content": system}
    ] + messages

    kwargs = dict(
        model=model or settings.llm_model,
        messages=payload,
        stream=True,
        temperature=temperature,
    )
    if max_tokens:
        kwargs["max_tokens"] = max_tokens

    stream = await client.chat.completions.create(**kwargs)
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
