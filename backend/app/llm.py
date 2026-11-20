from typing import AsyncIterator

import httpx
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
    summary_context: str | None = None,
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
    if summary_context:
        system += "\n\n" + summary_context
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


async def summarize_messages(
    messages: list[dict],
    base_url: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
    max_tokens: int = 500,
) -> str:
    """把较旧的历史消息压缩成一段摘要，用于长对话记忆管理。"""
    client = AsyncOpenAI(
        base_url=base_url or settings.llm_base_url,
        api_key=api_key or settings.llm_api_key,
    )
    text = "\n".join(f"[{m['role']}] {m['content'][:2000]}" for m in messages)
    resp = await client.chat.completions.create(
        model=model or settings.llm_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "你是对话记忆压缩助手。请把下面的对话历史压缩成一段简洁但保留关键信息的中文摘要"
                    "（关键事实、问题、结论、待办都要保留），只输出摘要本身，不要加前缀。"
                ),
            },
            {"role": "user", "content": text[:30000]},
        ],
        max_tokens=max_tokens,
        temperature=0.3,
    )
    return (resp.choices[0].message.content or "").strip()


async def web_search(query: str, max_results: int = 5) -> list[dict]:
    """基于 DuckDuckGo HTML 接口的轻量搜索，无需 API key。"""
    url = "https://html.duckduckgo.com/html/"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    results = []
    try:
        async with httpx.AsyncClient(timeout=20, headers=headers, follow_redirects=True) as client:
            resp = await client.post(url, data={"q": query})
            resp.raise_for_status()
            html = resp.text
    except Exception:
        return results

    # 解析 result__a / result__snippet 结构
    from html.parser import HTMLParser

    class LinkParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.in_link = False
            self.in_snippet = False
            self.cur = {"title": "", "url": "", "snippet": ""}
            self.items = []

        def handle_starttag(self, tag, attrs):
            a = dict(attrs)
            cls = a.get("class", "")
            if tag == "a" and "result__a" in cls:
                self.in_link = True
                self.cur["url"] = a.get("href", "")
            if tag == "a" and "result__snippet" in cls:
                self.in_snippet = True

        def handle_data(self, data):
            if self.in_link:
                self.cur["title"] += data
            if self.in_snippet:
                self.cur["snippet"] += data

        def handle_endtag(self, tag):
            if tag == "a" and self.in_link:
                self.in_link = False
                if self.cur["title"]:
                    self.items.append(self.cur)
                    self.cur = {"title": "", "url": "", "snippet": ""}
            if tag == "a" and self.in_snippet:
                self.in_snippet = False

    parser = LinkParser()
    parser.feed(html)
    for it in parser.items[:max_results]:
        title = " ".join(it["title"].split())
        snippet = " ".join(it["snippet"].split())
        url = it["url"]
        if url.startswith("//"):
            url = "https:" + url
        if title:
            results.append({"title": title, "url": url, "snippet": snippet})
    return results
