import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoStatus } from '@prisma/client';
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
  recentLogs: string[];
  restarts: number;
}

const HLS_BASE = path.join('/tmp', 'cloudtv-hls');
const MAX_LOGS = 300;

@Injectable()
export class PlayoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlayoutService.name);
  private sessions = new Map<string, PlayoutSession>();

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
  ) {}

  /**
   * Al iniciar el módulo, cualquier canal que quedó en estado activo
   * (de un deploy anterior) se resetea a OFFLINE, porque los archivos
   * HLS en /tmp y los procesos FFmpeg ya no existen.
   */
  async onModuleInit() {
    try {
      const stale = await this.prisma.channel.updateMany({
        where: { status: { in: ['STARTING', 'LIVE_PLAYLIST', 'LIVE_RTMP'] } },
        data: { status: 'OFFLINE', hlsUrl: null },
      });
      if (stale.count > 0) {
        this.logger.log(`Reseteados ${stale.count} canal(es) activos → OFFLINE (redeploy)`);
      }
    } catch (err) {
      this.logger.warn(`No se pudo resetear canales al inicio: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    for (const session of this.sessions.values()) {
      this.killSession(session);
    }
  }

  // ─── Public API ────────────────────────────────────────────────

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

    // No bloqueante
    this.launchFfmpeg(session).catch((err) => {
      this.log(session, `ERROR en launchFfmpeg: ${err.message}`);
    });
  }

  async stop(channelId: string, userId: string): Promise<void> {
    // Verificar que el canal existe (no que sea LIVE — puede estar en STARTING)
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Canal no encontrado');
    await this.stopInternal(channelId);
  }

  getLogs(channelId: string): string[] {
    return this.sessions.get(channelId)?.recentLogs ?? [];
  }

  getStatus(channelId: string) {
    const s = this.sessions.get(channelId);
    if (!s) return null;
    return { active: true, startedAt: s.startedAt, restarts: s.restarts, pid: s.process?.pid ?? null };
  }

  getHlsFilePath(channelId: string, filename: string): string | null {
    if (!/^[\w.-]+\.(m3u8|ts)$/.test(filename)) return null;
    return path.join(HLS_BASE, channelId, filename);
  }

  // ─── Internal ──────────────────────────────────────────────────

  private async stopInternal(channelId: string): Promise<void> {
    const session = this.sessions.get(channelId);
    if (session) {
      session.stopping = true;
      this.killSession(session);
      this.sessions.delete(channelId);
      try { await fs.rm(session.hlsDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
    // Siempre forzar OFFLINE en la BD, incluso si no había sesión en memoria
    await this.prisma.channel.update({
      where: { id: channelId },
      data: { status: 'OFFLINE', hlsUrl: null },
    });
  }

  private killSession(s: PlayoutSession) {
    if (s.process && !s.process.killed) {
      try { s.process.kill('SIGTERM'); } catch { /* ignorar */ }
    }
  }

  // ─── FFmpeg ────────────────────────────────────────────────────

  private async launchFfmpeg(session: PlayoutSession): Promise<void> {
    if (session.stopping) return;

    // 1. Playlist activa
    const playlist = await this.getActivePlaylist(session.channelId);
    if (!playlist?.items?.length) {
      this.log(session, 'ERROR: Sin playlist o sin videos READY. Abortando.');
      await this.prisma.channel.update({
        where: { id: session.channelId },
        data: { status: 'ERROR' },
      });
      return;
    }
    this.log(session, `Playlist: "${playlist.name}" — ${playlist.items.length} video(s)`);

    // 2. Descargar MP4 de MinIO → disco local
    const videosDir = path.join(session.hlsDir, 'videos');
    await fs.mkdir(videosDir, { recursive: true });

    const downloadedMp4s: string[] = [];

    for (let i = 0; i < playlist.items.length; i++) {
      if (session.stopping) return;
      const item = playlist.items[i];
      const key = item.video.processedKey ?? item.video.originalKey;
      if (!key) {
        this.log(session, `  WARN: video ${item.video.id} sin key, omitiendo`);
        continue;
      }
      const mp4Path = path.join(videosDir, `${String(i).padStart(4, '0')}.mp4`);
      this.log(session, `  Descargando ${i + 1}/${playlist.items.length}: ${key}`);
      try {
        await this.storage.downloadToFile(key, mp4Path);
        downloadedMp4s.push(mp4Path);
        this.log(session, `  ✓ ${path.basename(mp4Path)} (${item.video.duration?.toFixed(1) ?? '?'}s)`);
      } catch (err: any) {
        this.log(session, `  ERROR descargando ${key}: ${err.message}`);
      }
    }

    if (downloadedMp4s.length === 0) {
      this.log(session, 'ERROR: No se pudo descargar ningún video.');
      await this.prisma.channel.update({ where: { id: session.channelId }, data: { status: 'ERROR' } });
      return;
    }
    if (session.stopping) return;

    // 3. Preprocesar cada MP4 → MPEG-TS normalizado
    //    Esto resuelve los 3 problemas del concat demuxer con MP4:
    //    a) h264_mp4toannexb: convierte H.264 AVCC→AnnexB (fix "No start code")
    //    b) -ac 2 -ar 44100: fuerza audio stereo (fix "channel element 1.6")
    //    c) -f mpegts: timestamps continuos (fix "DTS out of order" entre archivos)
    const tsFiles: string[] = [];
    const scale = this.config.get('FFMPEG_SCALE', '854:480');

    for (let i = 0; i < downloadedMp4s.length; i++) {
      if (session.stopping) return;
      const mp4Path = downloadedMp4s[i];
      const tsPath  = mp4Path.replace('.mp4', '.ts');
      this.log(session, `  Normalizando ${i + 1}/${downloadedMp4s.length} → ${path.basename(tsPath)}`);
      try {
        await this.runFfmpegSync([
          '-loglevel', 'error',
          '-i', mp4Path,
          '-vf', `scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2:black,fps=25,format=yuv420p`,
          '-c:v', 'libx264',
          '-preset', this.config.get('FFMPEG_PRESET', 'ultrafast'),
          '-crf', '26',
          '-b:v', '1000k',
          '-maxrate', '1200k',
          '-bufsize', '2000k',
          '-g', '50',
          '-sc_threshold', '0',
          '-c:a', 'aac',
          '-b:a', '96k',
          '-ar', '44100',
          '-ac', '2',
          '-f', 'mpegts',
          '-y', tsPath,
        ]);
        tsFiles.push(tsPath);
        this.log(session, `  ✓ normalizado: ${path.basename(tsPath)}`);
      } catch (err: any) {
        this.log(session, `  ERROR normalizando ${path.basename(mp4Path)}: ${err.message}`);
      }
    }

    if (tsFiles.length === 0) {
      this.log(session, 'ERROR: No se pudo normalizar ningún video.');
      await this.prisma.channel.update({ where: { id: session.channelId }, data: { status: 'ERROR' } });
      return;
    }
    if (session.stopping) return;

    // 4. Concat.txt con los MPEG-TS ya normalizados
    const concatPath = path.join(session.hlsDir, 'concat.txt');
    const concatLines = tsFiles.map(f => `file '${f}'`);
    await fs.writeFile(concatPath, concatLines.join('\n') + '\n');
    this.log(session, `concat.txt listo con ${tsFiles.length} archivos .ts`);

    // 5. FFmpeg principal: concat TS → HLS con stream copy (sin re-encoding)
    //    Los .ts ya están normalizados, solo hay que segmentar.
    //    omit_endlist: playlist no cierra → loop seamless al reiniciar
    //    epoch: segment IDs únicos entre reinicios → hls.js no confunde segmentos viejos
    const m3u8Path = path.join(session.hlsDir, 'index.m3u8');

    const args = [
      '-loglevel', 'warning',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      '-c', 'copy',           // stream copy: sin re-encoding (ultra rápido)
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '10',
      '-hls_flags', 'delete_segments+append_list+independent_segments+omit_endlist',
      '-hls_start_number_source', 'epoch',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', 'seg%d.ts',
      '-y',
      'index.m3u8',
    ];

    this.log(session, `Lanzando FFmpeg HLS (copy mode)...`);
    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: session.hlsDir,
    });
    session.process = proc;

    proc.stderr.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach((l) => {
        const t = l.trim();
        if (t) this.log(session, `ffmpeg: ${t}`);
      });
    });

    proc.on('spawn', () => {
      this.log(session, `FFmpeg PID=${proc.pid} en marcha. Esperando index.m3u8...`);
      this.waitForM3u8(session, m3u8Path);
    });

    proc.on('close', (code, sig) => {
      this.log(session, `FFmpeg terminó (code=${code} sig=${sig})`);
      session.process = null;
      if (!session.stopping) {
        session.restarts++;
        this.log(session, `Loop: reinicio #${session.restarts} en 3s...`);
        setTimeout(() => this.launchFfmpeg(session), 3000);
      }
    });

    proc.on('error', async (err) => {
      this.log(session, `ERROR spawn FFmpeg: ${err.message}`);
      if (!session.stopping) {
        await this.prisma.channel.update({
          where: { id: session.channelId },
          data: { status: 'ERROR' },
        }).catch(() => {});
      }
    });
  }

  // ─── Ejecutar FFmpeg sincrónico (preproceso) ───────────────────

  private runFfmpegSync(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      const errLines: string[] = [];
      proc.stderr.on('data', (b: Buffer) =>
        b.toString().split('\n').forEach(l => { if (l.trim()) errLines.push(l.trim()); })
      );
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(errLines.slice(-5).join(' | ') || `exit ${code}`));
      });
      proc.on('error', reject);
    });
  }

  // ─── Polling m3u8 ──────────────────────────────────────────────

  private waitForM3u8(session: PlayoutSession, m3u8Path: string) {
    const MAX_MS = 120_000;
    const POLL_MS = 2_000;
    const t0 = Date.now();

    const check = async () => {
      if (session.stopping) return;
      try {
        await fs.access(m3u8Path);
        if (!session.stopping) {
          await this.prisma.channel.update({
            where: { id: session.channelId },
            data: { status: 'LIVE_PLAYLIST' },
          });
          this.log(session, '✓ index.m3u8 listo → LIVE_PLAYLIST');
        }
      } catch {
        const elapsed = Date.now() - t0;
        if (elapsed < MAX_MS) {
          setTimeout(check, POLL_MS);
        } else {
          this.log(session, `TIMEOUT ${MAX_MS / 1000}s esperando index.m3u8`);
          await this.prisma.channel.update({
            where: { id: session.channelId },
            data: { status: 'ERROR' },
          }).catch(() => {});
        }
      }
    };

    setTimeout(check, POLL_MS);
  }

  // ─── Log helper ────────────────────────────────────────────────

  private log(session: PlayoutSession, msg: string) {
    const ts = new Date().toISOString().slice(11, 23);
    const line = `[${ts}] ${msg}`;
    session.recentLogs.push(line);
    if (session.recentLogs.length > MAX_LOGS) session.recentLogs.shift();
    this.logger.log(`[${session.channelId}] ${msg}`);
  }

  // ─── Playlist activa ───────────────────────────────────────────

  private async getActivePlaylist(channelId: string) {
    const now = new Date();

    const itemsArgs = {
      where: { video: { status: VideoStatus.READY } },
      orderBy: { order: 'asc' as const },
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
    } as const;

    // 1. Programa activo
    const schedule = await this.prisma.schedule.findFirst({
      where: {
        channelId,
        playlistId: { not: null },
        startTime: { lte: now },
        endTime:   { gte: now },
      },
      orderBy: { priority: 'desc' },
      include: { playlist: { include: { items: itemsArgs } } },
    });
    if (schedule?.playlist?.items?.length) return schedule.playlist;

    // 2. Default
    const def = await this.prisma.playlist.findFirst({
      where: { channelId, isDefault: true },
      include: { items: itemsArgs },
    });
    if (def?.items?.length) return def;

    // 3. Primera disponible
    return this.prisma.playlist.findFirst({
      where: { channelId },
      include: { items: itemsArgs },
    });
  }
}
