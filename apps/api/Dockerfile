FROM node:22-slim AS base
RUN npm install -g pnpm

# ─── Instalar dependencias ────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY apps/api/package.json ./package.json
RUN NODE_ENV=development pnpm install --no-frozen-lockfile

# ─── Compilar ────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/ .
RUN ./node_modules/.bin/prisma generate
RUN ./node_modules/.bin/nest build

# ─── Imagen final ─────────────────────────────────────────────
FROM node:22-slim AS runner
# Instalar FFmpeg + OpenSSL + fuentes DejaVu (drawtext) + cliente de postgres + curl
# yt-dlp: se descarga el binario standalone para Linux x86_64 (~15 MB, Python incluido).
# Necesario para extraer la URL directa de streams YouTube Live en el módulo de ingesta.
RUN apt-get update && \
    apt-get install -y ffmpeg openssl postgresql-client fonts-dejavu-core curl python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

# yt-dlp con EJS solver (yt-dlp-ejs) para resolver el n-challenge de YouTube.
# Node.js 22+ (del base image) se usa como JS runtime para ejecutar el solver.
RUN pip3 install --break-system-packages --no-cache-dir 'yt-dlp[default]' --upgrade
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma
COPY apps/api/package.json            ./package.json

EXPOSE 4000

# Espera a que Postgres esté listo, luego crea las tablas y arranca
CMD sh -c "\
  echo 'Esperando base de datos...' && \
  until pg_isready -h ${DB_HOST:-postgres} -p 5432 -q; do sleep 2; done && \
  echo 'Conectado. Creando tablas...' && \
  node_modules/.bin/prisma db push --skip-generate && \
  echo 'Iniciando API...' && \
  node dist/main"
