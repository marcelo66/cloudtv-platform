import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoStatus, OverlayType } from '@prisma/client';
import type { Overlay } from '@prisma/client';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OverlaysService } from '../overlays/overlays.service';

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

// Fuente monoespaciada instalada con fonts-dejavu-core
const FONT      = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

@Injectable()
export class PlayoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlayoutService.name);
  private sessions = new Map<string, PlayoutSession>();

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
    private overlaysService: OverlaysService,
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
    //    Resuelve: H.264 AVCC→AnnexB, audio 7.1→stereo, timestamps DTS continuos
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

    // 4. Concat.txt con los MPEG-TS normalizados
    const concatPath = path.join(session.hlsDir, 'concat.txt');
    const concatLines = tsFiles.map(f => `file '${f}'`);
    await fs.writeFile(concatPath, concatLines.join('\n') + '\n');
    this.log(session, `concat.txt listo con ${tsFiles.length} archivos .ts`);

    // 5. Cargar overlays habilitados para este canal
    const overlays = await this.overlaysService.getEnabledForChannel(session.channelId);
    const overlayFilter = overlays.length > 0
      ? await this.buildOverlayFilter(session, overlays)
      : null;

    if (overlayFilter) {
      this.log(session, `Overlays activos: ${overlays.length} → modo filter_complex (re-encode)`);
    } else {
      this.log(session, `Sin overlays → modo stream copy (rápido)`);
    }

    // 6. FFmpeg principal: concat TS → HLS
    //    omit_endlist: playlist abierta → loop seamless al reiniciar
    //    epoch: segment IDs únicos entre reinicios
    const m3u8Path = path.join(session.hlsDir, 'index.m3u8');

    const hlsOutputArgs = [
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

    let args: string[];

    if (!overlayFilter) {
      // Fast path: sin re-encoding
      args = [
        '-loglevel', 'warning',
        '-f', 'concat', '-safe', '0', '-i', concatPath,
        '-c', 'copy',
        ...hlsOutputArgs,
      ];
    } else {
      // Re-encode con overlays via filter_complex
      args = [
        '-loglevel', 'warning',
        '-f', 'concat', '-safe', '0', '-i', concatPath,
        ...overlayFilter.extraInputArgs,     // -i logo1.png -i logo2.png ...
        '-filter_complex', overlayFilter.filterComplex,
        '-map', overlayFilter.videoMapLabel,
        '-map', '0:a?',
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
        ...hlsOutputArgs,
      ];
    }

    this.log(session, `Lanzando FFmpeg HLS${overlayFilter ? ' + overlays' : ' (copy)'}...`);
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

  // ─── Overlay filter_complex builder ────────────────────────────

  private async buildOverlayFilter(
    session: PlayoutSession,
    overlays: Overlay[],
  ): Promise<{ filterComplex: string; extraInputArgs: string[]; videoMapLabel: string } | null> {
    const enabled = [...overlays]
      .filter(o => o.enabled)
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

    if (!enabled.length) return null;

    // Descargar logos al disco
    const logoLocalPaths = new Map<string, string>();
    for (const ov of enabled) {
      if (ov.type === OverlayType.LOGO) {
        const cfg = ov.config as any;
        if (cfg?.imageKey) {
          const localPath = path.join(session.hlsDir, `logo_${ov.id}.png`);
          try {
            await this.storage.downloadToFile(cfg.imageKey, localPath);
            logoLocalPaths.set(ov.id, localPath);
            this.log(session, `  ✓ Logo "${ov.name}" descargado`);
          } catch (err: any) {
            this.log(session, `  WARN: Logo "${ov.name}" falló descarga: ${err.message}`);
          }
        } else {
          this.log(session, `  WARN: Logo "${ov.name}" sin imageKey — omitido`);
        }
      }
    }

    const filterParts: string[] = [];
    const extraInputPaths: string[] = [];
    let currentStream = '0:v';
    let idx = 0;

    for (const ov of enabled) {
      const cfg = ov.config as any;
      const nextStream = `ov${idx}`;

      if (ov.type === OverlayType.LOGO) {
        const localPath = logoLocalPaths.get(ov.id);
        if (!localPath) continue; // sin imagen, saltar

        const inputIdx = extraInputPaths.length + 1; // 0 = concat input
        extraInputPaths.push(localPath);
        const pos = this.logoXY(cfg);

        if (cfg.width) {
          const scaledLabel = `sc${idx}`;
          filterParts.push(`[${inputIdx}:v]scale=${cfg.width}:-1[${scaledLabel}]`);
          filterParts.push(`[${currentStream}][${scaledLabel}]overlay=${pos}[${nextStream}]`);
        } else {
          filterParts.push(`[${currentStream}][${inputIdx}:v]overlay=${pos}[${nextStream}]`);
        }

      } else if (ov.type === OverlayType.TEXT_STATIC) {
        const text = this.escapeText(cfg.text ?? '');
        const font = cfg.bold ? FONT_BOLD : FONT;
        const fs2  = cfg.fontSize ?? 24;
        const fc   = cfg.fontColor ?? 'white';
        const pos  = this.textXY(cfg);
        const box  = cfg.bgColor
          ? `:box=1:boxcolor=${cfg.bgColor}:boxborderw=8`
          : ':box=1:boxcolor=black@0.5:boxborderw=8';
        filterParts.push(
          `[${currentStream}]drawtext=fontfile=${font}:text=${text}:fontsize=${fs2}:fontcolor=${fc}:${pos}${box}[${nextStream}]`,
        );

      } else if (ov.type === OverlayType.CLOCK) {
        const fmt  = cfg.format === 'datetime' ? '%d-%m-%Y %T' : '%T';
        // %{localtime\:FORMAT} — la \: evita que FFmpeg lo interprete como separador de opción
        const text = `%{localtime\\:${fmt}}`;
        const font = FONT_BOLD;
        const fs2  = cfg.fontSize ?? 28;
        const fc   = cfg.fontColor ?? 'white';
        const pos  = this.textXY(cfg);
        const box  = cfg.bgColor
          ? `:box=1:boxcolor=${cfg.bgColor}:boxborderw=10`
          : ':box=1:boxcolor=black@0.6:boxborderw=10';
        filterParts.push(
          `[${currentStream}]drawtext=fontfile=${font}:text=${text}:fontsize=${fs2}:fontcolor=${fc}:${pos}${box}[${nextStream}]`,
        );

      } else if (ov.type === OverlayType.TEXT_SCROLL || ov.type === OverlayType.TICKER) {
        const text   = this.escapeText(cfg.text ?? '');
        const font   = FONT;
        const fs2    = cfg.fontSize ?? 20;
        const fc     = cfg.fontColor ?? 'white';
        const speed  = cfg.speed ?? 80;
        const barH   = cfg.barHeight ?? 36;
        const isBot  = (cfg.position ?? 'bottom') !== 'top';
        const barY   = isBot ? `H-${barH}` : '0';
        // Centro vertical dentro de la barra
        const textY  = isBot ? `H-${barH}+(${barH}-text_h)/2` : `(${barH}-text_h)/2`;
        // Scroll de derecha a izquierda: x = W - (t*speed mod (W+text_w))
        const scrollX = `W-mod(t*${speed}\\,W+text_w)`;
        const bgColor = cfg.bgColor ?? 'black@0.7';
        const barLabel = `bar${idx}`;

        // 1) Banda de fondo (full width)
        filterParts.push(
          `[${currentStream}]drawbox=x=0:y=${barY}:w=W:h=${barH}:color=${bgColor}:t=fill[${barLabel}]`,
        );
        // 2) Texto scrolling sobre la banda
        filterParts.push(
          `[${barLabel}]drawtext=fontfile=${font}:text=${text}:fontsize=${fs2}:fontcolor=${fc}:x=${scrollX}:y=${textY}[${nextStream}]`,
        );

      } else {
        continue; // tipo desconocido
      }

      currentStream = nextStream;
      idx++;
    }

    if (!filterParts.length) return null;

    return {
      filterComplex: filterParts.join(';'),
      extraInputArgs: extraInputPaths.flatMap(p => ['-i', p]),
      videoMapLabel: `[${currentStream}]`,
    };
  }

  // ─── Helpers para posiciones ───────────────────────────────────

  /** Posición x:y para el filtro overlay= (imágenes logo) */
  private logoXY(cfg: any): string {
    const pad = 10;
    switch (cfg.position ?? 'top-left') {
      case 'top-right':    return `W-w-${pad}:${pad}`;
      case 'bottom-left':  return `${pad}:H-h-${pad}`;
      case 'bottom-right': return `W-w-${pad}:H-h-${pad}`;
      case 'center':       return `(W-w)/2:(H-h)/2`;
      case 'custom':       return `${cfg.x ?? pad}:${cfg.y ?? pad}`;
      default:             return `${pad}:${pad}`; // top-left
    }
  }

  /** Posición x=...:y=... para drawtext */
  private textXY(cfg: any): string {
    const pad = 10;
    switch (cfg.position ?? 'top-left') {
      case 'top-right':    return `x=W-text_w-${pad}:y=${pad}`;
      case 'bottom-left':  return `x=${pad}:y=H-text_h-${pad}`;
      case 'bottom-right': return `x=W-text_w-${pad}:y=H-text_h-${pad}`;
      case 'center':       return `x=(W-text_w)/2:y=(H-text_h)/2`;
      case 'custom':       return `x=${cfg.x ?? pad}:y=${cfg.y ?? pad}`;
      default:             return `x=${pad}:y=${pad}`; // top-left
    }
  }

  /** Escapar texto para el argumento text= de drawtext */
  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')   // \ → \\
      .replace(/'/g, "\\'")     // ' → \'
      .replace(/:/g, '\\:')     // : → \:
      .replace(/,/g, '\\,')     // , → \,
      .replace(/\[/g, '\\[')    // [ → \[
      .replace(/\]/g, '\\]');   // ] → \]
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
