# Man Friday render worker — Railway deploy target.
# Build context is the worker/ directory.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Production TTS runs on FAL (macOS `say` is dev-only)
ENV TTS_PROVIDER=fal

CMD ["python", "main.py"]
