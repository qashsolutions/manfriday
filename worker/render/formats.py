"""Format renderers — deterministic execution of templateSpec v1.1 render plans.

Ported from validation/template-spec/render.py with the FINDINGS.md fixes:
F5 (caption safe-area via with_text screenshot sizing) and F7 (clamp output
duration with -t instead of trusting the concat tail frame).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from .assets import BrandAssets, avatar_placeholder, compose_slide, draw_text_block
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
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-t", f"{total:.3f}", str(out_mp4)]
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


def render_slideshow(structure: dict, values: dict, brand: BrandAssets, outdir: Path, preview: bool) -> dict:
    plan = structure["renderPlan"]
    slides = plan["slides"]
    if preview:
        img = compose_slide(slides[0]["bg"], slides[0].get("text"), values, brand)
        thumb = outdir / "preview.png"
        img.save(thumb)
        return {"thumb": thumb}
    files = []
    for i, slide in enumerate(slides, 1):
        img = compose_slide(slide["bg"], slide.get("text"), values, brand)
        f = outdir / f"slide_{i}.png"
        img.save(f)
        files.append(f)
    # one video artifact: 2.5s montage per slide (TikTok photo-mode gets the
    # PNGs at publish time; the mp4 is the in-app playable)
    frames = [(f, 2.5) for f in files]
    out = outdir / "post.mp4"
    assemble(frames, None, 2.5 * len(files), out)
    return {"video": out, "thumb": files[0], "slides": files}


def render_hook(structure: dict, values: dict, brand: BrandAssets, language: str, outdir: Path, preview: bool) -> dict:
    plan = structure["renderPlan"]
    shots = plan["shots"]
    if preview:
        first = shots[0]
        img = compose_slide(first["bg"], first.get("text"), values, brand)
        thumb = outdir / "preview.png"
        img.save(thumb)
        return {"thumb": thumb}

    tts = get_tts().synthesize(values[plan["voice"]["slotRef"]], language, outdir)
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
    plan = structure["renderPlan"]
    base = avatar_placeholder(brand)
    if preview:
        img = base.copy()
        img = draw_text_block(img, values[plan["overlay"]["slotRef"]], plan["overlay"]["styleToken"], plan["overlay"]["position"], brand.palette)
        thumb = outdir / "preview.png"
        img.save(thumb)
        return {"thumb": thumb}

    tts = get_tts().synthesize(values[plan["speech"]["slotRef"]], language, outdir)
    end_hold = plan["endCard"]["holdSeconds"]
    total = tts.duration + end_hold
    cap = plan.get("durationCapSeconds", 60)
    if total > cap:
        raise RuntimeError(f"duration {total:.1f}s exceeds cap {cap}s")

    overlay_until = plan["overlay"]["showSeconds"]
    frames = []
    i = 0
    for a, b, cap_text in tts.chunks:
        img = base.copy()
        if a < overlay_until:
            img = draw_text_block(img, values[plan["overlay"]["slotRef"]], plan["overlay"]["styleToken"], plan["overlay"]["position"], brand.palette)
        img = draw_text_block(img, cap_text, plan["captions"]["styleToken"], plan["captions"]["position"], brand.palette)
        f = outdir / f"seg_{i:02d}.png"
        img.save(f)
        frames.append((f, b - a))
        i += 1
    endcard = compose_slide(plan["endCard"]["bg"], plan["endCard"]["text"], values, brand)
    f = outdir / f"seg_{i:02d}.png"
    endcard.save(f)
    frames.append((f, end_hold))
    out = outdir / "post.mp4"
    assemble(frames, tts.wav, total, out)
    # NOTE: lipsync (FAL_LIPSYNC_MODEL, e.g. fal-ai/sync-lipsync/v3) replaces the
    # placeholder character on right-swipe finals once avatar characters ship.
    return {"video": out, "thumb": frames[0][0], "durationSeconds": total}
