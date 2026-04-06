"""Unified LLM client — ALL provider-specific code lives here and nowhere else.

Supports Anthropic, OpenAI, and Gemini via user BYOK keys.
Every LLM call in ManFriday routes through `call()` or `stream()`.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from shared.python.manfriday_core.secrets import get_byok_key

# ── Provider config ────────────────────────────────────────

PROVIDERS: dict[str, dict[str, str]] = {
    "anthropic": {"sdk": "anthropic", "default_model": "claude-sonnet-4-20250514"},
    "openai": {"sdk": "openai", "default_model": "gpt-4o"},
    "gemini": {"sdk": "google.generativeai", "default_model": "gemini-1.5-pro"},
}

VALID_PROVIDERS = set(PROVIDERS.keys())


# ── Data types ─────────────────────────────────────────────


@dataclass
class LLMResponse:
    content: str
    model: str
    provider: str
    usage: dict[str, int] = field(default_factory=dict)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class LLMConfig:
    provider: str
    model: str | None = None
    temperature: float = 0.7
    max_tokens: int = 4096
    system_prompt: str | None = None
    tools: list[dict[str, Any]] | None = None

    @property
    def resolved_model(self) -> str:
        return self.model or PROVIDERS[self.provider]["default_model"]


# ── Core call ──────────────────────────────────────────────


async def call(
    messages: list[dict[str, str]],
    config: LLMConfig,
    user_id: str,
) -> LLMResponse:
    """Single LLM call. Routes to correct provider SDK."""
    api_key = get_byok_key(config.provider, user_id)

    if config.provider == "anthropic":
        return await _call_anthropic(messages, config, api_key)
    elif config.provider == "openai":
        return await _call_openai(messages, config, api_key)
    elif config.provider == "gemini":
        return await _call_gemini(messages, config, api_key)
    else:
        raise ValueError(f"Unknown provider: {config.provider}")


async def stream(
    messages: list[dict[str, str]],
    config: LLMConfig,
    user_id: str,
) -> AsyncIterator[str]:
    """Streaming LLM call. Yields text chunks."""
    api_key = get_byok_key(config.provider, user_id)

    if config.provider == "anthropic":
        async for chunk in _stream_anthropic(messages, config, api_key):
            yield chunk
    elif config.provider == "openai":
        async for chunk in _stream_openai(messages, config, api_key):
            yield chunk
    elif config.provider == "gemini":
        async for chunk in _stream_gemini(messages, config, api_key):
            yield chunk
    else:
        raise ValueError(f"Unknown provider: {config.provider}")


# ── Anthropic ──────────────────────────────────────────────


async def _call_anthropic(
    messages: list[dict[str, str]], config: LLMConfig, api_key: str
) -> LLMResponse:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=api_key)
    kwargs: dict[str, Any] = {
        "model": config.resolved_model,
        "max_tokens": config.max_tokens,
        "messages": messages,
        "temperature": config.temperature,
    }
    if config.system_prompt:
        kwargs["system"] = config.system_prompt
    if config.tools:
        kwargs["tools"] = config.tools

    response = await client.messages.create(**kwargs)

    content = ""
    tool_calls = []
    for block in response.content:
        if block.type == "text":
            content += block.text
        elif block.type == "tool_use":
            tool_calls.append({"id": block.id, "name": block.name, "input": block.input})

    return LLMResponse(
        content=content,
        model=config.resolved_model,
        provider="anthropic",
        usage={"input": response.usage.input_tokens, "output": response.usage.output_tokens},
        tool_calls=tool_calls,
    )


async def _stream_anthropic(
    messages: list[dict[str, str]], config: LLMConfig, api_key: str
) -> AsyncIterator[str]:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=api_key)
    kwargs: dict[str, Any] = {
        "model": config.resolved_model,
        "max_tokens": config.max_tokens,
        "messages": messages,
        "temperature": config.temperature,
    }
    if config.system_prompt:
        kwargs["system"] = config.system_prompt

    async with client.messages.stream(**kwargs) as stream:
        async for text in stream.text_stream:
            yield text


# ── OpenAI ─────────────────────────────────────────────────


async def _call_openai(
    messages: list[dict[str, str]], config: LLMConfig, api_key: str
) -> LLMResponse:
    import openai

    client = openai.AsyncOpenAI(api_key=api_key)

    oai_messages = []
    if config.system_prompt:
        oai_messages.append({"role": "system", "content": config.system_prompt})
    oai_messages.extend(messages)

    kwargs: dict[str, Any] = {
        "model": config.resolved_model,
        "max_tokens": config.max_tokens,
        "messages": oai_messages,
        "temperature": config.temperature,
    }
    if config.tools:
        kwargs["tools"] = [
            {"type": "function", "function": t} for t in config.tools
        ]

    response = await client.chat.completions.create(**kwargs)
    choice = response.choices[0]

    tool_calls = []
    if choice.message.tool_calls:
        for tc in choice.message.tool_calls:
            tool_calls.append({
                "id": tc.id,
                "name": tc.function.name,
                "input": tc.function.arguments,
            })

    return LLMResponse(
        content=choice.message.content or "",
        model=config.resolved_model,
        provider="openai",
        usage={
            "input": response.usage.prompt_tokens if response.usage else 0,
            "output": response.usage.completion_tokens if response.usage else 0,
        },
        tool_calls=tool_calls,
    )


async def _stream_openai(
    messages: list[dict[str, str]], config: LLMConfig, api_key: str
) -> AsyncIterator[str]:
    import openai

    client = openai.AsyncOpenAI(api_key=api_key)

    oai_messages = []
    if config.system_prompt:
        oai_messages.append({"role": "system", "content": config.system_prompt})
    oai_messages.extend(messages)

    stream = await client.chat.completions.create(
        model=config.resolved_model,
        max_tokens=config.max_tokens,
        messages=oai_messages,
        temperature=config.temperature,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


# ── Gemini ─────────────────────────────────────────────────


async def _call_gemini(
    messages: list[dict[str, str]], config: LLMConfig, api_key: str
) -> LLMResponse:
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=config.resolved_model,
        system_instruction=config.system_prompt,
    )

    # Convert messages to Gemini format
    gemini_history = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        gemini_history.append({"role": role, "parts": [msg["content"]]})

    response = await model.generate_content_async(
        gemini_history,
        generation_config=genai.types.GenerationConfig(
            temperature=config.temperature,
            max_output_tokens=config.max_tokens,
        ),
    )

    return LLMResponse(
        content=response.text,
        model=config.resolved_model,
        provider="gemini",
        usage={
            "input": getattr(response.usage_metadata, "prompt_token_count", 0),
            "output": getattr(response.usage_metadata, "candidates_token_count", 0),
        },
    )


async def _stream_gemini(
    messages: list[dict[str, str]], config: LLMConfig, api_key: str
) -> AsyncIterator[str]:
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=config.resolved_model,
        system_instruction=config.system_prompt,
    )

    gemini_history = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        gemini_history.append({"role": role, "parts": [msg["content"]]})

    response = await model.generate_content_async(
        gemini_history,
        generation_config=genai.types.GenerationConfig(
            temperature=config.temperature,
            max_output_tokens=config.max_tokens,
        ),
        stream=True,
    )
    async for chunk in response:
        if chunk.text:
            yield chunk.text


# ── Key validation ─────────────────────────────────────────


async def validate_key(provider: str, api_key: str) -> bool:
    """Validate a BYOK API key by making a minimal call."""
    if provider not in VALID_PROVIDERS:
        raise ValueError(f"Unknown provider: {provider}. Must be one of {VALID_PROVIDERS}")

    try:
        if provider == "anthropic":
            import anthropic

            client = anthropic.AsyncAnthropic(api_key=api_key)
            await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1,
                messages=[{"role": "user", "content": "hi"}],
            )
        elif provider == "openai":
            import openai

            client = openai.AsyncOpenAI(api_key=api_key)
            await client.chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=1,
                messages=[{"role": "user", "content": "hi"}],
            )
        elif provider == "gemini":
            import google.generativeai as genai

            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            await model.generate_content_async("hi")
        return True
    except Exception:
        return False


# ── CLI entrypoint for `make validate-key` ─────────────────


def _cli_validate():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["validate"])
    parser.add_argument("--provider", required=True)
    parser.add_argument("--key", required=True)
    args = parser.parse_args()

    import asyncio

    valid = asyncio.run(validate_key(args.provider, args.key))
    if valid:
        print(f"[ok] {args.provider} key is valid")
    else:
        print(f"[fail] {args.provider} key is invalid")
        sys.exit(1)


if __name__ == "__main__":
    _cli_validate()
