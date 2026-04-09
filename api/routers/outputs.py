"""Outputs router — list and file-back outputs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from api.middleware.auth import get_current_user
from api.models.requests import FileBackRequest
from shared.python.manfriday_core.gcs import (
    read_text, write_text, list_markdown_files, user_path, exists,
)

router = APIRouter()


@router.get("")
async def list_outputs(user: dict = Depends(get_current_user)):
    """List outputs gallery."""
    uid = user["user_id"]
    md_files = list_markdown_files(user_path(uid, "outputs") + "/")

    outputs = []
    for path in md_files:
        filename = path.split("/")[-1]
        outputs.append({"path": path, "filename": filename})

    return {"outputs": outputs}


@router.post("/file-back")
async def file_back(req: FileBackRequest, user: dict = Depends(get_current_user)):
    """Tag + copy output to raw/outputs/ for re-ingestion by compile."""
    uid = user["user_id"]

    # Path traversal protection: output_path must belong to authenticated user
    expected_prefix = user_path(uid, "")
    if ".." in req.output_path or not req.output_path.startswith(expected_prefix):
        raise HTTPException(
            status_code=403,
            detail="Access denied: output path does not belong to authenticated user",
        )

    if not exists(req.output_path):
        return {"error": "Output not found"}

    content = read_text(req.output_path)
    filename = req.output_path.split("/")[-1]
    raw_output_path = user_path(uid, "raw", "outputs", filename)
    write_text(raw_output_path, content, "text/markdown")

    return {"filed": True, "raw_path": raw_output_path}
