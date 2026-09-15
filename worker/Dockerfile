# Man Friday render worker — Railway deploy target.
# Build context is the worker/ directory (Railway service "Root Directory" = worker).
FROM python:3.12-slim

# ffmpeg: video assembly. libfribidi0 + libharfbuzz0b: the Pillow manylinux wheel
# bundles libraqm and loads fribidi/harfbuzz at runtime — without them Indic text
# (D6: hi, bn, ta, te, mr, kn, ml, gu, pa, or) renders unshaped (see CLAUDE.md D6).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libfribidi0 libharfbuzz0b ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Fail the build, not the first render, if shaping support is missing.
RUN python -c "import PIL.features as f; assert f.check('raqm'), 'Pillow without libraqm'"

# Bake the brand fonts + all Indic script faces into the image so a replica never
# fetches from GitHub at render time.
RUN python -c "from render.assets import ensure_fonts, ensure_script_font, SCRIPT_FONT_URLS; ensure_fonts(); [ensure_script_font(s) for s in SCRIPT_FONT_URLS]"

# Production TTS runs on FAL (macOS `say` is dev-only); Indic goes to Sarvam when SARVAM_API_KEY is set.
ENV TTS_PROVIDER=fal \
    FAL_TTS_VOICE=Rachel \
    PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
