import {
  Injectable,
  Logger,
  OnModuleDestroy,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
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
}

const HLS_BASE = path.join('/tmp', 'cloudtv-hls');

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

    // Si ya hay una sesión activa la detenemos primero
    await this.stopInternal(channelId);

    const hlsDir = path.join(HLS_BASE, channelId);
    await fs.mkdir(hlsDir, { recursive: true });

    const session: PlayoutSession = {
      channelId,
      process: null,
      hlsDir,
      stopping: false,
      startedAt: new Date(),
    };
    this.sessions.set(channelId, session);

    // Actualizar DB antes de lanzar FFmpeg
    await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        status: 'STARTING',
        hlsUrl: `/api/playout/${channelId}/hls/index.m3u8`,
      },
    });

    // Lanzar FFmpeg (no bloqueante)
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

  getHlsFilePath(channelId: string, filename: string): string | null {
    // Validación de seguridad: solo .m3u8 y .ts
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
      // Limpiar segmentos HLS
      try {
        await fs.rm(session.hlsDir, { recursive: true, force: true });
      } catch {
        // no crítico
      }
    }
    await this.prisma.channel.update({
      where: { id: channelId },
      data: { status: 'OFFLINE', hlsUrl: null },
    });
  }

  private killSession(session: PlayoutSession) {
    if (session.process && !session.process.killed) {
      try {
        session.process.kill('SIGTERM');
      } catch { /* ignorar */ }
    }
  }

  private async launchFfmpeg(session: PlayoutSession): Promise<void> {
    if (session.stopping) return;

    // ── 1. Obtener playlist activa ──────────────────────────────
    const playlist = await this.getActivePlaylist(session.channelId);
    if (!playlist || !playlist.items.length) {
      this.logger.warn(`[${session.channelId}] Sin playlist/videos. Playout abortado.`);
      await this.prisma.channel.update({
        where: { id: session.channelId },
        data: { status: 'ERROR' },
      });
      return;
    }

    // ── 2. Construir concat.txt ─────────────────────────────────
    const concatPath = path.join(session.hlsDir, 'concat.txt');
    const lines: string[] = ['ffconcat version 1.0'];

    for (const item of playlist.items) {
      const key = item.video.processedKey ?? item.video.originalKey;
      if (!key) continue;
      const url = this.storage.getInternalUrl(key);
      lines.push(`file '${url}'`);
      if (item.video.duration) {
        lines.push(`duration ${item.video.duration.toFixed(3)}`);
      }
    }

    await fs.writeFile(concatPath, lines.join('\n') + '\n');
    this.logger.log(
      `[${session.channelId}] concat.txt listo (${playlist.items.length} videos)`,
    );

    // ── 3. Comando FFmpeg ───────────────────────────────────────
    const preset = this.config.get('FFMPEG_PRESET', 'veryfast');
    const segPattern = path.join(session.hlsDir, 'seg%05d.ts');
    const indexPath = path.join(session.hlsDir, 'index.m3u8');

    const args = [
      '-re',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      // Normalizar a 1280x720, 25fps, fondo negro si hay pillarbox
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,' +
             'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=fps=25',
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', '23',
      '-b:v', '2000k',
      '-maxrate', '2500k',
      '-bufsize', '4000k',
      '-x264-params', 'keyint=50:min-keyint=50',   // GOP fijo para HLS
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

    this.logger.log(`[${session.channelId}] Iniciando FFmpeg...`);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    session.process = proc;

    proc.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line.includes('time=') || line.includes('Error') || line.includes('error')) {
        this.logger.verbose(`[playout ${session.channelId}] ${line}`);
      }
    });

    proc.stdout.on('data', () => { /* ignorar */ });

    proc.on('spawn', async () => {
      // Marcar como LIVE en cuanto FFmpeg arranca
      if (!session.stopping) {
        await this.prisma.channel.update({
          where: { id: session.channelId },
          data: { status: 'LIVE_PLAYLIST' },
        }).catch(() => {});
        this.logger.log(`[${session.channelId}] Canal en LIVE_PLAYLIST`);
      }
    });

    proc.on('close', (code) => {
      this.logger.log(
        `[${session.channelId}] FFmpeg cerró (code=${code})`,
      );
      session.process = null;

      if (!session.stopping) {
        // Reiniciar (loop)
        this.logger.log(`[${session.channelId}] Reiniciando playout (loop)...`);
        setTimeout(() => this.launchFfmpeg(session), 2000);
      }
    });

    proc.on('error', async (err) => {
      this.logger.error(
        `[${session.channelId}] FFmpeg error: ${err.message}`,
      );
      if (!session.stopping) {
        await this.prisma.channel.update({
          where: { id: session.channelId },
          data: { status: 'ERROR' },
        }).catch(() => {});
      }
    });
  }

  // ─── Buscar playlist activa ────────────────────────────────────

  private async getActivePlaylist(channelId: string) {
    const now = new Date();

    // 1. Programa activo ahora mismo
    const activeSchedule = await this.prisma.schedule.findFirst({
      where: {
        channelId,
        playlistId: { not: null },
        startTime: { lte: now },
        endTime: { gte: now },
      },
      orderBy: { priority: 'desc' },
      include: {
        playlist: {
          include: {
            items: {
              where: { video: { status: 'READY' } },
              orderBy: { order: 'asc' },
              include: {
                video: {
                  select: {
                    id: true,
                    originalKey: true,
                    processedKey: true,
                    duration: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (activeSchedule?.playlist?.items?.length) {
      this.logger.log(
        `[${channelId}] Usando playlist del programa: "${activeSchedule.playlist.name}"`,
      );
      return activeSchedule.playlist;
    }

    // 2. Playlist default del canal
    const defaultPl = await this.prisma.playlist.findFirst({
      where: { channelId, isDefault: true },
      include: {
        items: {
          where: { video: { status: 'READY' } },
          orderBy: { order: 'asc' },
          include: {
            video: {
              select: {
                id: true,
                originalKey: true,
                processedKey: true,
                duration: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (defaultPl?.items?.length) {
      this.logger.log(
        `[${channelId}] Usando playlist default: "${defaultPl.name}"`,
      );
      return defaultPl;
    }

    // 3. Primera playlist disponible
    return this.prisma.playlist.findFirst({
      where: { channelId },
      include: {
        items: {
          where: { video: { status: 'READY' } },
          orderBy: { order: 'asc' },
          include: {
            video: {
              select: {
                id: true,
                originalKey: true,
                processedKey: true,
                duration: true,
                status: true,
              },
            },
          },
        },
      },
    });
  }
}
