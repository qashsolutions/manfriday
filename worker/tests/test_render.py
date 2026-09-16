from pathlib import Path

import PIL.features
import pytest

from conftest import frame_at, mean_volume_db, probe, template, values_for
from pipeline.match import plan_batch
from render.assets import draw_text_block, script_of, DEFAULT_PALETTE, W, H
from render.formats import contiguous_chunks, render_avatar, render_hook, render_slideshow
from PIL import Image


def assert_video(p: dict):
    assert p["has_audio"], "no audio track"
    assert (p["width"], p["height"]) == (1080, 1920)
    assert p["fps"] == "30/1"


def test_slideshow_is_narrated(brand, tmp_path):
    t = template("listicle-tools-slideshow")
    r = render_slideshow(t, values_for(t), brand, tmp_path, False, "en")
    p = probe(r["video"])
    assert_video(p)
    assert p["duration"] == pytest.approx(r["durationSeconds"], abs=0.2)
    assert mean_volume_db(r["video"]) > -40, "narration missing (silent slideshow)"
    # each slide holds at least as long as its line takes to say
    assert r["durationSeconds"] >= len(t["renderPlan"]["slides"]) * 0.8


def test_hook_video(brand, tmp_path):
    t = template("bold-claim-hook-video")
    r = render_hook(t, values_for(t), brand, "en", tmp_path, False)
    p = probe(r["video"])
    assert_video(p)
    assert p["duration"] <= t["renderPlan"]["durationCapSeconds"] + 0.2
    assert mean_volume_db(r["video"]) > -40


def test_presenter_video_uses_photo_then_product(presenter_brand, tmp_path):
    t = template("hot-take-avatar")
    r = render_avatar(t, values_for(t), presenter_brand, "en", tmp_path, False)
    p = probe(r["video"])
    assert_video(p)
    # hook = the warm presenter still; tail = brand gradient/screenshot (dark)
    hook = frame_at(r["video"], 0.8).resize((1, 1)).getpixel((0, 0))
    tail = frame_at(r["video"], p["duration"] - 1.0).resize((1, 1)).getpixel((0, 0))
    assert hook[0] > 120 and hook[0] > hook[2] + 40, f"hook frame is not the presenter photo: {hook}"
    assert sum(tail) < sum(hook), f"tail should cut away from the photo: {tail} vs {hook}"


def test_presenter_video_without_photo_still_renders(brand, tmp_path):
    t = template("hot-take-avatar")
    r = render_avatar(t, values_for(t), brand, "en", tmp_path, False)
    assert_video(probe(r["video"]))


def test_preview_is_free_and_still(presenter_brand, tmp_path):
    t = template("hot-take-avatar")
    r = render_avatar(t, values_for(t), presenter_brand, "en", tmp_path, True)
    assert "video" not in r and Path(r["thumb"]).exists()


def test_contiguous_chunks_close_gaps():
    out = contiguous_chunks([(0.2, 1.4, "a"), (1.9, 2.8, "b"), (3.5, 4.9, "c")], 6.0)
    assert out[0][0] == 0.0
    assert all(out[i][1] == out[i + 1][0] for i in range(len(out) - 1))
    assert out[-1][1] == 6.0


def test_no_presenter_concepts_without_photo():
    tmpl = [{"format": f, "engagementScore": 50, "niches": [], "structure": {"slots": [1]}} for f in ("slideshow", "hook_video", "avatar")]
    with_photo = [t["format"] for t, _ in plan_batch(tmpl, "x", 10, allow_avatar=True)]
    without = [t["format"] for t, _ in plan_batch(tmpl, "x", 10, allow_avatar=False)]
    assert "avatar" in with_photo
    assert "avatar" not in without
    assert len(without) == 10


@pytest.mark.parametrize("code,text", [
    ("hi", "6 महीने तक ₹0 कमाया, फिर एक चीज़ बदली"),
    ("ta", "4 TikTok ஒரே weekend-ல, அப்புறம் 5 மாசம்"),
    ("te", "నా weekend లో 4 TikToks చేశా"),
    ("bn", "ছয় মাসে শূন্য সাইনআপ"),
    ("kn", "ಆರು ತಿಂಗಳು ಶೂನ್ಯ"),
    ("ml", "ആറ് മാസം പൂജ്യം"),
    ("gu", "છ મહિના શૂન્ય"),
    ("pa", "ਛੇ ਮਹੀਨੇ ਜ਼ੀਰੋ"),
    ("or", "ଛଅ ମାସ ଶୂନ୍ୟ"),
    ("mr", "सहा महिने शून्य"),
])
def test_indic_text_renders_shaped(code, text):
    assert PIL.features.check("raqm"), "Pillow without libraqm — Indic text would render unshaped"
    script = script_of(text)
    assert script is not None
    # the script face is what gets used (not the Latin brand font)
    from render.assets import font, FONT_DIR
    f = font(script, 88, 900, 115)
    assert Path(f.path).name == f"{script}.ttf" and (FONT_DIR / f"{script}.ttf").exists()
    # the fallback is wired into draw_text_block: output differs from drawing the same
    # text with the Latin-only display font (which produces tofu boxes)
    dark = (12, 11, 16)
    shaped = draw_text_block(Image.new("RGB", (W, H), dark), text, "hook-xl", "center", DEFAULT_PALETTE)
    latin = Image.new("RGB", (W, H), dark)
    from PIL import ImageDraw
    d = ImageDraw.Draw(latin)
    d.text((90, H // 2), text, font=font("display", 88, 900, 115), fill=(244, 243, 247))
    assert shaped.tobytes() != latin.tobytes()
    assert shaped.crop((0, H // 2 - 200, W, H // 2 + 200)).convert("L").getextrema()[1] > 200, "no glyphs drawn"


def test_fake_tts_scales_with_script(tmp_path):
    from render.tts import get_tts
    short = get_tts().synthesize("Hi.", "en", tmp_path)
    (tmp_path / "b").mkdir()
    long = get_tts().synthesize("This is a much longer sentence that should take noticeably more time to say aloud.", "en", tmp_path / "b")
    assert long.duration > short.duration
    assert long.chunks[0][0] == 0.0 and long.chunks[-1][1] == pytest.approx(long.duration, abs=0.01)
