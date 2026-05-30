FROM node:20-slim AS base
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
FROM node:20-slim AS runner
# Instalar FFmpeg + OpenSSL + fuentes DejaVu (drawtext) + cliente de postgres + curl
# yt-dlp: se descarga el binario standalone para Linux x86_64 (~15 MB, Python incluido).
# Necesario para extraer la URL directa de streams YouTube Live en el módulo de ingesta.
RUN apt-get update && \
    apt-get install -y ffmpeg openssl postgresql-client fonts-dejavu-core curl python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp via pip (soporta plugins externos) + plugin oauth2 para YouTube
# El plugin yt-dlp-oauth2 de coletdjnz restaura el Device Authorization Flow con
# client IDs actualizados, eludiendo la revocación de los IDs internos de yt-dlp.
RUN pip3 install --break-system-packages yt-dlp
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
