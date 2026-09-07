"""Brand assets + composition primitives (ported from validation/template-spec).

Deterministic Pillow building blocks: fonts, style tokens, gradients,
screenshot cards, text blocks. Templates stay brand-neutral; this module
resolves style tokens against the brand palette (Broadcast defaults until
per-brand palettes ship).
"""
from __future__ import annotations

import io
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920

FONT_URLS = {
    "display": "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf",
    "body": "https://github.com/google/fonts/raw/main/ofl/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf",
    "mono": "https://github.com/google/fonts/raw/main/ofl/splinesansmono/SplineSansMono%5Bwght%5D.ttf",
}
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
    FONT_DIR.mkdir(exist_ok=True)
    for kind, url in FONT_URLS.items():
        dest = FONT_DIR / f"{kind}.ttf"
        if not dest.exists():
            with urllib.request.urlopen(url, timeout=60) as resp:
                dest.write_bytes(resp.read())


_font_cache: dict = {}


def font(kind: str, size: int, wght: int | None = None, wdth: int | None = None):
    ensure_fonts()
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

    y = y0
    for ln in lines:
        w_ = d.textbbox((0, 0), ln, font=fnt)[2]
        kwargs = {}
        if st.get("stroke"):
            kwargs = dict(stroke_width=5, stroke_fill=hx(st["stroke"]))
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
