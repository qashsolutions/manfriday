"""LoRA fine-tune pipeline — triggers when a user crosses 500+ wiki articles.

Reads all wiki articles, converts them to instruction-following pairs,
submits to OpenAI fine-tuning API (or Anthropic when available),
and tracks job lifecycle in GCS.

Usage:
    python -m workers.finetune.main --user-id test-user --provider openai
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from shared.python.manfriday_core.gcs import (
    exists,
    list_markdown_files,
    read_json,
    read_text,
    user_path,
    write_json,
    write_text,
)

logger = logging.getLogger(__name__)

FINETUNE_TRIGGER_THRESHOLD = 500

SYSTEM_PROMPT = (
    "You are ManFriday, a personal wiki assistant. "
    "Answer questions about the user's knowledge base accurately and concisely, "
    "citing relevant wiki pages using [[wikilink]] syntax."
)


# ── Trigger check ────────────────────────────────────────────


async def check_finetune_trigger(user_id: str) -> bool:
    """Check if user has crossed the 500-article threshold for fine-tuning.

    Returns True if the user has 500+ articles AND has not already had a
    fine-tune job completed for the current article count bracket.
    """
    articles_prefix = user_path(user_id, "wiki", "articles")
    article_files = list_markdown_files(articles_prefix)
    article_count = len(article_files)

    logger.info("User %s has %d articles (threshold: %d)", user_id, article_count, FINETUNE_TRIGGER_THRESHOLD)

    if article_count < FINETUNE_TRIGGER_THRESHOLD:
        return False

    # Check if we already fine-tuned at this count bracket (every 100 articles)
    bracket = (article_count // 100) * 100
    jobs_path = user_path(user_id, "finetune", "jobs.json")

    if exists(jobs_path):
        jobs = read_json(jobs_path)
        for job in jobs:
            if job.get("article_bracket") == bracket and job.get("status") == "succeeded":
                logger.info("Already fine-tuned at bracket %d, skipping", bracket)
                return False

    return True


# ── Training data preparation ────────────────────────────────


def _extract_title_from_frontmatter(content: str) -> str | None:
    """Extract the title field from YAML frontmatter."""
    match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return None
    for line in match.group(1).splitlines():
        if line.strip().startswith("title:"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return None


def _extract_body(content: str) -> str:
    """Strip YAML frontmatter and return the body text."""
    match = re.match(r"^---\s*\n.*?\n---\s*\n?", content, re.DOTALL)
    if match:
        return content[match.end():].strip()
    return content.strip()


def _extract_tags(content: str) -> list[str]:
    """Extract tags from YAML frontmatter."""
    match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return []
    for line in match.group(1).splitlines():
        if line.strip().startswith("tags:"):
            tag_str = line.split(":", 1)[1].strip()
            # Handle [tag1, tag2] format
            tag_str = tag_str.strip("[]")
            return [t.strip().strip('"').strip("'") for t in tag_str.split(",") if t.strip()]
    return []


def _article_to_training_example(title: str, body: str, tags: list[str]) -> dict[str, Any]:
    """Convert a wiki article into an instruction-following training example."""
    # Build a natural question from the title
    question = f"What do you know about {title}?"

    # If tags exist, add context
    if tags:
        tag_context = ", ".join(tags)
        question = f"What do you know about {title}? (Related topics: {tag_context})"

    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question},
            {"role": "assistant", "content": body},
        ]
    }


async def prepare_training_data(user_id: str) -> str:
    """Read all wiki articles and format as instruction-following pairs.

    Returns the GCS path of the uploaded training data JSONL file.
    """
    training_examples: list[dict[str, Any]] = []

    # Collect articles from all wiki subdirectories
    for subdir in ["articles", "entities", "concepts"]:
        prefix = user_path(user_id, "wiki", subdir)
        md_files = list_markdown_files(prefix)

        for file_path in md_files:
            try:
                content = read_text(file_path)
            except Exception:
                logger.warning("Failed to read %s, skipping", file_path)
                continue

            title = _extract_title_from_frontmatter(content)
            if not title:
                # Derive title from filename
                filename = file_path.rsplit("/", 1)[-1]
                title = filename.replace(".md", "").replace("-", " ").replace("_", " ").title()

            body = _extract_body(content)
            if len(body) < 50:
                logger.debug("Skipping %s — body too short (%d chars)", file_path, len(body))
                continue

            tags = _extract_tags(content)
            example = _article_to_training_example(title, body, tags)
            training_examples.append(example)

    logger.info("Prepared %d training examples for user %s", len(training_examples), user_id)

    if not training_examples:
        raise ValueError(f"No valid training examples found for user {user_id}")

    # Write JSONL to GCS
    jsonl_content = "\n".join(json.dumps(ex, ensure_ascii=False) for ex in training_examples)
    output_path = user_path(user_id, "finetune", "training_data.jsonl")
    write_text(output_path, jsonl_content, content_type="application/jsonl")

    logger.info("Training data written to %s (%d examples)", output_path, len(training_examples))
    return output_path


# ── Job submission ───────────────────────────────────────────


async def submit_finetune_job(
    user_id: str,
    provider: str,
    training_file_path: str,
) -> str:
    """Submit a fine-tuning job to the specified provider.

    Returns the job ID from the provider.
    """
    if provider not in ("openai", "anthropic"):
        raise ValueError(f"Unsupported fine-tune provider: {provider}. Must be 'openai' or 'anthropic'.")

    # Read training data from GCS
    training_data = read_text(training_file_path)

    if provider == "openai":
        job_id = await _submit_openai(user_id, training_data)
    elif provider == "anthropic":
        # Anthropic fine-tuning API not yet publicly available
        raise NotImplementedError(
            "Anthropic fine-tuning is not yet available. "
            "Use provider='openai' for now."
        )

    # Record job metadata
    articles_prefix = user_path(user_id, "wiki", "articles")
    article_count = len(list_markdown_files(articles_prefix))
    bracket = (article_count // 100) * 100

    job_record = {
        "job_id": job_id,
        "provider": provider,
        "user_id": user_id,
        "status": "pending",
        "article_bracket": bracket,
        "article_count": article_count,
        "training_file": training_file_path,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    jobs_path = user_path(user_id, "finetune", "jobs.json")
    jobs: list[dict[str, Any]] = []
    if exists(jobs_path):
        jobs = read_json(jobs_path)
    jobs.append(job_record)
    write_json(jobs_path, jobs)

    logger.info("Fine-tune job %s submitted for user %s via %s", job_id, user_id, provider)
    return job_id


async def _submit_openai(user_id: str, training_data: str) -> str:
    """Submit training data to OpenAI fine-tuning API."""
    import openai

    from shared.python.manfriday_core.secrets import get_byok_key

    api_key = get_byok_key("openai", user_id)
    client = openai.AsyncOpenAI(api_key=api_key)

    # Upload training file
    training_bytes = training_data.encode("utf-8")
    file_response = await client.files.create(
        file=("training_data.jsonl", training_bytes),
        purpose="fine-tune",
    )

    # Create fine-tuning job
    job = await client.fine_tuning.jobs.create(
        training_file=file_response.id,
        model="gpt-4o-mini-2024-07-18",
        hyperparameters={
            "n_epochs": 3,
            "learning_rate_multiplier": 1.8,
            "batch_size": "auto",
        },
        suffix=f"manfriday-{user_id[:8]}",
    )

    return job.id


# ── Job status polling ───────────────────────────────────────


async def check_job_status(user_id: str, job_id: str) -> dict[str, Any]:
    """Poll the provider for fine-tune job status and update local records.

    Returns the updated job record with fields:
        status: pending | running | succeeded | failed | cancelled
        fine_tuned_model: model ID (only when succeeded)
        error: error message (only when failed)
    """
    jobs_path = user_path(user_id, "finetune", "jobs.json")
    if not exists(jobs_path):
        raise ValueError(f"No fine-tune jobs found for user {user_id}")

    jobs = read_json(jobs_path)
    job_record = None
    job_index = -1
    for i, j in enumerate(jobs):
        if j["job_id"] == job_id:
            job_record = j
            job_index = i
            break

    if job_record is None:
        raise ValueError(f"Job {job_id} not found for user {user_id}")

    provider = job_record["provider"]

    if provider == "openai":
        status_info = await _check_openai_status(user_id, job_id)
    else:
        raise NotImplementedError(f"Status check not implemented for provider: {provider}")

    # Update job record
    job_record["status"] = status_info["status"]
    job_record["updated_at"] = datetime.now(timezone.utc).isoformat()

    if status_info.get("fine_tuned_model"):
        job_record["fine_tuned_model"] = status_info["fine_tuned_model"]
    if status_info.get("error"):
        job_record["error"] = status_info["error"]
    if status_info.get("trained_tokens"):
        job_record["trained_tokens"] = status_info["trained_tokens"]

    # Write back
    jobs[job_index] = job_record
    write_json(jobs_path, jobs)

    # If succeeded, register the model
    if status_info["status"] == "succeeded" and status_info.get("fine_tuned_model"):
        from workers.finetune.model_registry import register_model

        await register_model(
            user_id=user_id,
            provider=provider,
            model_id=status_info["fine_tuned_model"],
            base_model="gpt-4o-mini-2024-07-18",
            metrics={
                "trained_tokens": status_info.get("trained_tokens", 0),
                "article_count": job_record.get("article_count", 0),
            },
        )

    logger.info("Job %s status: %s", job_id, status_info["status"])
    return job_record


async def _check_openai_status(user_id: str, job_id: str) -> dict[str, Any]:
    """Check OpenAI fine-tuning job status."""
    import openai

    from shared.python.manfriday_core.secrets import get_byok_key

    api_key = get_byok_key("openai", user_id)
    client = openai.AsyncOpenAI(api_key=api_key)

    job = await client.fine_tuning.jobs.retrieve(job_id)

    # Map OpenAI status to our status
    status_map = {
        "validating_files": "pending",
        "queued": "pending",
        "running": "running",
        "succeeded": "succeeded",
        "failed": "failed",
        "cancelled": "cancelled",
    }

    result: dict[str, Any] = {
        "status": status_map.get(job.status, job.status),
    }

    if job.fine_tuned_model:
        result["fine_tuned_model"] = job.fine_tuned_model
    if job.error and job.error.message:
        result["error"] = job.error.message
    if job.trained_tokens:
        result["trained_tokens"] = job.trained_tokens

    return result


# ── Full pipeline orchestrator ───────────────────────────────


async def run_pipeline(user_id: str, provider: str = "openai") -> dict[str, Any]:
    """Run the complete fine-tune pipeline: check trigger → prepare data → submit job.

    Returns a summary dict with the outcome.
    """
    # Step 1: Check trigger
    should_finetune = await check_finetune_trigger(user_id)
    if not should_finetune:
        return {"triggered": False, "reason": "Below threshold or already fine-tuned at this bracket"}

    # Step 2: Prepare training data
    training_path = await prepare_training_data(user_id)

    # Step 3: Submit job
    job_id = await submit_finetune_job(user_id, provider, training_path)

    return {
        "triggered": True,
        "job_id": job_id,
        "provider": provider,
        "training_file": training_path,
    }


# ── CLI entrypoint ───────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="ManFriday LoRA fine-tune pipeline")
    parser.add_argument("--user-id", required=True, help="User ID to fine-tune for")
    parser.add_argument("--provider", default="openai", choices=["openai", "anthropic"])
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only check trigger, don't submit job",
    )
    parser.add_argument(
        "--status",
        metavar="JOB_ID",
        help="Check status of an existing fine-tune job",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if args.status:
        result = asyncio.run(check_job_status(args.user_id, args.status))
        print(json.dumps(result, indent=2))
    elif args.check_only:
        triggered = asyncio.run(check_finetune_trigger(args.user_id))
        print(f"Fine-tune trigger: {'YES' if triggered else 'NO'}")
    else:
        result = asyncio.run(run_pipeline(args.user_id, args.provider))
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
