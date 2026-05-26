FROM node:20-alpine AS base
RUN npm install -g pnpm

# ─── Dependencias (todas, incluyendo devDeps para prisma) ─────
FROM base AS deps
WORKDIR /app
COPY package.json ./
RUN NODE_ENV=development pnpm install --no-frozen-lockfile

# ─── Build ────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npx nest build

# ─── Producción ───────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma
COPY package.json ./

EXPOSE 4000

CMD sh -c "npx prisma db push --skip-generate && node dist/main"
