FROM node:20-alpine AS base
RUN npm install -g pnpm

# ─── Instalar dependencias de la API ─────────────────────────
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

# ─── Imagen final de producción ──────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma
COPY apps/api/package.json            ./package.json

EXPOSE 4000

CMD sh -c "node_modules/.bin/prisma db push --skip-generate && node dist/main"
