# صورة واحدة: Node.js + Xvfb + PulseAudio + Chromium + ffmpeg + xdotool
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    DISPLAY=:99 \
    PORT=8080 \
    CHROMIUM_BIN=/usr/bin/chromium \
    FFMPEG_BIN=ffmpeg \
    XDOTOOL_BIN=xdotool

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      xvfb \
      xdotool \
      ffmpeg \
      pulseaudio \
      pulseaudio-utils \
      fonts-noto-core \
      fonts-noto-color-emoji \
      fonts-liberation \
      ca-certificates \
      tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .
RUN chmod +x scripts/entrypoint.sh \
    && mkdir -p /tmp/cb-downloads \
    && chown -R node:node /app /tmp/cb-downloads

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/entrypoint.sh"]
