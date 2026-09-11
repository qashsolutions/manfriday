"""TTSAdapter (D6): one interface, swappable providers.

Hard requirement of the contract: caption timing. Providers that return word
timestamps use them; providers that don't (macOS `say`, dev-only) fall back to
proportional pacing — validated in validation/template-spec.

Provider selection: TTS_PROVIDER env — "say" (default, dev) | "fal".
FAL model via FAL_TTS_MODEL (default fal-ai/elevenlabs/tts/multilingual-v2).

D6 v3 (docs/language-ux.md §4): when SARVAM_API_KEY is set, the ten Indic
launch languages (+ en-IN when TTS_INDIAN_ENGLISH=1) route to Sarvam Bulbul v3,
which handles code-mixed Hinglish/Tanglish in one pass. Bulbul returns no word
timestamps (and Saaras STT only returns one timestamp per clip), so the adapter
aligns captions itself, deterministically: the script's punctuation defines
phrases, ffmpeg silence detection finds the pauses the voice leaves at that
punctuation, and the two are matched; words inside a phrase pace
proportionally. The TTSAdapter contract (timed caption chunks) is satisfied by
the adapter, not the vendor.
"""
from __future__ import annotations

import base64
import json
import re

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


# ---- Sarvam (Indic) ---------------------------------------------------------

SARVAM_LANG = {
    "hi": "hi-IN", "bn": "bn-IN", "ta": "ta-IN", "te": "te-IN", "mr": "mr-IN",
    "kn": "kn-IN", "ml": "ml-IN", "gu": "gu-IN", "pa": "pa-IN", "or": "od-IN",
    "en": "en-IN",
}
INDIC = {"hi", "bn", "ta", "te", "mr", "kn", "ml", "gu", "pa", "or"}
# Brand-voice defaults (user pick, 11 Sep, from the Hinglish shortlist):
# priya (default, female), kavya (female alt), rahul (male alt). Bulbul v3
# speakers are multilingual across the Indic set; override per language with
# SARVAM_SPEAKER_<code>, e.g. SARVAM_SPEAKER_ta=kavya.
SARVAM_DEFAULT_SPEAKER = "priya"
SARVAM_VOICES = {"female": ["priya", "kavya"], "male": ["rahul"]}
SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"


def _split_words(words: list[str], max_words: int = 5) -> list[list[str]]:
    out, i = [], 0
    while i < len(words):
        chunk = words[i : i + max_words]
        if len(words) - (i + max_words) == 1:  # never strand a single word
            chunk = words[i : i + max_words - 1]
        out.append(chunk)
        i += len(chunk)
    return out


STRONG_BREAK = re.compile(r"(?<=[.!?।—–])\s+|(?<=[.!?।])(?=\S)")
CLAUSE_BREAK = re.compile(r"(?<=[,;:])\s+")


def split_sentences(script: str) -> list[list[str]]:
    """Sentences (strong punctuation) → clauses (commas). Where a voice pauses."""
    sentences = [x.strip() for x in STRONG_BREAK.split(script) if x and x.strip()] or [script.strip()]
    return [[c.strip() for c in CLAUSE_BREAK.split(sent) if c.strip()] or [sent] for sent in sentences]


def speech_intervals(wav: Path, noise_db: float = -35.0, min_silence: float = 0.16) -> list[tuple[float, float]]:
    """(start, end) of voiced spans, from ffmpeg silencedetect."""
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-af", f"silencedetect=noise={noise_db}dB:d={min_silence}", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    total = _duration(wav)
    silences: list[tuple[float, float]] = []
    cur: float | None = None
    for line in out.splitlines():
        m = re.search(r"silence_start: ([0-9.]+)", line)
        if m:
            cur = float(m.group(1))
            continue
        m = re.search(r"silence_end: ([0-9.]+)", line)
        if m and cur is not None:
            silences.append((cur, float(m.group(1))))
            cur = None
    if cur is not None:
        silences.append((cur, total))
    spans, t = [], 0.0
    for a, b in silences:
        if a - t > 0.05:
            spans.append((t, a))
        t = b
    if total - t > 0.05:
        spans.append((t, total))
    return spans or [(0.0, total)]


def _pace(units: list[str], start: float, end: float, max_words: int) -> list[tuple[float, float, str]]:
    """Proportional caption chunks for a run of words inside [start, end]."""
    words = " ".join(units).split()
    if not words:
        return []
    span = max(0.1, end - start)
    out, t = [], start
    for piece in _split_words(words, max_words):
        d = span * len(piece) / len(words)
        out.append((t, t + d, " ".join(piece)))
        t += d
    return out


