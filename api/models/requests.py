"""Request/response models for the API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class IngestRequest(BaseModel):
    url: str = Field(..., description="URL to ingest")
    source_type: str | None = Field(None, description="Override source type detection")


class QARequest(BaseModel):
    question: str = Field(..., description="User question")
    output_type: str = Field("md", description="Output format: md | marp | chart | table")


class FileBackRequest(BaseModel):
    output_path: str = Field(..., description="Path to output to file back")
    tags: list[str] = Field(default_factory=list)


class ValidateKeyRequest(BaseModel):
    provider: str = Field(..., description="anthropic | openai | gemini")
    api_key: str = Field(..., description="API key to validate")


class AddSourceRequest(BaseModel):
    url: str
    source_type: str | None = None
    title: str | None = None


class SchemaUpdateRequest(BaseModel):
    content: str = Field(..., description="Full CLAUDE.md content")


class RestoreSuppressedRequest(BaseModel):
    pass  # No body needed, slug from path
