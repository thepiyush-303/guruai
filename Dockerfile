# ============================================================
# GuruAI server — for a host that runs containers (Railway, Render, Fly).
# Serves /api and the WebSocket (/ws) on $PORT. The React app is deployed
# separately (client/ on Vercel). Vosk live captions are not included.
#
# Includes Chromium and the Noto fonts so "Download PDF" works, Indic
# scripts included. Mount a volume at /data to keep sessions and notes.
# ============================================================

# ── Build: compile TypeScript ─────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ── Run ───────────────────────────────────────────────────────
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PDF_BROWSER_PATH=/usr/bin/chromium \
    VANI_DB_PATH=/data/vani.db \
    NOTES_DIR=/data/notes \
    VOICE_PREVIEW_DIR=/data/voice-previews

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json vocab.txt ./
RUN mkdir -p /data

# The platform sets PORT; 3000 when run by hand (docker run -p 3000:3000 …).
EXPOSE 3000
CMD ["node", "dist/server.js"]
