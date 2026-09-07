"""Stub renderer — proves the queue → render → upload → complete spine.

Replaced by the real deterministic renderers (ported from
validation/template-spec/render.py) as M1 progresses.
"""
import subprocess
from pathlib import Path


def render_stub(job: dict, outdir: Path) -> Path:
    out = outdir / "stub.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=0x0C0B10:s=1080x1920:d=2:r=30",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(out),
        ],
        check=True,
    )
    return out
