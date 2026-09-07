"""TTSAdapter (D6): one interface, swappable providers.

Hard requirement of the contract: caption timing. Providers that return word
timestamps use them; providers that don't (macOS `say`, dev-only) fall back to
proportional pacing — validated in validation/template-spec.

Provider selection: TTS_PROVIDER env — "say" (default, dev) | "fal".
FAL model via FAL_TTS_MODEL (default fal-ai/elevenlabs/tts/multilingual-v2).
"""
from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

# macOS `say` voices per content language (dev only; FAL covers all 14 in prod)
SAY_VOICES = {
    "en": "Samantha",
    "es": "Paulina",
    "pt-BR": "Luciana",
    "id": "Damayanti",
    "hi": "Lekha",
}


@dataclass
class TTSResult:
    wav: Path
    duration: float
    # (start, end, text) caption chunks; from word timestamps when available,
    # else proportional by word count
    chunks: list[tuple[float, float, str]]


def _duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(out.stdout.strip())


def proportional_chunks(script: str, total: float, max_words: int = 5) -> list[tuple[float, float, str]]:
    words = script.split()
    chunks, i = [], 0
    while i < len(words):
        chunk = words[i : i + max_words]
        if len(words) - (i + max_words) == 1:
            chunk = words[i : i + max_words - 1]
        chunks.append(" ".join(chunk))
        i += len(chunk)
    t, out = 0.0, []
    for c in chunks:
        d = total * len(c.split()) / len(words)
        out.append((t, t + d, c))
        t += d
    return out


class SayTTS:
    """Dev provider: macOS `say`. No word timestamps → proportional pacing."""

    def synthesize(self, script: str, language: str, outdir: Path) -> TTSResult:
        voice = SAY_VOICES.get(language) or SAY_VOICES["en"]
        aiff = outdir / "vo.aiff"
        wav = outdir / "vo.wav"
        subprocess.run(["say", "-v", voice, "-o", str(aiff), script], check=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), "-ar", "44100", str(wav)], check=True)
        aiff.unlink()
        dur = _duration(wav)
        return TTSResult(wav=wav, duration=dur, chunks=proportional_chunks(script, dur))


class FalTTS:
    """Production provider via fal.ai (ElevenLabs multilingual class models)."""

    def __init__(self) -> None:
        self.model = os.environ.get("FAL_TTS_MODEL", "fal-ai/elevenlabs/tts/multilingual-v2")

    def synthesize(self, script: str, language: str, outdir: Path) -> TTSResult:
        import fal_client  # lazy: dev machines without the extra still run SayTTS
        import requests

        result = fal_client.subscribe(self.model, arguments={"text": script})
        audio_url = (result.get("audio") or {}).get("url") or result.get("audio_url")
        if not audio_url:
            raise RuntimeError(f"fal tts: no audio url in result keys={list(result)}")
        raw = outdir / "vo_dl"
        raw.write_bytes(requests.get(audio_url, timeout=120).content)
        wav = outdir / "vo.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-ar", "44100", str(wav)], check=True)
        dur = _duration(wav)
        # Word timestamps: parse if the model returns them, else proportional.
        stamps = result.get("timestamps") or result.get("words")
        if isinstance(stamps, list) and stamps and "start" in stamps[0]:
            chunks: list[tuple[float, float, str]] = []
            buf: list[dict] = []
            for w in stamps:
                buf.append(w)
                if len(buf) == 5:
                    chunks.append((buf[0]["start"], buf[-1]["end"], " ".join(x.get("word", x.get("text", "")) for x in buf)))
                    buf = []
            if buf:
                chunks.append((buf[0]["start"], buf[-1]["end"], " ".join(x.get("word", x.get("text", "")) for x in buf)))
            return TTSResult(wav=wav, duration=dur, chunks=chunks)
        return TTSResult(wav=wav, duration=dur, chunks=proportional_chunks(script, dur))


def get_tts():
    provider = os.environ.get("TTS_PROVIDER", "say")
    return FalTTS() if provider == "fal" else SayTTS()
