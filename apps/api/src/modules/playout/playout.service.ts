import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoStatus, OverlayType, Platform } from '@prisma/client';
import type { Overlay, StreamOutput } from '@prisma/client';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OverlaysService } from '../overlays/overlays.service';
import { StreamOutputsService } from '../stream-outputs/stream-outputs.service';

interface PlayoutSession {
  channelId: string;
  process: ChildProcess | null;
  hlsDir: string;
  stopping: boolean;
  startedAt: Date;
  recentLogs: string[];
  restarts: number;
  /** outputId → proceso FFmpeg de re-streaming RTMP */
  rtmpProcs: Map<string, ChildProcess>;
  /** true → omitir overlays aunque estén configurados (fallback por falla rápida) */
  overlaysDisabled: boolean;
  /** Incrementa con cada nuevo lanzamiento FFmpeg para cancelar polls anteriores */
  pollToken: number;
}

const HLS_BASE    = path.join('/tmp', 'cloudtv-hls');
const MAX_LOGS    = 300;
const MAX_RESTARTS = 5;
const FONT        = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const FONT_BOLD   = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

/** URL base RTMP de cada plataforma conocida. */
const RTMP_BASE: Record<string, string> = {
  [Platform.YOUTUBE]:     'rtmp://a.rtmp.youtube.com/live2',
  [Platform.FACEBOOK]:    'rtmps://live-api-s.facebook.com:443/rtmp',
  [Platform.TWITCH]:      'rtmp://live.twitch.tv/app',
  [Platform.RTMP_CUSTOM]: '',
};

