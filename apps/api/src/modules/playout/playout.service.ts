import {
  Injectable,
  Logger,
  OnModuleDestroy,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

interface PlayoutSession {
  channelId: string;
  process: ChildProcess | null;
  hlsDir: string;
  stopping: boolean;
  startedAt: Date;
  recentLogs: string[];   // últimas líneas de stderr de FFmpeg
  restarts: number;
}

const HLS_BASE = path.join('/tmp', 'cloudtv-hls');
const MAX_LOGS = 200;

@Injectable()
export class PlayoutService implements OnModuleDestroy {
  private readonly logger = new Logger(PlayoutService.name);
  private sessions = new Map<string, PlayoutSession>();

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
  ) {}

  async onModuleDestroy() {
    for (const session of this.sessions.values()) {
      this.killSession(session);
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  async start(channelId: string, userId: string): Promise<void> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Canal no encontrado');

    await this.stopInternal(channelId);

    const hlsDir = path.join(HLS_BASE, channelId);
    await fs.mkdir(hlsDir, { recursive: true });

    const session: PlayoutSession = {
      channelId,
      process: null,
      hlsDir,
      stopping: false,
      startedAt: new Date(),
      recentLogs: [],
      restarts: 0,
    };
    this.sessions.set(channelId, session);

    await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        status: 'STARTING',
        hlsUrl: `/api/playout/${channelId}/hls/index.m3u8`,
      },
    });

    this.launchFfmpeg(session).catch((err) => {
      this.logger.error(`[${channelId}] launch error: ${err.message}`);
    });
  }

  async stop(channelId: string, userId: string): Promise<void> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Canal no encontrado');
    await this.stopInternal(channelId);
  }

  isActive(channelId: string): boolean {
    return this.sessions.has(channelId);
  }

  /** Últimas N líneas de stderr de FFmpeg para este canal */
  getLogs(channelId: string): string[] {
    return this.sessions.get(channelId)?.recentLogs ?? [];
  }

  getStatus(channelId: string) {
    const s = this.sessions.get(channelId);
    if (!s) return null;
    return {
      active: true,
      startedAt: s.startedAt,
      restarts: s.restarts,
      pid: s.process?.pid ?? null,
    };
  }

  getHlsFilePath(channelId: string, filename: string): string | null {
    if (!/^[\w.-]+\.(m3u8|ts)$/.test(filename)) return null;
    return path.join(HLS_BASE, channelId, filename);
  }

  // ─── Internal ─────────────────────────────────────────────────

  private async stopInternal(channelId: string): Promise<void> {
    const session = this.sessions.get(channelId);
    if (session) {
      session.stopping = true;
      this.killSession(session);
      this.sessions.delete(channelId);
      try {
        await fs.rm(session.hlsDir, { recursive: true, force: true });
      } catch { /* no crítico */ }
    }
    await this.prisma.channel.update({
      where: { id: channelId },
      data: { status: 'OFFLINE', hlsUrl: null },
    });
  }

  private killSession(session: PlayoutSession) {
    if (session.process && !session.process.killed) {
      try { session.process.kill('SIGTERM'); } catch { /* ignorar */ }
    }
  }

  private async launchFfmpeg(session: PlayoutSession): Promise<void> {
    if (session.stopping) return;

    // ── 1. Playlist activa ─────────────────────────────────────
    const playlist = await this.getActivePlaylist(session.channelId);
    if (!playlist || !playlist.items.length) {
      this.log(session, 'ERROR: Sin playlist o sin videos READY. Abortando.');
      await this.prisma.channel.update({
        where: { id: session.channelId },
        data: { status: 'ERROR' },
      });
      return;
    }

    // ── 2. Construir concat.txt con presigned URLs ─────────────
    // Usamos presigned URLs (autenticadas, 24 h de validez) para evitar
    // cualquier problema de permisos en MinIO, independientemente de la
    // política del bucket.
    const concatPath = path.join(session.hlsDir, 'concat.txt');
    const lines: string[] = [];

    this.log(session, `Playlist: "${playlist.name}" — ${playlist.items.length} video(s)`);

    for (const item of playlist.items) {
      const key = item.video.processedKey ?? item.video.originalKey;
      if (!key) {
        this.log(session, `WARN: video ${item.video.id} sin key, omitiendo`);
        continue;
      }
      // Presigned URL válida 24 h → FFmpeg la usa como HTTP normal
      const url = await this.storage.getPresignedUrl(key, 86400);
      lines.push(`file '${url}'`);
      if (item.video.duration) {
        lines.push(`duration ${item.video.duration.toFixed(3)}`);
      }
      this.log(session, `  + ${key} (${item.video.duration?.toFixed(1) ?? '?'}s)`);
    }

    if (!lines.length) {
      this.log(session, 'ERROR: ningún video tiene key válida.');
      await this.prisma.channel.update({
        where: { id: session.channelId },
        data: { status: 'ERROR' },
      });
      return;
    }

    // NOTA: NO incluir header "ffconcat version 1.0" cuando se usa -f concat
    await fs.writeFile(concatPath, lines.join('\n') + '\n');
    this.log(session, `concat.txt escrito con ${lines.length / 2 | 0} entradas`);

    // ── 3. Args FFmpeg ─────────────────────────────────────────
    const preset = this.config.get('FFMPEG_PRESET', 'veryfast');
    const segPattern = path.join(session.hlsDir, 'seg%05d.ts');
    const indexPath  = path.join(session.hlsDir, 'index.m3u8');

    const args = [
      '-loglevel', 'warning',       // Mostrar solo warnings y errores
      '-re',                         // Leer a velocidad nativa (tiempo real)
      '-f', 'concat',
      '-safe', '0',
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-i', concatPath,
      // Normalizar resolución y fps
      '-vf', [
        'scale=1280:720:force_original_aspect_ratio=decrease',
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
        'fps=fps=25',
      ].join(','),
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', '23',
      '-b:v', '2000k',
      '-maxrate', '2500k',
      '-bufsize', '4000k',
      '-g', '50',                    // GOP = 2 seg a 25fps
      '-keyint_min', '50',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '10',
      '-hls_flags', 'delete_segments+append_list+independent_segments',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', segPattern,
      '-y',
      indexPath,
    ];

    this.log(session, `FFmpeg cmd: ffmpeg ${args.slice(0, 8).join(' ')} ...`);

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    session.process = proc;

    // Capturar TODO el stderr de FFmpeg
    proc.stderr.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed) this.log(session, `ffmpeg: ${trimmed}`);
      });
    });

    proc.on('spawn', () => {
      this.log(session, `FFmpeg PID=${proc.pid} arrancó. Esperando primer segmento...`);
      this.waitForM3u8(session, indexPath);
    });

    proc.on('close', (code, signal) => {
      this.log(session, `FFmpeg cerró (code=${code} signal=${signal})`);
      session.process = null;
      if (!session.stopping) {
        session.restarts++;
        this.log(session, `Reinicio #${session.restarts} en 3 s...`);
        setTimeout(() => this.launchFfmpeg(session), 3000);
      }
    });

    proc.on('error', async (err) => {
      this.log(session, `ERROR spawn: ${err.message}`);
      if (!session.stopping) {
        await this.prisma.channel.update({
          where: { id: session.channelId },
          data: { status: 'ERROR' },
        }).catch(() => {});
      }
    });
  }

  // ─── Esperar primer segmento ───────────────────────────────────

  private waitForM3u8(session: PlayoutSession, indexPath: string) {
    const MAX_MS = 120_000;   // 2 minutos máximo
    const POLL_MS = 2_000;
    const started = Date.now();

    const check = async () => {
      if (session.stopping) return;
      try {
        await fs.access(indexPath);
        if (!session.stopping) {
          await this.prisma.channel.update({
            where: { id: session.channelId },
            data: { status: 'LIVE_PLAYLIST' },
          });
          this.log(session, '✓ index.m3u8 listo → LIVE_PLAYLIST');
        }
      } catch {
        const elapsed = Date.now() - started;
        if (elapsed < MAX_MS) {
          this.log(session, `Esperando m3u8... ${Math.round(elapsed / 1000)}s`);
          setTimeout(check, POLL_MS);
        } else {
          this.log(session, `TIMEOUT: index.m3u8 no apareció en ${MAX_MS / 1000}s`);
          await this.prisma.channel.update({
            where: { id: session.channelId },
            data: { status: 'ERROR' },
          }).catch(() => {});
        }
      }
    };

    setTimeout(check, POLL_MS);
  }

  // ─── Helper log ───────────────────────────────────────────────

  private log(session: PlayoutSession, msg: string) {
    const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.mmm
    const line = `[${ts}] ${msg}`;
    session.recentLogs.push(line);
    if (session.recentLogs.length > MAX_LOGS) session.recentLogs.shift();
    this.logger.log(`[${session.channelId}] ${msg}`);
  }

  // ─── Playlist activa ──────────────────────────────────────────

  private async getActivePlaylist(channelId: string) {
    const now = new Date();
    const videoSelect = {
      id: true,
      originalKey: true,
      processedKey: true,
      duration: true,
      status: true,
    };
    const itemsInclude = {
      items: {
        where: { video: { status: 'READY' } },
        orderBy: { order: 'asc' as const },
        include: { video: { select: videoSelect } },
      },
    };

    // 1. Programa activo ahora
    const schedule = await this.prisma.schedule.findFirst({
      where: {
        channelId,
        playlistId: { not: null },
        startTime: { lte: now },
        endTime:   { gte: now },
      },
      orderBy: { priority: 'desc' },
      include: { playlist: { include: itemsInclude } },
    });
    if (schedule?.playlist?.items?.length) return schedule.playlist;

    // 2. Default playlist
    const def = await this.prisma.playlist.findFirst({
      where: { channelId, isDefault: true },
      include: itemsInclude,
    });
    if (def?.items?.length) return def;

    // 3. Primera playlist
    return this.prisma.playlist.findFirst({
      where: { channelId },
      include: itemsInclude,
    });
  }
}
