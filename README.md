# CloudTV Platform — Streaming 24/7

Plataforma profesional de Cloud TV con playout automatizado.

## Inicio rápido

### 1. Prerrequisitos
- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

### 2. Configuración inicial

```bash
# Clonar / descargar el proyecto
cd cloudtv-platform

# Copiar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# Instalar dependencias
pnpm install
```

### 3. Levantar servicios de infraestructura

```bash
# Levanta: PostgreSQL, Redis, MinIO, MediaMTX
pnpm docker:dev
```

Servicios disponibles:
| Servicio | URL |
|---|---|
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |
| MinIO (S3 local) | http://localhost:9000 |
| MinIO Console | http://localhost:9001 (admin/admin123) |
| MediaMTX RTMP | rtmp://localhost:1935/live/{key} |
| MediaMTX HLS | http://localhost:8888/live/{slug}/index.m3u8 |

### 4. Configurar la base de datos

```bash
cd apps/api

# Copiar .env
cp ../../.env .env

# Generar cliente Prisma y crear tablas
pnpm db:push

# (Opcional) Abrir Prisma Studio
pnpm db:studio
```

### 5. Iniciar el backend

```bash
cd apps/api
pnpm dev
# API disponible en http://localhost:4000/api
# Swagger docs en http://localhost:4000/api/docs
```

### 6. Iniciar el frontend

```bash
cd apps/frontend

# Crear .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:4000/api" > .env.local

pnpm dev
# Panel en http://localhost:3000
```

## Estructura del proyecto

```
cloudtv-platform/
├── apps/
│   ├── api/          # NestJS backend
│   └── frontend/     # Next.js dashboard
├── infrastructure/
│   ├── docker-compose.dev.yml
│   ├── nginx/
│   └── mediamtx/
└── .env.example
```

## Módulos implementados (V1 — Base)

- [x] Autenticación JWT (login, register, refresh, logout)
- [x] Multi-tenant (canales por usuario)
- [x] Dashboard con estadísticas
- [x] Gestión de canales (crear, listar, configurar)
- [x] Stream key management
- [x] UI profesional dark mode

## Próximos módulos

- [ ] Upload de videos (chunked upload → R2/MinIO)
- [ ] Procesamiento FFmpeg (thumbnails, metadata, transcode)
- [ ] Playlists con drag & drop
- [ ] Motor de playout 24/7
- [ ] RTMP ingest desde OBS
- [ ] Overlays (logo, texto, reloj)
- [ ] Multi-output (YouTube, Facebook)
