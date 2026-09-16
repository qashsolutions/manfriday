"""Brand assets + composition primitives (ported from validation/template-spec).

Deterministic Pillow building blocks: fonts, style tokens, gradients,
screenshot cards, text blocks. Templates stay brand-neutral; this module
resolves style tokens against the brand palette (Broadcast defaults until
per-brand palettes ship).
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920

FONT_URLS = {
    "display": "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf",
    "body": "https://github.com/google/fonts/raw/main/ofl/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf",
    "mono": "https://github.com/google/fonts/raw/main/ofl/splinesansmono/SplineSansMono%5Bwght%5D.ttf",
}
# D6 launch languages: the brand fonts are Latin-only, so every Indic script gets a
# Noto Sans face (variable wght/wdth, Latin glyphs included, so Hinglish-style
# code-mixed lines render in one font). Downloaded lazily, first use only.
# Shaping (conjuncts, matra reordering) needs Pillow built with libraqm — see
# worker/README fonts note; without it Indic text renders glyph-by-glyph.
SCRIPT_FONT_URLS = {
    "devanagari": "https://github.com/google/fonts/raw/main/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth%2Cwght%5D.ttf",
    "bengali": "https://github.com/google/fonts/raw/main/ofl/notosansbengali/NotoSansBengali%5Bwdth%2Cwght%5D.ttf",
    "gurmukhi": "https://github.com/google/fonts/raw/main/ofl/notosansgurmukhi/NotoSansGurmukhi%5Bwdth%2Cwght%5D.ttf",
    "gujarati": "https://github.com/google/fonts/raw/main/ofl/notosansgujarati/NotoSansGujarati%5Bwdth%2Cwght%5D.ttf",
    "oriya": "https://github.com/google/fonts/raw/main/ofl/notosansoriya/NotoSansOriya%5Bwdth%2Cwght%5D.ttf",
    "tamil": "https://github.com/google/fonts/raw/main/ofl/notosanstamil/NotoSansTamil%5Bwdth%2Cwght%5D.ttf",
    "telugu": "https://github.com/google/fonts/raw/main/ofl/notosanstelugu/NotoSansTelugu%5Bwdth%2Cwght%5D.ttf",
    "kannada": "https://github.com/google/fonts/raw/main/ofl/notosanskannada/NotoSansKannada%5Bwdth%2Cwght%5D.ttf",
    "malayalam": "https://github.com/google/fonts/raw/main/ofl/notosansmalayalam/NotoSansMalayalam%5Bwdth%2Cwght%5D.ttf",
}
# Unicode block → script font. Checked per text block; first Indic block found wins.
SCRIPT_RANGES = [
    ("devanagari", 0x0900, 0x097F),
    ("bengali", 0x0980, 0x09FF),
    ("gurmukhi", 0x0A00, 0x0A7F),
    ("gujarati", 0x0A80, 0x0AFF),
    ("oriya", 0x0B00, 0x0B7F),
    ("tamil", 0x0B80, 0x0BFF),
    ("telugu", 0x0C00, 0x0C7F),
    ("kannada", 0x0C80, 0x0CFF),
    ("malayalam", 0x0D00, 0x0D7F),
]


def script_of(text: str) -> str | None:
    """Return the Indic script name the text needs a fallback font for, or None."""
    for ch in text:
        o = ord(ch)
        for name, lo, hi in SCRIPT_RANGES:
            if lo <= o <= hi:
                return name
    return None
FONT_DIR = Path(__file__).resolve().parent.parent / ".fonts"

DEFAULT_PALETTE = {
    "graphite": "#0C0B10",
    "panel": "#14131A",
    "panelEdge": "#1F1D28",
    "accent": "#FF4D6D",
    "mint": "#45E0B0",
    "text": "#F4F3F7",
    "textDim": "#A5A1B2",
}


@dataclass
class BrandAssets:
    name: str
    screenshots: list[Path] = field(default_factory=list)  # [hero, product, ...]
    palette: dict = field(default_factory=lambda: dict(DEFAULT_PALETTE))
    presenter: Path | None = None  # the user's own photo (D2 amended 14 Sep 2026)
    voice: str = "female"  # brand presenter voice: "female" | "male" (Settings)

    def screenshot(self, pick: str) -> Path | None:
        order = {"hero": 0, "product": 1}
        idx = order.get(pick, 0)
        if idx < len(self.screenshots):
            return self.screenshots[idx]
        return self.screenshots[0] if self.screenshots else None


def hx(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return tuple(int(c[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def ensure_fonts() -> None:
    import requests  # certifi-backed TLS (macOS system Python's urllib lacks CAs)

    FONT_DIR.mkdir(exist_ok=True)
    for kind, url in FONT_URLS.items():
        dest = FONT_DIR / f"{kind}.ttf"
        if not dest.exists():
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            dest.write_bytes(r.content)


_font_cache: dict = {}


def ensure_script_font(script: str) -> Path:
    import requests

    FONT_DIR.mkdir(exist_ok=True)
    dest = FONT_DIR / f"{script}.ttf"
    if not dest.exists():
        r = requests.get(SCRIPT_FONT_URLS[script], timeout=60)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return dest


def font(kind: str, size: int, wght: int | None = None, wdth: int | None = None):
    ensure_fonts()
    if kind in SCRIPT_FONT_URLS:
        ensure_script_font(kind)
        # Noto Sans script faces stop at wght 900 / wdth 100; clamp the brand's 115.
        wdth = min(wdth, 100) if wdth else None
    key = (kind, size, wght, wdth)
    if key not in _font_cache:
        f = ImageFont.truetype(str(FONT_DIR / f"{kind}.ttf"), size)
        try:
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
            pass
        _font_cache[key] = f
    return _font_cache[key]


def resolve_token(token: str, pal: dict) -> dict:
    return {
        "hook-xl": dict(kind="display", size=88, wght=900, wdth=115, color=pal["text"], line=1.06),
        "hook-lg": dict(kind="display", size=68, wght=900, wdth=115, color=pal["text"], line=1.08),
        "body-lg": dict(kind="body", size=58, wght=600, color=pal["text"], line=1.22),
        "cta-md": dict(kind="display", size=48, wght=800, wdth=110, color=pal["graphite"], pill=pal["accent"], line=1.1),
        "caption-md": dict(kind="body", size=54, wght=600, color="#FFFFFF", stroke="#000000", line=1.15),
        "label-sm": dict(kind="mono", size=34, wght=500, color=pal["mint"], line=1.2, tracking=True),
    }[token]


def wrap(draw, text: str, fnt, max_w: int) -> list[str]:
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


def draw_text_block(img, text: str, token: str, position: str, pal: dict, max_w: int = 900):
    st = resolve_token(token, pal)
    script = script_of(text)
    # Indic text: same size/weight, Noto Sans face for that script (Latin included).
    fnt = font(script or st["kind"], st["size"], st.get("wght"), st.get("wdth"))
    d = ImageDraw.Draw(img)
    display = " ".join(text.upper().split()) if (st.get("tracking") and not script) else text
    lines = wrap(d, display, fnt, max_w)
    line_h = int(st["size"] * st["line"])
    block_h = line_h * len(lines)
    pad = 28

    if st.get("pill"):
        block_w = max(d.textbbox((0, 0), ln, font=fnt)[2] for ln in lines)
        y0 = {"center": (H - block_h) // 2, "lower-third": int(H * 0.72) - block_h // 2}[position]
        px0 = (W - block_w) // 2 - 44
        d.rounded_rectangle(
            [px0, y0 - pad, W - px0, y0 + block_h + pad],
            radius=(block_h + 2 * pad) // 2,
            fill=hx(st["pill"]),
        )
    else:
        y0 = {
            "center": (H - block_h) // 2,
            "lower-third": int(H * 0.70) - block_h // 2,
            "center-low": int(H * 0.66) - block_h // 2,
            "upper-third": int(H * 0.16),
        }[position]

    # Legibility (15 Sep 2026): white text is not always clear over screenshots,
    # photos or the lighter part of a gradient. Measure what sits behind the block;
    # if it is bright or busy, put a soft dark scrim behind the text. Always add a
    # subtle drop shadow to non-stroked text so it holds on mid-tones too.
    if not st.get("pill") and img.mode in ("RGB", "RGBA"):
        block_w = max(d.textbbox((0, 0), ln, font=fnt)[2] for ln in lines)
        bx0, bx1 = max(0, (W - block_w) // 2 - 36), min(W, (W + block_w) // 2 + 36)
        by0, by1 = max(0, y0 - 20), min(H, y0 + block_h + 20)
        region = img.crop((bx0, by0, bx1, by1)).convert("L")
        hist = region.histogram()
        n = max(1, sum(hist))
        mean = sum(i * c for i, c in enumerate(hist)) / n
        var = sum(c * (i - mean) ** 2 for i, c in enumerate(hist)) / n
        busy = var ** 0.5 > 38
        bright = mean > 96
        # transparent overlays (RGBA, alpha 0) are drawn onto photos/video later → always scrim
        transparent = img.mode == "RGBA" and img.getchannel("A").getextrema()[1] == 0
        if bright or busy or transparent:
            from PIL import Image as _Image, ImageDraw as _ImageDraw
            scrim = _Image.new("RGBA", img.size, (0, 0, 0, 0))
            _ImageDraw.Draw(scrim).rounded_rectangle([bx0, by0, bx1, by1], radius=24, fill=(12, 11, 16, 150 if not st.get("stroke") else 110))
            if img.mode == "RGBA":
                img = _Image.alpha_composite(img, scrim)
            else:
                img = _Image.alpha_composite(img.convert("RGBA"), scrim).convert("RGB")
            d = ImageDraw.Draw(img)

    y = y0
    for ln in lines:
        w_ = d.textbbox((0, 0), ln, font=fnt)[2]
        kwargs = {}
        if st.get("stroke"):
            kwargs = dict(stroke_width=5, stroke_fill=hx(st["stroke"]))
        else:
            d.text(((W - w_) // 2 + 3, y + 3), ln, font=fnt, fill=(0, 0, 0))  # shadow
        d.text(((W - w_) // 2, y), ln, font=fnt, fill=hx(st["color"]), **kwargs)
        y += line_h
    return img


def gradient_bg(token: str, pal: dict):
    a, b, glow = {
        "brand-dark-1": (pal["graphite"], "#1A1420", pal["accent"]),
        "brand-dark-2": (pal["panel"], pal["graphite"], pal["mint"]),
    }[token]
    col = Image.new("RGB", (1, H))
    ca, cb = hx(a), hx(b)
    for y in range(H):
        t = y / (H - 1)
        col.putpixel((0, y), tuple(int(ca[i] + (cb[i] - ca[i]) * t) for i in range(3)))
    img = col.resize((W, H))
    glow_img = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow_img)
    g = hx(glow)
    gd.ellipse([W - 700, H - 600, W + 400, H + 500], fill=tuple(int(c * 0.22) for c in g))
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(180))
    return ImageChops.screen(img, glow_img)


def screenshot_bg(brand: BrandAssets, pick: str, with_text_below: bool):
    img = gradient_bg("brand-dark-1", brand.palette)
    shot_path = brand.screenshot(pick)
    if shot_path is None:
        return img  # graceful: gradient-only when the brand has no screenshots
    shot = Image.open(shot_path).convert("RGB")
    card_w = 920
    max_h = int(H * 0.52) if with_text_below else int(H * 0.72)
    shot = shot.resize((card_w, int(shot.height * card_w / shot.width)))
    card_h = min(shot.height, max_h)
    shot = shot.crop((0, 0, card_w, card_h))

    mask = Image.new("L", (card_w, card_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, card_w, card_h], radius=36, fill=255)
    x = (W - card_w) // 2
    y = int(H * 0.10) if with_text_below else (H - card_h) // 2
    sh = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([x + 10, y + 22, x + card_w + 10, y + card_h + 22], radius=36, fill=(0, 0, 0))
    img = Image.composite(
        sh.filter(ImageFilter.GaussianBlur(30)),
        img,
        sh.convert("L").filter(ImageFilter.GaussianBlur(30)).point(lambda p: min(p, 140)),
    )
    img.paste(shot, (x, y), mask)
    ImageDraw.Draw(img).rounded_rectangle([x, y, x + card_w, y + card_h], radius=36, outline=hx(brand.palette["panelEdge"]), width=2)
    return img


def stock_bg(query: str, pal: dict):
    # templateSpec v1.1 F4: stock falls back to gradient (provider is a pre-M1 open item)
    return gradient_bg("brand-dark-2", pal)


def render_bg(bg: dict, brand: BrandAssets, with_text: bool = False):
    kind = bg["kind"]
    if kind == "gradient":
        return gradient_bg(bg["styleToken"], brand.palette)
    if kind == "brand_screenshot":
        return screenshot_bg(brand, bg.get("pick", "hero"), with_text)
    if kind == "stock":
        return stock_bg(bg.get("query", ""), brand.palette)
    raise ValueError(f"illegal bg kind {kind}")


def compose_slide(bg: dict, text_spec: dict | None, values: dict, brand: BrandAssets):
    with_text = text_spec is not None
    img = render_bg(bg, brand, with_text)
    if text_spec is not None:
        pos = text_spec["position"]
        if bg["kind"] == "brand_screenshot" and pos == "center":
            pos = "lower-third"
        img = draw_text_block(img, values[text_spec["slotRef"]], text_spec["styleToken"], pos, brand.palette)
    return img


def avatar_placeholder(brand: BrandAssets):
    """Character frame stand-in; lipsync is FAL-side, lazily on right-swipe."""
    pal = brand.palette
    img = gradient_bg("brand-dark-1", pal)
    d = ImageDraw.Draw(img)
    cx, cy, r = W // 2, int(H * 0.46), 300
    d.ellipse([cx - r - 60, cy - r - 60, cx + r + 60, cy + r + 60], outline=hx(pal["accent"]), width=3)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=hx(pal["panel"]))
    d.ellipse([cx - 110, cy - 190, cx + 110, cy + 30], fill=hx(pal["panelEdge"]))
    d.ellipse([cx - 210, cy + 60, cx + 210, cy + 320], fill=hx(pal["panelEdge"]))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=hx(pal["accent"]), width=4)
    return img


def presenter_frame(brand: BrandAssets):
    """9:16 frame from the presenter photo: cover-crop, face kept in the upper
    half, dark gradient at the bottom so captions read. Used for the preview
    thumbnail and as the still fed to the talking-head model (its output keeps
    the input aspect, so we hand it exactly 1080x1920)."""
    if not brand.presenter:
        return avatar_placeholder(brand)
    src = Image.open(brand.presenter).convert("RGB")
    sw, sh = src.size
    scale = max(W / sw, H / sh)
    src = src.resize((int(sw * scale) + 1, int(sh * scale) + 1))
    x0 = (src.width - W) // 2
    y0 = min(max(0, (src.height - H) // 3), src.height - H)  # bias upward: faces sit high
    img = src.crop((x0, y0, x0 + W, y0 + H))
    grad = Image.new("L", (1, H))
    for y in range(H):
        t = max(0.0, (y - H * 0.55) / (H * 0.45))
        grad.putpixel((0, y), int(200 * t))
    shade = Image.new("RGB", (W, H), hx(brand.palette["graphite"]))
    img.paste(shade, (0, 0), grad.resize((W, H)))
    return img
