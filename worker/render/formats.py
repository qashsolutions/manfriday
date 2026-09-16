"""Format renderers — deterministic execution of templateSpec v1.1 render plans.

Ported from validation/template-spec/render.py with the FINDINGS.md fixes:
F5 (caption safe-area via with_text screenshot sizing) and F7 (clamp output
duration with -t instead of trusting the concat tail frame).
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .assets import BrandAssets, avatar_placeholder, compose_slide, draw_text_block, presenter_frame, W, H
from .tts import get_tts


def assemble(frames: list[tuple[Path, float]], audio_wav: Path | None, total: float, out_mp4: Path) -> None:
    lst = out_mp4.with_suffix(".txt")
    lines = []
    for p, d in frames:
        lines.append(f"file '{p}'")
        lines.append(f"duration {d:.3f}")
    lines.append(f"file '{frames[-1][0]}'")
    lst.write_text("\n".join(lines))
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst)]
    if audio_wav is not None:
        cmd += ["-i", str(audio_wav), "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "128k"]
    # Memory-bounded encode: x264's default preset needs several hundred MB at
    # 1080x1920 and gets SIGKILLed on small containers (Railway trial). veryfast +
    # 2 threads + short lookahead + 1 ref keeps it well under 200 MB with no
    # visible difference for slides/captions; crf 20 holds quality.
    cmd += [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", "2",
        "-x264-params", "rc-lookahead=10:ref=1:bframes=2",
        "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart",
        "-t", f"{total:.3f}", str(out_mp4),
    ]
    subprocess.run(cmd, check=True)
    lst.unlink()


def segment_timeline(shot_spans, caption_spans, total: float):
    cuts = {0.0, total}
    for s, e, _ in shot_spans:
        cuts.update([s, e])
    for s, e, _ in caption_spans:
        cuts.update([s, e])
    ordered = sorted(c for c in cuts if 0 <= c <= total)
    segs = []
    for a, b in zip(ordered, ordered[1:]):
        if b - a < 0.05:
            continue
        mid = (a + b) / 2
        shot = next(sh for s, e, sh in shot_spans if s <= mid < e)
        cap = next((c for s, e, c in caption_spans if s <= mid < e), None)
        segs.append((a, b, shot, cap))
    return segs


def render_slideshow(structure: dict, values: dict, brand: BrandAssets, outdir: Path, preview: bool, language: str = "en") -> dict:
    """Slideshow: one still per slide, NARRATED — each slide's line is spoken in
    the brand voice and the slide stays up for as long as it takes to say it
    (+ a beat). Added 15 Sep 2026: silent slideshows read as broken on TikTok;
    the template spec's 'licensed music' bed is still not wired (needs a licensed
    library), so the voice carries the audio for now."""
    plan = structure["renderPlan"]
    slides = plan["slides"]
    if preview:
        img = compose_slide(slides[0]["bg"], slides[0].get("text"), values, brand)
        thumb = outdir / "preview.png"
        img.save(thumb)
        return {"thumb": thumb}
    tts = get_tts()
    frames: list[tuple[Path, float]] = []
    parts: list[tuple[Path | None, float]] = []  # (wav or None for silence, seconds)
    beat = 0.45
    for i, slide in enumerate(slides, 1):
        img = compose_slide(slide["bg"], slide.get("text"), values, brand)
        f = outdir / f"slide_{i}.png"
        img.save(f)
        text = values.get((slide.get("text") or {}).get("slotRef", ""), "") if slide.get("text") else ""
        if text.strip():
            sub = outdir / f"slide_{i}_tts"
            sub.mkdir(exist_ok=True)
            r = tts.synthesize(text, language, sub)
            dur = r.duration + beat
            parts.append((r.wav, r.duration))
            parts.append((None, beat))
        else:
            dur = 2.5
            parts.append((None, dur))
        frames.append((f, dur))
    total = sum(d for _, d in frames)
    wav = concat_audio(parts, outdir / "narration.wav")
    out = outdir / "post.mp4"
    assemble(frames, wav, total, out)
    return {"video": out, "thumb": frames[0][0], "slides": [p for p, _ in frames], "durationSeconds": total}


def concat_audio(parts: list[tuple[Path | None, float]], out: Path) -> Path:
    """Join voice clips and silences into one 44.1 kHz stereo WAV (inputs may be
    mono/stereo, mp3-derived or Sarvam wav — everything is normalised first)."""
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    labels = []
    for k, (p, secs) in enumerate(parts):
        if p is None:
            cmd += ["-f", "lavfi", "-t", f"{secs:.3f}", "-i", "anullsrc=r=44100:cl=stereo"]
        else:
            cmd += ["-i", str(p)]
        labels.append(f"[{k}:a]aresample=44100,aformat=channel_layouts=stereo[a{k}]")
    graph = ";".join(labels) + ";" + "".join(f"[a{k}]" for k in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1[out]"
    cmd += ["-filter_complex", graph, "-map", "[out]", "-ar", "44100", str(out)]
    subprocess.run(cmd, check=True)
    return out


def render_hook(structure: dict, values: dict, brand: BrandAssets, language: str, outdir: Path, preview: bool) -> dict:
    plan = structure["renderPlan"]
    shots = plan["shots"]
    if preview:
        first = shots[0]
        img = compose_slide(first["bg"], first.get("text"), values, brand)
        thumb = outdir / "preview.png"
        img.save(thumb)
        return {"thumb": thumb}

    tts = get_tts().synthesize(values[plan["voice"]["slotRef"]], language, outdir, voice=brand.voice)
    fixed = sum(s.get("holdSeconds", 0) for s in shots)
    flex_dur = max(1.0, tts.duration - fixed + 1.0)
    total = fixed + flex_dur
    cap = plan.get("durationCapSeconds", 60)
    if total > cap:
        raise RuntimeError(f"duration {total:.1f}s exceeds cap {cap}s")

    shot_spans, t = [], 0.0
    for s in shots:
        d = flex_dur if s.get("flex") else s["holdSeconds"]
        shot_spans.append((t, t + d, s))
        t += d

    frames = []
    for i, (a, b, shot, cap_text) in enumerate(segment_timeline(shot_spans, tts.chunks, total)):
        img = compose_slide(shot["bg"], shot.get("text"), values, brand)
        if cap_text and not shot.get("text"):
            img = draw_text_block(img, cap_text, plan["captions"]["styleToken"], plan["captions"]["position"], brand.palette)
        f = outdir / f"seg_{i:02d}.png"
        img.save(f)
        frames.append((f, b - a))
    out = outdir / "post.mp4"
    assemble(frames, tts.wav, total, out)
    return {"video": out, "thumb": frames[0][0], "durationSeconds": total}


def render_avatar(structure: dict, values: dict, brand: BrandAssets, language: str, outdir: Path, preview: bool) -> dict:
    """Avatar format (D2, amended 14 Sep 2026): the user's own presenter photo is
    animated to speak the HOOK (first AVATAR_HOOK_SECONDS of the script) by a
    FAL talking-head model; the rest of the script runs over product screenshots
    with captions. Preview = free still frame. Without a presenter photo the
    legacy placeholder path runs (only old concepts reach it — match.py stops
    planning avatar templates for brands with no photo)."""
    plan = structure["renderPlan"]
    base = presenter_frame(brand)
    if preview:
        img = base.copy()
        img = draw_text_block(img, values[plan["overlay"]["slotRef"]], plan["overlay"]["styleToken"], plan["overlay"]["position"], brand.palette)
        thumb = outdir / "preview.png"
        img.save(thumb)
        return {"thumb": thumb}

    tts = get_tts().synthesize(values[plan["speech"]["slotRef"]], language, outdir, voice=brand.voice)
    end_hold = plan["endCard"]["holdSeconds"]
    total = tts.duration + end_hold
    cap = plan.get("durationCapSeconds", 60)
    if total > cap:
        raise RuntimeError(f"duration {total:.1f}s exceeds cap {cap}s")
    overlay_until = plan["overlay"]["showSeconds"]

    def caption_png(text: str, with_overlay: bool, i: int) -> Path:
        img = base.copy()
        if with_overlay:
            img = draw_text_block(img, values[plan["overlay"]["slotRef"]], plan["overlay"]["styleToken"], plan["overlay"]["position"], brand.palette)
        img = draw_text_block(img, text, plan["captions"]["styleToken"], plan["captions"]["position"], brand.palette)
        p = outdir / f"seg_{i:02d}.png"
        img.save(p)
        return p

    cost_cents = 0
    hook_clip: Path | None = None
    hook_end = 0.0
    if brand.presenter:
        # Hook boundary: the caption chunk end closest to (and not above) the budget.
        budget = float(os.environ.get("AVATAR_HOOK_SECONDS", "8"))
        hook_end = tts.chunks[0][1]
        for _a, b, _t in tts.chunks:
            if b <= budget:
                hook_end = b
        hook_wav = outdir / "hook.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tts.wav), "-t", f"{hook_end:.3f}", str(hook_wav)], check=True)
        still = outdir / "presenter_frame.jpg"
        base.save(still, quality=92)
        hook_clip, seconds = talking_head(still, hook_wav, outdir)
        cost_cents = int(round(seconds * AVATAR_CENTS_PER_SECOND))
        # Burn the hook overlay + captions onto the talking clip (transparent PNGs, timed).
        overlays = []
        j = 0
        for a, b, text in tts.chunks:
            if a >= hook_end:
                break
            overlays.append((caption_overlay(text, values, plan, brand, a < overlay_until, outdir, j), a, min(b, hook_end)))
            j += 1
        hook_clip = burn_overlays(hook_clip, overlays, outdir / "hook_captioned.mp4", trim_to=hook_end)

    # Tail: product screenshots / gradient with captions, then the end card.
    frames = []
    i = 0
    for a, b, text in tts.chunks:
        if b <= hook_end:
            continue
        a = max(a, hook_end)
        bg = brand.screenshot("product") or brand.screenshot("hero")
        img = compose_slide({"kind": "brand_screenshot", "pick": "product"} if bg else {"kind": "gradient", "styleToken": "brand-dark-2"}, None, values, brand)
        if a < overlay_until and not brand.presenter:
            img = draw_text_block(img, values[plan["overlay"]["slotRef"]], plan["overlay"]["styleToken"], plan["overlay"]["position"], brand.palette)
        img = draw_text_block(img, text, plan["captions"]["styleToken"], plan["captions"]["position"], brand.palette)
        p = outdir / f"tail_{i:02d}.png"
        img.save(p)
        frames.append((p, b - a))
        i += 1
    endcard = compose_slide(plan["endCard"]["bg"], plan["endCard"]["text"], values, brand)
    p = outdir / f"tail_{i:02d}.png"
    endcard.save(p)
    frames.append((p, end_hold))

    out = outdir / "post.mp4"
    if hook_clip is None:
        # legacy placeholder path (no presenter): stills for the whole script
        frames = [(caption_png(t, a < overlay_until, k), b - a) for k, (a, b, t) in enumerate(tts.chunks)] + [frames[-1]]
        assemble(frames, tts.wav, total, out)
        thumb = frames[0][0]
    else:
        tail = outdir / "tail.mp4"
        assemble(frames, None, total - hook_end, tail)
        concat_with_audio([hook_clip, tail], tts.wav, total, out)
        thumb = outdir / "preview.png"
        base.copy().save(thumb)
    return {"video": out, "thumb": thumb, "durationSeconds": total, "costCents": cost_cents}


# --- talking-head helpers (FAL) -------------------------------------------------

AVATAR_MODEL = os.environ.get("FAL_AVATAR_MODEL", "fal-ai/kling-video/ai-avatar/v2/standard")
AVATAR_CENTS_PER_SECOND = float(os.environ.get("FAL_AVATAR_CENTS_PER_SECOND", "5.62"))  # Kling v2 standard list price


def talking_head(still: Path, audio: Path, outdir: Path) -> tuple[Path, float]:
    """Image + audio → talking video via FAL. Returns (clip path, billed seconds)."""
    import fal_client
    import requests

    image_url = fal_client.upload_file(str(still))
    audio_url = fal_client.upload_file(str(audio))
    result = fal_client.subscribe(AVATAR_MODEL, arguments={"image_url": image_url, "audio_url": audio_url})
    url = result["video"]["url"]
    raw = outdir / "hook_raw.mp4"
    raw.write_bytes(requests.get(url, timeout=300).content)
    seconds = float(result.get("duration") or 0.0)
    if seconds <= 0:
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(raw)], capture_output=True, text=True)
        seconds = float(probe.stdout.strip() or 0)
    return raw, seconds


def caption_overlay(text: str, values: dict, plan: dict, brand: BrandAssets, with_overlay: bool, outdir: Path, i: int) -> Path:
    """Transparent 1080x1920 PNG carrying the hook overlay and/or one caption."""
    from PIL import Image as _Image

    img = _Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if with_overlay:
        # Over a photo the small mint label vanishes: back it with a soft dark band.
        from PIL import ImageDraw as _ImageDraw
        band = _Image.new("RGBA", (W, H), (0, 0, 0, 0))
        _ImageDraw.Draw(band).rounded_rectangle([60, int(H * 0.16) - 34, W - 60, int(H * 0.16) + 96], radius=22, fill=(12, 11, 16, 170))
        img = _Image.alpha_composite(img, band)
        img = draw_text_block(img, values[plan["overlay"]["slotRef"]], plan["overlay"]["styleToken"], plan["overlay"]["position"], brand.palette)
    img = draw_text_block(img, text, plan["captions"]["styleToken"], plan["captions"]["position"], brand.palette)
    p = outdir / f"ov_{i:02d}.png"
    img.save(p)
    return p


def burn_overlays(clip: Path, overlays: list[tuple[Path, float, float]], out: Path, trim_to: float | None = None) -> Path:
    """Scale the talking clip to 1080x1920@30, overlay timed caption PNGs, and
    cut it at exactly the hook audio length — the model pads its output by a few
    seconds, and an untrimmed clip leaves the face on screen, mouth idle, while
    the next line already plays (looked like broken lip-sync)."""
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(clip)]
    for p, _a, _b in overlays:
        cmd += ["-i", str(p)]
    chain = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30[v0]"
    prev = "v0"
    for k, (_p, a, b) in enumerate(overlays, start=1):
        chain += f";[{prev}][{k}:v]overlay=0:0:enable='between(t,{a:.3f},{b:.3f})'[v{k}]"
        prev = f"v{k}"
    cmd += ["-filter_complex", chain, "-map", f"[{prev}]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", "2",
            "-x264-params", "rc-lookahead=10:ref=1:bframes=2", "-pix_fmt", "yuv420p"]
    if trim_to:
        cmd += ["-t", f"{trim_to:.3f}"]
    cmd += [str(out)]
    subprocess.run(cmd, check=True)
    return out


def concat_with_audio(clips: list[Path], audio_wav: Path, total: float, out: Path) -> None:
    """Concatenate same-format clips (1080x1920@30, no audio) and lay the full voice track over them."""
    lst = out.with_suffix(".concat.txt")
    lst.write_text("\n".join(f"file '{c}'" for c in clips))
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-i", str(audio_wav),
           "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-t", f"{total:.3f}", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    lst.unlink()
