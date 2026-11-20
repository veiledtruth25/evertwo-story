# syntax=docker/dockerfile:1

# --- whisper.cpp for Linux (caption timing). Skipped when WITH_WHISPER=0. ---
FROM node:22-bookworm AS whisper
ARG WITH_WHISPER=1
ARG WHISPER_REF=v1.7.6
RUN apt-get update && apt-get install -y --no-install-recommends cmake git && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /out && if [ "$WITH_WHISPER" = "1" ]; then \
      git clone --depth 1 --branch "$WHISPER_REF" https://github.com/ggml-org/whisper.cpp /src \
      && cd /src \
      && cmake -B build -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF \
      && cmake --build build -j2 --target whisper-cli \
      && cp build/bin/whisper-cli /out/whisper-cli; \
    fi

# --- build the web app and the server bundle ---
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json vite.config.ts ./
COPY src ./src
RUN npm run typecheck && npm run build
RUN npm prune --omit=dev

# --- Piper: local text-to-speech (prebuilt binary, ships its own espeak-ng and onnxruntime) ---
FROM node:22-bookworm AS piper
ARG PIPER_TAG=2023.11.14-2
RUN set -eux; \
    case "$(uname -m)" in aarch64) A=aarch64 ;; x86_64) A=x86_64 ;; *) echo "arsitektur tidak didukung"; exit 1 ;; esac; \
    mkdir -p /out; \
    curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/piper_linux_${A}.tar.gz" | tar xz -C /out

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    RESOURCES_DIR=/app/resources \
    WEB_DIR=/app/out/web \
    WHISPER_BIN=/usr/local/bin/whisper-cli \
    PIPER_BIN=/opt/piper/piper
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/out ./out
COPY --from=build /app/package.json ./package.json
COPY resources/fonts ./resources/fonts
COPY --from=whisper /out/ /usr/local/bin/
COPY --from=piper /out/piper /opt/piper
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "out/server/index.cjs"]
