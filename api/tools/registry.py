"""Tool registry — Q&A agent tools and BM25 search.

Tools registered here are available in the Q&A agent's tool-use loop.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from typing import Any, AsyncIterator

from shared.python.manfriday_core.gcs import read_text, write_text, exists, list_markdown_files, user_path
from shared.python.manfriday_core.llm import LLMConfig, call, stream as llm_stream
from workers.compile.log_writer import append_query_log


# ── Spec-named tool wrappers (skills_and_agents.md) ───────


def read_raw(slug: str, user_id: str) -> str:
    """Read a raw/ source file by slug."""
    return read_text(user_path(user_id, "raw", f"{slug}.md"))


def read_wiki(path: str, user_id: str) -> str:
    """Read any wiki/ page by path."""
    full = path if path.startswith(user_id) else user_path(user_id, path)
    return read_text(full)


def write_wiki(path: str, content: str, user_id: str) -> None:
    """Write/update a wiki/ page (guarded — blocks raw/ writes)."""
    from workers.compile.write_guard import guarded_write_text
    full = path if path.startswith(user_id) else user_path(user_id, path)
    guarded_write_text(user_id, full, content)


# ── BM25 Search ───────────────────────────────────────────


def _tokenize(text: str) -> list[str]:
    """Simple whitespace + lowercase tokenizer."""
    return re.findall(r"\w+", text.lower())


async def search_wiki(query: str, user_id: str, top_n: int = 5) -> list[dict[str, Any]]:
    """BM25 search over all wiki pages.

    Returns list of {path, title, summary, score}.
    """
    wiki_prefix = user_path(user_id, "wiki")
    all_files = list_markdown_files(wiki_prefix + "/")

    # Skip structural files
    skip = {"index.md", "log.md", "backlinks.md", "lint_queue.md"}
    files = [f for f in all_files if f.split("/")[-1] not in skip]

    if not files:
        return []

    # Build corpus
    docs: list[dict[str, Any]] = []
    for path in files:
        try:
            content = read_text(path)
            title = path.split("/")[-1].replace(".md", "")
            # Extract first heading as title
            for line in content.split("\n"):
                if line.startswith("# "):
                    title = line[2:].strip()
                    break
            docs.append({"path": path, "title": title, "content": content, "tokens": _tokenize(content)})
        except Exception:
            continue

    if not docs:
        return []

    # BM25 scoring
    query_tokens = _tokenize(query)
    k1, b = 1.5, 0.75
    avg_dl = sum(len(d["tokens"]) for d in docs) / len(docs)

    # Document frequency
    df: Counter = Counter()
    for doc in docs:
        unique_tokens = set(doc["tokens"])
        for t in unique_tokens:
            df[t] += 1

    n_docs = len(docs)
    scores = []
    for doc in docs:
        score = 0.0
        tf_counter = Counter(doc["tokens"])
        dl = len(doc["tokens"])

        for qt in query_tokens:
            if qt not in df:
                continue
            idf = math.log((n_docs - df[qt] + 0.5) / (df[qt] + 0.5) + 1)
            tf = tf_counter.get(qt, 0)
            tf_norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avg_dl))
            score += idf * tf_norm

        if score > 0:
            # Extract summary — first 150 chars after frontmatter
            content = doc["content"]
            # Skip YAML frontmatter
            if content.startswith("---"):
                end = content.find("---", 3)
                if end > 0:
                    content = content[end + 3:]
            summary = content.strip()[:150].replace("\n", " ")

            scores.append({
                "path": doc["path"],
                "title": doc["title"],
                "summary": summary,
                "score": round(score, 3),
            })

    scores.sort(key=lambda x: x["score"], reverse=True)
    return scores[:top_n]


# ── Q&A Agent ─────────────────────────────────────────────


TOOL_DEFINITIONS = [
    {
        "name": "search_wiki",
        "description": "BM25 search over wiki pages. Returns top-N results with path, title, summary, score.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "n": {"type": "integer", "description": "Number of results", "default": 5},
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_article",
        "description": "Read the full content of a wiki page by path.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Wiki page path (e.g., wiki/articles/my-article.md)"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "file_output",
        "description": "File the current answer as a wiki page in outputs/.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Output title"},
                "content": {"type": "string", "description": "Output content in markdown"},
            },
            "required": ["title", "content"],
        },
    },
    {
        "name": "execute_python",
        "description": "Execute Python code in a sandboxed environment (matplotlib, pandas). Returns stdout and image paths.",
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python code to execute"},
            },
            "required": ["code"],
        },
    },
]


async def _execute_tool(tool_name: str, tool_input: dict, user_id: str) -> str:
    """Execute a tool call and return result as string."""
    if tool_name == "search_wiki":
        results = await search_wiki(tool_input["query"], user_id, tool_input.get("n", 5))
        return json.dumps(results, indent=2)

    elif tool_name == "read_article":
        path = tool_input["path"]
        full_path = path if path.startswith(user_id) else user_path(user_id, path)
        if exists(full_path):
            return read_text(full_path)
        return f"Page not found: {path}"

    elif tool_name == "file_output":
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        output_path = user_path(user_id, "wiki", "outputs", f"{ts}.md")
        from workers.compile.write_guard import guarded_write_text
        guarded_write_text(user_id, output_path, tool_input["content"])
        return f"Filed as {output_path}"

    elif tool_name == "execute_python":
        return await _execute_python(tool_input["code"], user_id)

    return f"Unknown tool: {tool_name}"


async def _execute_python(code: str, user_id: str) -> str:
    """Execute Python code in E2B sandbox. Returns stdout + image paths."""
    try:
        from e2b import Sandbox

        sandbox = Sandbox()
        execution = sandbox.run_code(code)

        result_parts = []
        if execution.logs.stdout:
            result_parts.append(f"stdout:\n{execution.logs.stdout}")
        if execution.logs.stderr:
            result_parts.append(f"stderr:\n{execution.logs.stderr}")

        # Check for matplotlib output
        if execution.results:
            for r in execution.results:
                if hasattr(r, "png") and r.png:
                    from datetime import datetime, timezone
                    from shared.python.manfriday_core.gcs import write_bytes
                    import base64

                    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                    img_path = user_path(user_id, "outputs", "images", f"{ts}.png")
                    write_bytes(img_path, base64.b64decode(r.png), "image/png")
                    result_parts.append(f"Image saved: {img_path}")

        sandbox.close()
        return "\n".join(result_parts) if result_parts else "(no output)"

    except ImportError:
        return "E2B sandbox not available. Install e2b package."
    except Exception as e:
        return f"Execution error: {e}"


async def run_qa_agent(
    question: str,
    user_id: str,
    output_type: str = "md",
    max_turns: int = 10,
) -> AsyncIterator[dict[str, Any]]:
    """Run Q&A agent with tool-use loop, yielding SSE events.

    Non-negotiable: reads CLAUDE.md + index.md + last 5 log.md entries first.
    """
    # Read context (non-negotiable #2)
    system_parts = []
    try:
        claude_md = read_text(user_path(user_id, "CLAUDE.md"))
        system_parts.append(f"CLAUDE.md (your constitution):\n{claude_md[:4000]}")
    except Exception:
        pass

    try:
        index_md = read_text(user_path(user_id, "wiki", "index.md"))
        system_parts.append(f"Wiki Index:\n{index_md[:3000]}")
    except Exception:
        pass

    try:
        log_md = read_text(user_path(user_id, "wiki", "log.md"))
        # Last 5 entries
        entries = log_md.split("\n## ")
        last_5 = "\n## ".join(entries[-5:]) if len(entries) > 5 else log_md
        system_parts.append(f"Recent log:\n{last_5[:2000]}")
    except Exception:
        pass

    system_prompt = "\n\n---\n\n".join(system_parts) if system_parts else "You are a helpful wiki assistant."
    system_prompt += f"\n\nOutput format requested: {output_type}"

    # Read preferences for provider/model
    provider = "anthropic"
    try:
        prefs = json.loads(read_text(user_path(user_id, "config", "preferences.json")))
        provider = prefs.get("llm_provider", "anthropic")
    except Exception:
        pass

    config = LLMConfig(
        provider=provider,
        temperature=0.7,
        max_tokens=4096,
        system_prompt=system_prompt,
        tools=TOOL_DEFINITIONS,
    )

    messages = [{"role": "user", "content": question}]

    for turn in range(max_turns):
        response = await call(messages, config, user_id)

        # Yield text content
        if response.content:
            yield {"type": "text", "data": response.content}

        # Handle tool calls
        if not response.tool_calls:
            break

        for tc in response.tool_calls:
            yield {"type": "tool_trace", "data": json.dumps({"tool": tc["name"], "input": tc["input"]})}

            result = await _execute_tool(tc["name"], tc["input"], user_id)
            yield {"type": "tool_result", "data": json.dumps({"tool": tc["name"], "result": result[:500]})}

            # Add to messages for next turn
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": f"Tool result ({tc['name']}): {result}"})

    # Log the query
    append_query_log(user_id, question)

    # Post-Q&A: record episode + recompute active threads (Agent 4 spec)
    try:
        from workers.lint.output_filing_worker import record_qa_session
        record_qa_session(
            user_id=user_id,
            query=question,
            topics_detected=[],  # extracted by LLM during session
            articles_read=[],
            output_type=output_type,
            output_path="",
            filed=False,
        )
    except Exception:
        pass

    try:
        from workers.compile.playbook_writer import update_active_threads
        update_active_threads(user_id)
    except Exception:
        pass

    yield {"type": "done", "data": ""}
