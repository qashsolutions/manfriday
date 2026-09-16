"""Render-worker tests: real ffmpeg + Pillow, fake voice (no network, no cost).
Run: cd worker && TTS_PROVIDER=fake .venv/bin/python -m pytest -q"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["TTS_PROVIDER"] = "fake"
os.environ.pop("SARVAM_API_KEY", None)

from PIL import Image  # noqa: E402

from render.assets import BrandAssets  # noqa: E402


def template(name: str) -> dict:
    return json.loads((ROOT / "templates" / f"{name}.json").read_text())


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(out.stdout)
    streams = {s["codec_type"]: s for s in data["streams"]}
    return {
        "has_audio": "audio" in streams,
        "width": streams["video"]["width"],
        "height": streams["video"]["height"],
        "fps": streams["video"]["r_frame_rate"],
        "duration": float(data["format"]["duration"]),
    }


def mean_volume_db(path: Path) -> float:
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-vn", "-f", "null", "-"], capture_output=True, text=True).stderr
    return float(err.split("mean_volume:")[1].split("dB")[0])


def frame_at(path: Path, t: float) -> Image.Image:
    out = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True)
    from io import BytesIO
    return Image.open(BytesIO(out.stdout)).convert("RGB")


@pytest.fixture
def brand(tmp_path) -> BrandAssets:
    return BrandAssets(name="Demo App")


@pytest.fixture
def presenter_brand(tmp_path) -> BrandAssets:
    face = tmp_path / "face.jpg"
    Image.new("RGB", (800, 1000), (200, 120, 90)).save(face)  # unmistakable warm block
    return BrandAssets(name="Demo App", presenter=face, voice="male")


def values_for(t: dict, base: str = "Nobody told me this would double signups") -> dict:
    """Fill every slot with something that fits its maxChars."""
    out = {}
    for s in t["slots"]:
        text = base if s["type"] == "text" else (base + ". " + "We shipped daily for a month and the numbers moved. " * 2)
        if s.get("maxChars"):
            text = text[: s["maxChars"]]
        out[s["id"]] = text
    return out
