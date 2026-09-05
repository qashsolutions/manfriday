#!/usr/bin/env python3
"""Deterministic renderer — validates that templateSpec v1 render plans can be
executed by plain Pillow + ffmpeg code with no model in the loop.

Local stand-ins (recorded in FINDINGS.md):
  - TTS: macOS `say` instead of FAL TTS (no word timestamps -> captions are
    paced proportionally by word count; production uses real timestamps)
  - stock(query): renders a neutral dark gradient tagged with the query
    (no stock provider integration locally)
  - music: skipped (licensed library is a production integration)
  - avatar character: placeholder portrait card (lipsync is FAL-side, lazy)
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).parent
OUT = ROOT / "out"
W, H = 1080, 1920

BRAND = json.loads((ROOT / "brand" / "manfriday.json").read_text())
PAL = BRAND["palette"]


def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


# ---------------------------------------------------------------- fonts
_font_cache = {}


def font(kind, size, wght=None, wdth=None):
    key = (kind, size, wght, wdth)
    if key not in _font_cache:
        f = ImageFont.truetype(str(ROOT / BRAND["fonts"][kind]), size)
        try:
            axes = {a["name"].decode() if isinstance(a["name"], bytes) else a["name"]: a
                    for a in f.get_variation_axes()}
            values = []
            for a in f.get_variation_axes():
                name = a["name"].decode() if isinstance(a["name"], bytes) else a["name"]
                if "Weight" in name and wght:
                    values.append(wght)
                elif "Width" in name and wdth:
                    values.append(wdth)
                else:
                    values.append(a["default"])
            f.set_variation_by_axes(values)
        except OSError:
            pass  # static font
        _font_cache[key] = f
    return _font_cache[key]


# StyleTokens: worker-side resolution table, brand palette in, concrete
# type/colors out. Templates stay brand-neutral (spec contract).
def resolve_token(token):
    t = {
        "hook-xl":    dict(kind="display", size=88, wght=900, wdth=115, color=PAL["text"], line=1.06),
        "hook-lg":    dict(kind="display", size=68, wght=900, wdth=115, color=PAL["text"], line=1.08),
        "body-lg":    dict(kind="body", size=58, wght=600, color=PAL["text"], line=1.22),
        "cta-md":     dict(kind="display", size=48, wght=800, wdth=110, color=PAL["graphite"],
                           pill=PAL["accent"], line=1.1),
        "caption-md": dict(kind="body", size=54, wght=600, color="#FFFFFF", stroke="#000000",
                           line=1.15),
        "label-sm":   dict(kind="mono", size=34, wght=500, color=PAL["mint"], line=1.2,
                           tracking=True),
    }[token]
    return t


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        trial = (cur + " " + w_).strip()
        if draw.textbbox((0, 0), trial, font=fnt)[2] <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def draw_text_block(img, text, token, position, max_w=900):
    st = resolve_token(token)
    fnt = font(st["kind"], st["size"], st.get("wght"), st.get("wdth"))
    d = ImageDraw.Draw(img)
    display = " ".join(text.upper().split()) if st.get("tracking") else text
    lines = wrap(d, display, fnt, max_w)
    line_h = int(st["size"] * st["line"])
    block_h = line_h * len(lines)
    pad = 28

    if st.get("pill"):
        block_w = max(d.textbbox((0, 0), ln, font=fnt)[2] for ln in lines)
        y0 = {"center": (H - block_h) // 2, "lower-third": int(H * 0.72) - block_h // 2}[position]
        px0 = (W - block_w) // 2 - 44
        d.rounded_rectangle([px0, y0 - pad, W - px0, y0 + block_h + pad],
                            radius=(block_h + 2 * pad) // 2, fill=hx(st["pill"]))
    else:
        y0 = {"center": (H - block_h) // 2,
              "lower-third": int(H * 0.70) - block_h // 2,
              "center-low": int(H * 0.66) - block_h // 2,
              "upper-third": int(H * 0.16)}[position]

    y = y0
    for ln in lines:
        w_ = d.textbbox((0, 0), ln, font=fnt)[2]
        kwargs = {}
        if st.get("stroke"):
            kwargs = dict(stroke_width=5, stroke_fill=hx(st["stroke"]))
        d.text(((W - w_) // 2, y), ln, font=fnt, fill=hx(st["color"]), **kwargs)
        y += line_h
    return img


# ---------------------------------------------------------------- backgrounds
def gradient_bg(token):
    a, b, glow = {
        "brand-dark-1": (PAL["graphite"], "#1A1420", PAL["accent"]),
        "brand-dark-2": (PAL["panel"], PAL["graphite"], PAL["mint"]),
    }[token]
    col = Image.new("RGB", (1, H))
    ca, cb = hx(a), hx(b)
    for y in range(H):
        t = y / (H - 1)
        col.putpixel((0, y), tuple(int(ca[i] + (cb[i] - ca[i]) * t) for i in range(3)))
    img = col.resize((W, H))
    # faint accent glow, bottom corner
    glow_img = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow_img)
    g = hx(glow)
    gd.ellipse([W - 700, H - 600, W + 400, H + 500],
               fill=tuple(int(c * 0.22) for c in g))
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(180))
    from PIL import ImageChops
    return ImageChops.screen(img, glow_img)


def screenshot_bg(pick, with_text_below):
    """Brand screenshot in a rounded card on graphite; leaves the lower
    area clear when a text block shares the slide."""
    img = gradient_bg("brand-dark-1")
    shot = Image.open(ROOT / BRAND["screenshots"][pick]).convert("RGB")
    card_w = 920
    card_h = int(shot.height * card_w / shot.width)
    max_h = int(H * 0.52) if with_text_below else int(H * 0.72)
    if card_h > max_h:
        card_h = max_h
    shot = shot.resize((card_w, int(shot.height * card_w / shot.width)))
    shot = shot.crop((0, 0, card_w, card_h))

    mask = Image.new("L", (card_w, card_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, card_w, card_h], radius=36, fill=255)
    x = (W - card_w) // 2
    y = int(H * 0.10) if with_text_below else (H - card_h) // 2
    # shadow
    sh = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([x + 10, y + 22, x + card_w + 10, y + card_h + 22],
                                         radius=36, fill=(0, 0, 0))
    img = Image.composite(sh.filter(ImageFilter.GaussianBlur(30)), img,
                          sh.convert("L").filter(ImageFilter.GaussianBlur(30)).point(lambda p: min(p, 140)))
    img.paste(shot, (x, y), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x, y, x + card_w, y + card_h], radius=36,
                        outline=hx(PAL["panelEdge"]), width=2)
    return img


def stock_bg(query):
    # Local stand-in: neutral gradient + provenance tag (no stock provider yet)
    img = gradient_bg("brand-dark-2")
    d = ImageDraw.Draw(img)
    tag = f"stock · {query}"
    fnt = font("mono", 26, 500)
    d.text((40, 40), tag, font=fnt, fill=hx(PAL["textDim"]))
    return img


def render_bg(bg, with_text=False):
    if bg["kind"] == "gradient":
        return gradient_bg(bg["styleToken"])
    if bg["kind"] == "brand_screenshot":
        return screenshot_bg(bg["pick"], with_text)
    if bg["kind"] == "stock":
        return stock_bg(bg["query"])
    raise ValueError(bg["kind"])


def compose_slide(bg, text_spec, values):
    with_text = text_spec is not None
    img = render_bg(bg, with_text)
    if with_text:
        pos = text_spec["position"]
        if bg["kind"] == "brand_screenshot" and pos == "center":
            pos = "lower-third"  # keep text off the card
        img = draw_text_block(img, values[text_spec["slotRef"]], text_spec["styleToken"], pos)
    return img


# ---------------------------------------------------------------- tts + captions
def tts(text, voice, out_wav):
    aiff = out_wav.with_suffix(".aiff")
    subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff),
                    "-ar", "44100", str(out_wav)], check=True)
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(out_wav)], capture_output=True, text=True).stdout.strip())
    aiff.unlink()
    return dur


def caption_chunks(script, total, max_words=5):
    """Stand-in pacing: proportional by word count. Production paces from
    FAL TTS word timestamps."""
    words = script.split()
    chunks, i = [], 0
    while i < len(words):
        chunk = words[i:i + max_words]
        # don't orphan a single word
        if len(words) - (i + max_words) == 1:
            chunk = words[i:i + max_words - 1]
        chunks.append(" ".join(chunk))
        i += len(chunk)
    t, out = 0.0, []
    for c in chunks:
        d = total * len(c.split()) / len(words)
        out.append((t, t + d, c))
        t += d
    return out


# ---------------------------------------------------------------- video assembly
def assemble(frames, audio_wav, audio_delay, out_mp4):
    """frames: list of (png_path, duration_seconds)"""
    lst = out_mp4.with_suffix(".txt")
    lines = []
    for p, d in frames:
        lines.append(f"file '{p}'")
        lines.append(f"duration {d:.3f}")
    lines.append(f"file '{frames[-1][0]}'")
    lst.write_text("\n".join(lines))
    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-f", "concat", "-safe", "0", "-i", str(lst),
           "-itsoffset", f"{audio_delay:.3f}", "-i", str(audio_wav),
           "-map", "0:v", "-map", "1:a",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
           "-c:a", "aac", "-b:a", "128k", str(out_mp4)]
    subprocess.run(cmd, check=True)
    lst.unlink()


def segment_timeline(shot_spans, caption_spans, total):
    """Split [0,total] wherever a shot or caption boundary falls."""
    cuts = {0.0, total}
    for s, e, _ in shot_spans:
        cuts.update([s, e])
    for s, e, _ in caption_spans:
        cuts.update([s, e])
    cuts = sorted(c for c in cuts if 0 <= c <= total)
    segs = []
    for a, b in zip(cuts, cuts[1:]):
        if b - a < 0.05:
            continue
        mid = (a + b) / 2
        shot = next(sh for s, e, sh in shot_spans if s <= mid < e)
        cap = next((c for s, e, c in caption_spans if s <= mid < e), None)
        segs.append((a, b, shot, cap))
    return segs


# ---------------------------------------------------------------- formats
def render_slideshow(tpl, concept, outdir):
    values = concept["slotValues"]
    outdir.mkdir(parents=True, exist_ok=True)
    files = []
    for i, slide in enumerate(tpl["renderPlan"]["slides"], 1):
        img = compose_slide(slide["bg"], slide.get("text"), values)
        f = outdir / f"slide_{i}.png"
        img.save(f)
        files.append(f.name)
    (outdir / "post.json").write_text(json.dumps({
        "format": "slideshow", "platforms": tpl["platforms"],
        "caption": values["caption"],
        "music": tpl["renderPlan"]["music"], "slides": files}, indent=2))
    print(f"  {len(files)} slides -> {outdir}")


def render_hook_video(tpl, concept, outdir):
    values = concept["slotValues"]
    outdir.mkdir(parents=True, exist_ok=True)
    plan = tpl["renderPlan"]
    vo_dur = tts(values["vo_script"], "Samantha", outdir / "vo.wav")

    fixed = sum(s.get("holdSeconds", 0) for s in plan["shots"])
    flex_dur = max(1.0, vo_dur - fixed + 1.0)  # VO starts under the hook, ends on the cta card
    total = fixed + flex_dur
    cap = plan.get("durationCapSeconds", 60)
    assert total <= cap, f"rendered duration {total:.1f}s exceeds cap {cap}s"

    shot_spans, t = [], 0.0
    for s in plan["shots"]:
        d = flex_dur if s.get("flex") else s["holdSeconds"]
        shot_spans.append((t, t + d, s))
        t += d
    caption_spans = caption_chunks(values["vo_script"], vo_dur)

    frames = []
    for i, (a, b, shot, cap_text) in enumerate(segment_timeline(shot_spans, caption_spans, total)):
        img = compose_slide(shot["bg"], shot.get("text"), values)
        if cap_text and not shot.get("text"):  # captions yield to full-screen cards
            img = draw_text_block(img, cap_text, plan["captions"]["styleToken"],
                                  plan["captions"]["position"])
        f = outdir / f"seg_{i:02d}.png"
        img.save(f)
        frames.append((f, b - a))
    assemble(frames, outdir / "vo.wav", 0.0, outdir / "post.mp4")
    (outdir / "post.json").write_text(json.dumps({
        "format": "hook_video", "platforms": tpl["platforms"],
        "caption": values["caption"], "music": plan["music"],
        "voDurationSeconds": round(vo_dur, 2), "totalSeconds": round(total, 2)}, indent=2))
    print(f"  {total:.1f}s video ({vo_dur:.1f}s VO) -> {outdir / 'post.mp4'}")


def avatar_placeholder():
    """Stand-in for the FAL-side character frame (lipsync is lazy, on
    right-swipe). Validates the layout around the character, not the character."""
    img = gradient_bg("brand-dark-1")
    d = ImageDraw.Draw(img)
    cx, cy, r = W // 2, int(H * 0.46), 300
    for i, alpha in ((60, 40), (0, 255)):
        d.ellipse([cx - r - i, cy - r - i, cx + r + i, cy + r + i],
                  outline=hx(PAL["accent"]), width=3 if i else 0,
                  fill=None if i else hx(PAL["panel"]))
    # simple bust silhouette
    d.ellipse([cx - 110, cy - 190, cx + 110, cy + 30], fill=hx(PAL["panelEdge"]))
    d.ellipse([cx - 210, cy + 60, cx + 210, cy + 320], fill=hx(PAL["panelEdge"]))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=hx(PAL["accent"]), width=4)
    tag = "stock character · lipsync renders on right-swipe (FAL)"
    d.text((40, H - 80), tag, font=font("mono", 26, 500), fill=hx(PAL["textDim"]))
    return img


def render_avatar(tpl, concept, outdir):
    values = concept["slotValues"]
    outdir.mkdir(parents=True, exist_ok=True)
    plan = tpl["renderPlan"]
    vo_dur = tts(values["vo_script"], "Daniel", outdir / "vo.wav")
    end_hold = plan["endCard"]["holdSeconds"]
    total = vo_dur + end_hold
    cap = plan.get("durationCapSeconds", 60)
    assert total <= cap, f"rendered duration {total:.1f}s exceeds cap {cap}s"

    base = avatar_placeholder()
    caption_spans = caption_chunks(values["vo_script"], vo_dur)
    overlay_until = plan["overlay"]["showSeconds"]

    frames = []
    i = 0
    for a, b, cap_text in caption_spans:
        img = base.copy()
        if a < overlay_until:
            img = draw_text_block(img, values[plan["overlay"]["slotRef"]],
                                  plan["overlay"]["styleToken"], plan["overlay"]["position"])
        img = draw_text_block(img, cap_text, plan["captions"]["styleToken"],
                              plan["captions"]["position"])
        f = outdir / f"seg_{i:02d}.png"
        img.save(f)
        frames.append((f, b - a))
        i += 1
    endcard = compose_slide(plan["endCard"]["bg"], plan["endCard"]["text"], values)
    f = outdir / f"seg_{i:02d}.png"
    endcard.save(f)
    frames.append((f, end_hold))

    assemble(frames, outdir / "vo.wav", 0.0, outdir / "post.mp4")
    (outdir / "post.json").write_text(json.dumps({
        "format": "avatar", "platforms": tpl["platforms"],
        "caption": values["caption"], "character": plan["character"],
        "voDurationSeconds": round(vo_dur, 2), "totalSeconds": round(total, 2)}, indent=2))
    print(f"  {total:.1f}s video ({vo_dur:.1f}s VO) -> {outdir / 'post.mp4'}")


RENDERERS = {"slideshow": render_slideshow, "hook_video": render_hook_video,
             "avatar": render_avatar}


def main():
    templates = {}
    for p in (ROOT / "templates").glob("*.json"):
        t = json.loads(p.read_text())
        templates[t["slug"]] = t
    for p in sorted((ROOT / "concepts").glob("*.json")):
        concept = json.loads(p.read_text())
        tpl = templates[concept["template"]]
        print(f"render {p.stem} [{tpl['format']}]")
        RENDERERS[tpl["format"]](tpl, concept, OUT / p.stem)


if __name__ == "__main__":
    main()
