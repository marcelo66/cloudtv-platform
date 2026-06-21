FROM node:20-alpine AS base
RUN npm install -g pnpm

# ─── Dependencias ─────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ─── Build ────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

# ─── Producción ───────────────────────────────────────────────
FROM node:20-alpine AS runner
# Instalar FFmpeg (necesario para procesamiento de video)
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma
COPY package.json ./

EXPOSE 4000

# Al arrancar: primero crea/actualiza las tablas en la BD, luego inicia
CMD sh -c "npx prisma db push --skip-generate && node dist/main"