@Injectable()
export class PlayoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlayoutService.name);
  private sessions = new Map<string, PlayoutSession>();

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
    private overlaysService: OverlaysService,
    private streamOutputsService: StreamOutputsService,
  ) {}

  // ─── Lifecycle ────────────────────────────────────────────────

  async onModuleInit() {
    try {
      // Resetear canales activos (deploy anterior)
      const stale = await this.prisma.channel.updateMany({
        where: { status: { in: ['STARTING', 'LIVE_PLAYLIST', 'LIVE_RTMP'] } },
        data: { status: 'OFFLINE', hlsUrl: null },
      });
      if (stale.count > 0) {
        this.logger.log(`Reseteados ${stale.count} canal(es) → OFFLINE (redeploy)`);
      }
      // Resetear salidas RTMP activas
      await this.prisma.streamOutput.updateMany({
        where: { status: { not: 'IDLE' } },
        data: { status: 'IDLE' },
      });
    } catch (err) {
      this.logger.warn(`onModuleInit reset error: ${err.message}`);
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
      rtmpProcs: new Map(),
      overlaysDisabled: false,
      pollToken: 0,
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
    return {
      active: true,
      startedAt: s.startedAt,
      restarts: s.restarts,
      pid: s.process?.pid ?? null,
      rtmpOutputs: s.rtmpProcs.size,
    };
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
      // Matar proceso HLS principal
      this.killSession(session);
      // Matar todos los procesos RTMP
      for (const proc of session.rtmpProcs.values()) {
        try { proc.kill('SIGTERM'); } catch { /* ok */ }
      }
      session.rtmpProcs.clear();
      this.sessions.delete(channelId);
      try { await fs.rm(session.hlsDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
    // Resetear salidas RTMP en la BD
    await this.streamOutputsService.resetStatusesForChannel(channelId).catch(() => {});
    // Forzar OFFLINE
    await this.prisma.channel.update({
      where: { id: channelId },
      data: { status: 'OFFLINE', hlsUrl: null },
    });
  }

  private killSession(s: PlayoutSession) {
    if (s.process && !s.process.killed) {
      try { s.process.kill('SIGTERM'); } catch { /* ok */ }
    }
  }

  // ─── FFmpeg HLS ────────────────────────────────────────────────

  private async launchFfmpeg(session: PlayoutSession): Promise<void> {
    if (session.stopping) return;

    // Cancelar cualquier waitForM3u8 anterior
    session.pollToken++;
    const myPollToken = session.pollToken;

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

    // 2. Descargar MP4 → disco local
    const videosDir = path.join(session.hlsDir, 'videos');
    await fs.mkdir(videosDir, { recursive: true });

    const downloadedMp4s: string[] = [];
    for (let i = 0; i < playlist.items.length; i++) {
      if (session.stopping) return;
      const item = playlist.items[i];
      const key = item.video.processedKey ?? item.video.originalKey;
      if (!key) { this.log(session, `  WARN: video ${item.video.id} sin key`); continue; }
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

    // 3. Normalizar cada MP4 → MPEG-TS
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
          '-b:v', '1000k', '-maxrate', '1200k', '-bufsize', '2000k',
          '-g', '50', '-sc_threshold', '0',
          '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
          '-f', 'mpegts', '-y', tsPath,
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

    // 4. concat.txt
    const concatPath = path.join(session.hlsDir, 'concat.txt');
    await fs.writeFile(concatPath, tsFiles.map(f => `file '${f}'`).join('\n') + '\n');
    this.log(session, `concat.txt listo con ${tsFiles.length} archivos .ts`);

    // 5. Overlays
    const overlays = await this.overlaysService.getEnabledForChannel(session.channelId);
    const fontsOk   = await this.checkFontsAvailable();

    if (overlays.length > 0 && !fontsOk) {
      this.log(session, 'WARN: Fuentes DejaVu no encontradas → overlays de texto desactivados. Instalar fonts-dejavu-core y hacer Deploy (no solo Restart).');
    }
    if (overlays.length > 0 && session.overlaysDisabled) {
      this.log(session, 'WARN: Overlays desactivados por falla previa → emitiendo sin overlays');
    }

    const overlayFilter = (overlays.length > 0 && !session.overlaysDisabled && fontsOk)
      ? await this.buildOverlayFilter(session, overlays)
      : null;

    this.log(session, overlayFilter
      ? `Overlays activos: ${overlays.length} → filter_complex (re-encode)`
      : 'Sin overlays → stream copy (rápido)');

    // 6. FFmpeg HLS principal
    const m3u8Path = path.join(session.hlsDir, 'index.m3u8');

    const hlsArgs = [
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '10',
      '-hls_flags', 'delete_segments+append_list+independent_segments+omit_endlist',
      '-hls_start_number_source', 'epoch',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', 'seg%d.ts',
      '-y', 'index.m3u8',
    ];

    const args: string[] = !overlayFilter
      ? [
          '-loglevel', 'warning',
          '-f', 'concat', '-safe', '0', '-i', concatPath,
          '-c', 'copy',
          ...hlsArgs,
        ]
      : [
          '-loglevel', 'warning',
          '-f', 'concat', '-safe', '0', '-i', concatPath,
          ...overlayFilter.extraInputArgs,
          '-filter_complex', overlayFilter.filterComplex,
          '-map', overlayFilter.videoMapLabel,
          '-map', '0:a?',
          '-c:v', 'libx264',
          '-preset', this.config.get('FFMPEG_PRESET', 'ultrafast'),
          '-crf', '26',
          '-b:v', '1000k', '-maxrate', '1200k', '-bufsize', '2000k',
          '-g', '50', '-sc_threshold', '0',
          '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
          ...hlsArgs,
        ];

    this.log(session, `Lanzando FFmpeg HLS${overlayFilter ? ' + overlays' : ' (copy)'}...`);

    let spawnedAt = Date.now(); // se ajusta en el evento 'spawn'
    const hadOverlays = !!overlayFilter;

    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: session.hlsDir,
    });
    session.process = proc;

    proc.stderr.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach(l => {
        const t = l.trim();
        if (t) this.log(session, `ffmpeg: ${t}`);
      });
    });

    proc.on('spawn', () => {
      spawnedAt = Date.now();
      this.log(session, `FFmpeg PID=${proc.pid}. Esperando index.m3u8...`);
      this.waitForM3u8(session, m3u8Path, myPollToken);
    });

    proc.on('close', (code, sig) => {
      const uptime = Date.now() - spawnedAt;
      this.log(session, `FFmpeg terminó (code=${code} sig=${sig} uptime=${uptime}ms)`);
      session.process = null;

      if (session.stopping) return;

      const isRapidExit = uptime < 5000;

      if (isRapidExit && hadOverlays && !session.overlaysDisabled) {
        // FFmpeg falló de inmediato con overlays → deshabilitar overlays y reintentar
        session.overlaysDisabled = true;
        this.log(session, 'WARN: Salida rápida con overlays → reintentando sin overlays (posible problema de fuentes/filter_complex)');
        this.stopRtmpOutputs(session, false);
        setTimeout(() => this.launchFfmpeg(session), 2000);
        return;
      }

      session.restarts++;
      if (session.restarts >= MAX_RESTARTS) {
        this.log(session, `ERROR: Máximo de reinicios (${MAX_RESTARTS}) alcanzado → canal en ERROR. Revisá los logs para diagnosticar.`);
        this.prisma.channel.update({
          where: { id: session.channelId },
          data: { status: 'ERROR' },
        }).catch(() => {});
        return;
      }

      this.log(session, `Loop: reinicio #${session.restarts}/${MAX_RESTARTS} en 3s...`);
      this.stopRtmpOutputs(session, false);
      setTimeout(() => this.launchFfmpeg(session), 3000);
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

  // ─── Polling m3u8 ──────────────────────────────────────────────

  private waitForM3u8(session: PlayoutSession, m3u8Path: string, token: number) {
    const MAX_MS  = 120_000;
    const POLL_MS = 2_000;
    const t0 = Date.now();

    const check = async () => {
      // Cancelado porque se lanzó un nuevo proceso FFmpeg
      if (session.pollToken !== token) return;
      if (session.stopping) return;
      try {
        await fs.access(m3u8Path);
        if (!session.stopping && session.pollToken === token) {
          await this.prisma.channel.update({
            where: { id: session.channelId },
            data: { status: 'LIVE_PLAYLIST' },
          });
          this.log(session, '✓ index.m3u8 listo → LIVE_PLAYLIST');
          // Arrancar salidas RTMP
          this.startRtmpOutputs(session).catch(err =>
            this.log(session, `RTMP init error: ${err.message}`),
          );
        }
      } catch {
        if (Date.now() - t0 < MAX_MS) {
          setTimeout(check, POLL_MS);
        } else {
          // Sólo actuar si este poll sigue siendo el vigente
          if (session.pollToken !== token) return;
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

  // ─── RTMP outputs ─────────────────────────────────────────────

  private async startRtmpOutputs(session: PlayoutSession): Promise<void> {
    if (session.stopping) return;
    const outputs = await this.streamOutputsService.getEnabledForChannel(session.channelId);
    if (!outputs.length) {
      this.log(session, 'Sin salidas RTMP habilitadas');
      return;
    }
    this.log(session, `Iniciando ${outputs.length} salida(s) RTMP...`);
    for (const output of outputs) {
      this.startSingleRtmpOutput(session, output);
    }
  }

  private startSingleRtmpOutput(session: PlayoutSession, output: StreamOutput): void {
    if (session.stopping) return;
    if (session.rtmpProcs.has(output.id)) return; // ya corre

    const target = this.buildRtmpTarget(output);
    const m3u8   = path.join(session.hlsDir, 'index.m3u8');
    // Ocultar stream key en los logs (mostrar solo los últimos 4 caracteres)
    const safeName = `[${output.name}/${output.platform}]`;
    const safeTarget = target.replace(/\/([^\/]+)$/, '/***');

    const proc = spawn('ffmpeg', [
      '-loglevel', 'warning',
      '-re',
      '-i', m3u8,
      '-c', 'copy',
      '-f', 'flv',
      target,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    session.rtmpProcs.set(output.id, proc);
    this.log(session, `RTMP ${safeName} PID=${proc.pid} → ${safeTarget}`);

    proc.stderr.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach(l => {
        const t = l.trim();
        if (t) this.log(session, `rtmp${safeName}: ${t}`);
      });
    });

    proc.on('spawn', () => {
      this.streamOutputsService.updateStatus(output.id, 'STREAMING').catch(() => {});
    });

    proc.on('close', async (code, sig) => {
      session.rtmpProcs.delete(output.id);
      this.log(session, `RTMP ${safeName} terminó (code=${code} sig=${sig})`);

      if (!session.stopping) {
        await this.streamOutputsService.updateStatus(output.id, 'ERROR').catch(() => {});
        this.log(session, `RTMP ${safeName} reintentando en 10s...`);
        setTimeout(() => {
          if (!session.stopping) this.startSingleRtmpOutput(session, output);
        }, 10_000);
      } else {
        await this.streamOutputsService.updateStatus(output.id, 'IDLE').catch(() => {});
      }
    });

    proc.on('error', (err) => {
      session.rtmpProcs.delete(output.id);
      this.log(session, `RTMP ${safeName} spawn error: ${err.message}`);
      this.streamOutputsService.updateStatus(output.id, 'ERROR').catch(() => {});
    });
  }

  /** Detiene todos los procesos RTMP de la sesión.
   *  @param updateDb si es true actualiza los estados en BD a IDLE. */
  private stopRtmpOutputs(session: PlayoutSession, updateDb = true): void {
    for (const [id, proc] of session.rtmpProcs) {
      try { proc.kill('SIGTERM'); } catch { /* ok */ }
      if (updateDb) {
        this.streamOutputsService.updateStatus(id, 'IDLE').catch(() => {});
      }
    }
    session.rtmpProcs.clear();
  }

  /** Construye la URL RTMP completa para el destino (base + stream key). */
  private buildRtmpTarget(output: StreamOutput): string {
    const base = (output.rtmpUrl?.trim() || RTMP_BASE[output.platform] || '').replace(/\/$/, '');
    return output.streamKey ? `${base}/${output.streamKey}` : base;
  }

  // ─── Font check ────────────────────────────────────────────────

  private async checkFontsAvailable(): Promise<boolean> {
    try {
      await fs.access(FONT);
      await fs.access(FONT_BOLD);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Overlay filter_complex ────────────────────────────────────

  private async buildOverlayFilter(
    session: PlayoutSession,
    overlays: Overlay[],
  ): Promise<{ filterComplex: string; extraInputArgs: string[]; videoMapLabel: string } | null> {
    const enabled = [...overlays]
      .filter(o => o.enabled)
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    if (!enabled.length) return null;

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
        }
      }
    }

    const filterParts: string[] = [];
    const extraInputPaths: string[] = [];
    let currentStream = '0:v';
    let idx = 0;

    for (const ov of enabled) {
      const cfg        = ov.config as any;
      const nextStream = `ov${idx}`;

      if (ov.type === OverlayType.LOGO) {
        const localPath = logoLocalPaths.get(ov.id);
        if (!localPath) continue;
        const inputIdx = extraInputPaths.length + 1;
        extraInputPaths.push(localPath);
        const pos = this.logoXY(cfg);
        if (cfg.width) {
          const sl = `sc${idx}`;
          filterParts.push(`[${inputIdx}:v]scale=${cfg.width}:-1[${sl}]`);
          filterParts.push(`[${currentStream}][${sl}]overlay=${pos}[${nextStream}]`);
        } else {
          filterParts.push(`[${currentStream}][${inputIdx}:v]overlay=${pos}[${nextStream}]`);
        }

      } else if (ov.type === OverlayType.TEXT_STATIC) {
        const text = this.escapeText(cfg.text ?? '');
        const font = cfg.bold ? FONT_BOLD : FONT;
        const box  = `:box=1:boxcolor=${cfg.bgColor ?? 'black@0.5'}:boxborderw=8`;
        filterParts.push(
          `[${currentStream}]drawtext=fontfile=${font}:text=${text}:fontsize=${cfg.fontSize ?? 24}:fontcolor=${cfg.fontColor ?? 'white'}:${this.textXY(cfg)}${box}[${nextStream}]`,
        );

      } else if (ov.type === OverlayType.CLOCK) {
        const fmt  = cfg.format === 'datetime' ? '%d-%m-%Y %T' : '%T';
        const text = `%{localtime\\:${fmt}}`;
        const box  = `:box=1:boxcolor=${cfg.bgColor ?? 'black@0.6'}:boxborderw=10`;
        filterParts.push(
          `[${currentStream}]drawtext=fontfile=${FONT_BOLD}:text=${text}:fontsize=${cfg.fontSize ?? 28}:fontcolor=${cfg.fontColor ?? 'white'}:${this.textXY(cfg)}${box}[${nextStream}]`,
        );

      } else if (ov.type === OverlayType.TEXT_SCROLL || ov.type === OverlayType.TICKER) {
        const text    = this.escapeText(cfg.text ?? '');
        const barH    = cfg.barHeight ?? 36;
        const isBot   = (cfg.position ?? 'bottom') !== 'top';
        const barY    = isBot ? `H-${barH}` : '0';
        const textY   = isBot ? `H-${barH}+(${barH}-text_h)/2` : `(${barH}-text_h)/2`;
        const scrollX = `W-mod(t*${cfg.speed ?? 80}\\,W+text_w)`;
        const barLabel = `bar${idx}`;
        filterParts.push(
          `[${currentStream}]drawbox=x=0:y=${barY}:w=W:h=${barH}:color=${cfg.bgColor ?? 'black@0.7'}:t=fill[${barLabel}]`,
        );
        filterParts.push(
          `[${barLabel}]drawtext=fontfile=${FONT}:text=${text}:fontsize=${cfg.fontSize ?? 20}:fontcolor=${cfg.fontColor ?? 'white'}:x=${scrollX}:y=${textY}[${nextStream}]`,
        );

      } else {
        continue;
      }

      currentStream = nextStream;
      idx++;
    }

    if (!filterParts.length) return null;

    return {
      filterComplex:  filterParts.join(';'),
      extraInputArgs: extraInputPaths.flatMap(p => ['-i', p]),
      videoMapLabel:  `[${currentStream}]`,
    };
  }

  // ─── Helpers posición ──────────────────────────────────────────

  private logoXY(cfg: any): string {
    const p = 10;
    switch (cfg.position ?? 'top-left') {
      case 'top-right':    return `W-w-${p}:${p}`;
      case 'bottom-left':  return `${p}:H-h-${p}`;
      case 'bottom-right': return `W-w-${p}:H-h-${p}`;
      case 'center':       return `(W-w)/2:(H-h)/2`;
      case 'custom':       return `${cfg.x ?? p}:${cfg.y ?? p}`;
      default:             return `${p}:${p}`;
    }
  }

  private textXY(cfg: any): string {
    const p = 10;
    switch (cfg.position ?? 'top-left') {
      case 'top-right':    return `x=W-text_w-${p}:y=${p}`;
      case 'bottom-left':  return `x=${p}:y=H-text_h-${p}`;
      case 'bottom-right': return `x=W-text_w-${p}:y=H-text_h-${p}`;
      case 'center':       return `x=(W-text_w)/2:y=(H-text_h)/2`;
      case 'custom':       return `x=${cfg.x ?? p}:y=${cfg.y ?? p}`;
      default:             return `x=${p}:y=${p}`;
    }
  }

  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/,/g, '\\,')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');
  }

  // ─── FFmpeg sincrónico (normalización) ───────────────────────

  private runFfmpegSync(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      const errLines: string[] = [];
      proc.stderr.on('data', (b: Buffer) =>
        b.toString().split('\n').forEach(l => { if (l.trim()) errLines.push(l.trim()); }),
      );
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(errLines.slice(-5).join(' | ') || `exit ${code}`));
      });
      proc.on('error', reject);
    });
  }

  // ─── Log helper ────────────────────────────────────────────────

  private log(session: PlayoutSession, msg: string) {
    const ts   = new Date().toISOString().slice(11, 23);
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
          select: { id: true, originalKey: true, processedKey: true, duration: true, status: true },
        },
      },
    } as const;

    const schedule = await this.prisma.schedule.findFirst({
      where: { channelId, playlistId: { not: null }, startTime: { lte: now }, endTime: { gte: now } },
      orderBy: { priority: 'desc' },
      include: { playlist: { include: { items: itemsArgs } } },
    });
    if (schedule?.playlist?.items?.length) return schedule.playlist;

    const def = await this.prisma.playlist.findFirst({
      where: { channelId, isDefault: true },
      include: { items: itemsArgs },
    });
    if (def?.items?.length) return def;

    return this.prisma.playlist.findFirst({
      where: { channelId },
      include: { items: itemsArgs },
    });
  }
}
