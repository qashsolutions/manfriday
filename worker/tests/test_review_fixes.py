"""Fixes from the 23 Nov 2026 product review: real site screens after the hook,
no invented numbers, the brief's trend space."""
from pathlib import Path

from PIL import Image, ImageDraw

from conftest import frame_at, probe, template, values_for
from pipeline.brief import Brief
from pipeline.scrape import slice_page
from pipeline.slots import HONESTY_RULES, _prompt
from render.assets import BrandAssets
from render.formats import page_index, render_hook

COLOURS = [(220, 40, 40), (40, 200, 60), (40, 80, 230), (230, 200, 40)]


def page_capture(height: int) -> Image.Image:
    """A fake phone capture: a coloured band per screen, with some 'text' so no
    section reads as blank."""
    img = Image.new("RGB", (1080, height), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for i in range(0, height, 1920):
        d.rectangle([0, i, 1080, min(height, i + 1920)], fill=COLOURS[(i // 1920) % 4])
        for y in range(i + 100, min(height, i + 1800), 120):
            d.rectangle([80, y, 900, y + 40], fill=(255, 255, 255))
    return img


def test_slice_page_cuts_screens_top_first_and_skips_blank_and_slivers():
    sections = slice_page(page_capture(1920 * 3 + 200))
    assert len(sections) == 3  # the 200px footer sliver is not a screen
    assert all(s.size == (1080, 1920) for s in sections)
    assert sections[0].getpixel((5, 5)) == COLOURS[0]
    assert sections[2].getpixel((5, 5)) == COLOURS[2]
    blank = Image.new("RGB", (1080, 1920 * 2), (250, 250, 250))
    assert slice_page(blank) == []
    # A capture at another width is scaled to 1080 first.
    assert slice_page(page_capture(1920).resize((390, 693)))[0].size == (1080, 1920)


def test_page_index_spreads_captures_evenly_over_a_span():
    b = BrandAssets(name="x", page_shots=[Path("a"), Path("b"), Path("c")])
    assert [page_index(b, t, 3.0, 12.0) for t in (3.0, 5.9, 6.1, 9.1, 11.9)] == [0, 0, 1, 2, 2]
    assert page_index(BrandAssets(name="x"), 5.0, 0.0, 10.0) is None


def test_hook_video_walks_down_the_site_full_bleed(tmp_path):
    shots = []
    for i, section in enumerate(slice_page(page_capture(1920 * 3))):
        p = tmp_path / f"page_{i}.png"
        section.save(p)
        shots.append(p)
    brand = BrandAssets(name="Demo App", page_shots=shots)
    t = template("bold-claim-hook-video")
    r = render_hook(t, values_for(t), brand, "en", tmp_path, False)
    dur = probe(r["video"])["duration"]
    hold = t["renderPlan"]["shots"][0]["holdSeconds"]
    end = t["renderPlan"]["shots"][-1]["holdSeconds"]
    early = frame_at(r["video"], hold + 0.3).getpixel((5, 200))
    late = frame_at(r["video"], dur - end - 0.3).getpixel((5, 200))
    # Full-bleed: the capture's own colour reaches the frame edge (no card on a gradient)…
    assert early[0] > 180 and early[1] < 90, f"first section not full-bleed: {early}"
    # …and the middle of the video moves on to later sections of the page.
    assert late != early and late[2] > 150, f"never left the first screen: {late}"


def test_slot_fill_prompt_forbids_invented_numbers_and_passes_facts():
    brief = {"name": "Instiora", "audience": ["school administrators"], "facts": ["Used by 40 schools"], "trend_niche": "edtech"}
    st = template("bold-claim-hook-video")
    t = {"id": "t1", "slug": st["slug"], "format": st["format"], "hookPattern": st["hookPattern"], "structure": st}
    prompt = _prompt(brief, "en", [(t, 0)])
    assert HONESTY_RULES in prompt
    assert "Used by 40 schools" in prompt
    assert "trend_niche" not in prompt  # internal routing, not creative input
    assert "never speak as one of the product's customers".lower() in HONESTY_RULES.lower()
    # No facts on the brief still tells the model there are none.
    assert '"facts": []' in _prompt({"name": "x"}, "en", [(t, 0)])


def test_cached_briefs_without_new_fields_still_load():
    b = Brief(name="x", one_liner="y", audience=["a"], tone=["t"], niche="edtech", language="en")
    assert b.facts == [] and b.trend_niche is None
    b2 = Brief(name="x", one_liner="y", audience=["a"], tone=["t"], niche="edtech", language="en", facts=["f"], trend_niche=None)
    assert b2.facts == ["f"]
