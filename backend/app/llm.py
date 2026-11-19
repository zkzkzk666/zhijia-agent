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
    top_p: float | None = None,
    frequency_penalty: float | None = None,
    presence_penalty: float | None = None,
    stream_reasoning: bool = False,
) -> AsyncIterator[dict]:
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
    if top_p is not None:
        kwargs["top_p"] = top_p
    if frequency_penalty is not None:
        kwargs["frequency_penalty"] = frequency_penalty
    if presence_penalty is not None:
        kwargs["presence_penalty"] = presence_penalty

    stream = await client.chat.completions.create(**kwargs)
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if stream_reasoning and getattr(delta, "reasoning_content", None):
            yield {"reasoning": delta.reasoning_content}
        if delta.content:
            yield {"delta": delta.content}
