"""Ingest router — POST /ingest for URL/JSON and multipart/form-data for PDF."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from api.middleware.auth import get_current_user
from api.models.requests import IngestRequest
from workers.ingest.main import ingest as run_ingest
from shared.python.manfriday_core.gcs import write_bytes, user_path
import uuid

router = APIRouter()


@router.post("")
async def ingest_url(req: IngestRequest, user: dict = Depends(get_current_user)):
    """Ingest a URL source."""
    result = await run_ingest(
        url=req.url,
        user_id=user["user_id"],
        source_type=req.source_type,
    )
    return result


@router.post("/pdf")
async def ingest_pdf(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Upload and ingest a PDF file."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    contents = await file.read()
    if len(contents) > 50 * 1024 * 1024:  # 50MB limit
        raise HTTPException(status_code=400, detail="PDF exceeds 50MB limit")

    # Write to GCS
    pdf_uuid = str(uuid.uuid4())
    gcs_path = user_path(user["user_id"], "raw", "uploads", f"{pdf_uuid}.pdf")
    write_bytes(gcs_path, contents, "application/pdf")

    # Run ingest
    result = await run_ingest(
        url=gcs_path,
        user_id=user["user_id"],
        source_type="pdf",
        pdf_bytes=contents,
    )
    return result