def align_by_silence(script: str, wav: Path, total: float, max_words: int = 5) -> list[tuple[float, float, str]]:
    """Two-level alignment. Sentence ends snap to the nearest pause (wide
    tolerance: a voice always breathes at a full stop); comma clauses split
    their sentence's span at a pause if one falls inside it, else
    proportionally. Deterministic, no model, no vendor timestamps."""
    sentences = split_sentences(script)
    spans = speech_intervals(wav)
    voiced = sum(b - a for a, b in spans)
    if voiced <= 0 or not sentences:
        return proportional_chunks(script, total, max_words)

    def wall_at(voiced_t: float) -> float:
        acc = 0.0
        for a, b in spans:
            if acc + (b - a) >= voiced_t:
                return a + (voiced_t - acc)
            acc += b - a
        return spans[-1][1]

    def next_voiced(t: float) -> float:  # if t sits in a pause, jump to the next voiced start
        for a, b in spans:
            if a <= t < b:
                return t
            if a > t:
                return a
        return t

    pauses = [(spans[i][1], spans[i + 1][0]) for i in range(len(spans) - 1)]
    counts = [sum(len(c.split()) for c in sent) for sent in sentences]
    nwords = sum(counts) or 1

    # 1) sentence boundaries
    bounds = [spans[0][0]]
    cum = 0
    for i, c in enumerate(counts):
        cum += c
        if i == len(counts) - 1:
            bounds.append(spans[-1][1])
            break
        target = wall_at(voiced * cum / nwords)
        cands = [p for p in pauses if p[0] > bounds[-1] + 0.3 and abs(p[0] - target) <= 1.2]
        if cands:
            gap = min(cands, key=lambda p: abs(p[0] - target))
            bounds.append(gap[0])
            pauses = [p for p in pauses if p[0] > gap[0]]
        else:
            bounds.append(max(target, bounds[-1] + 0.3))

    # 2) clauses inside each sentence, 3) words inside each clause
    out: list[tuple[float, float, str]] = []
    for i, clauses in enumerate(sentences):
        s_start, s_end = next_voiced(bounds[i]), bounds[i + 1]
        inner = [p for p in pauses if s_start + 0.2 < p[0] < s_end - 0.2]
        cwords = [len(c.split()) for c in clauses]
        ctotal = sum(cwords) or 1
        cb = [s_start]
        cum = 0
        for j, cw in enumerate(cwords):
            cum += cw
            if j == len(cwords) - 1:
                cb.append(s_end)
                break
            target = s_start + (s_end - s_start) * cum / ctotal
            near = [p for p in inner if p[0] > cb[-1] + 0.2 and abs(p[0] - target) <= 0.6]
            if near:
                gap = min(near, key=lambda p: abs(p[0] - target))
                cb.append(gap[0])
                inner = [p for p in inner if p[0] > gap[0]]
            else:
                cb.append(max(target, cb[-1] + 0.2))
        for j, clause in enumerate(clauses):
            out.extend(_pace([clause], next_voiced(cb[j]), cb[j + 1], max_words))
    return out


class SarvamTTS:
    """Sarvam Bulbul v3 for the Indic launch languages (+ Indian English)."""

    def __init__(self) -> None:
        self.key = os.environ.get("SARVAM_API_KEY")
        if not self.key:
            raise RuntimeError("SARVAM_API_KEY is not set")
        self.model = os.environ.get("SARVAM_TTS_MODEL", "bulbul:v3")

    def speaker_for(self, language: str) -> str:
        return os.environ.get(f"SARVAM_SPEAKER_{language}") or os.environ.get("SARVAM_SPEAKER") or SARVAM_DEFAULT_SPEAKER

    def synthesize(self, script: str, language: str, outdir: Path, speaker: str | None = None) -> TTSResult:
        import requests

        lang_code = SARVAM_LANG.get(language)
        if not lang_code:
            raise RuntimeError(f"sarvam tts: unsupported language {language}")
        if len(script) > 2500:
            raise RuntimeError("sarvam tts: script over 2,500 characters")
        body = {
            "text": script,
            "language_code": lang_code,
            "speaker": speaker or self.speaker_for(language),
            "model": self.model,
            "pace": float(os.environ.get("SARVAM_PACE", "1.0")),
            "speech_sample_rate": 44100,
            "enable_preprocessing": True,  # code-mixed text, numbers, dates
            "output_audio_codec": "wav",
        }
        resp = requests.post(
            SARVAM_TTS_URL,
            headers={"api-subscription-key": self.key, "Content-Type": "application/json"},
            data=json.dumps(body),
            timeout=120,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"sarvam tts {resp.status_code}: {resp.text[:300]}")
        audios = (resp.json() or {}).get("audios") or []
        if not audios:
            raise RuntimeError("sarvam tts: empty audios")
        raw = outdir / "vo_sarvam.wav"
        raw.write_bytes(base64.b64decode(audios[0]))
        wav = outdir / "vo.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-ar", "44100", str(wav)], check=True)
        raw.unlink()
        dur = _duration(wav)
        return TTSResult(wav=wav, duration=dur, chunks=align_by_silence(script, wav, dur))


class RoutedTTS:
    """Language router: Indic → Sarvam (when configured), everything else → base."""

    def __init__(self, base, sarvam: SarvamTTS | None) -> None:
        self.base = base
        self.sarvam = sarvam
        self.indian_english = os.environ.get("TTS_INDIAN_ENGLISH") == "1"

    def synthesize(self, script: str, language: str, outdir: Path) -> TTSResult:
        if self.sarvam and (language in INDIC or (language == "en" and self.indian_english)):
            return self.sarvam.synthesize(script, language, outdir)
        return self.base.synthesize(script, language, outdir)


def get_tts():
    provider = os.environ.get("TTS_PROVIDER", "say")
    base = FalTTS() if provider == "fal" else SayTTS()
    sarvam = SarvamTTS() if os.environ.get("SARVAM_API_KEY") else None
    return RoutedTTS(base, sarvam) if sarvam else base
