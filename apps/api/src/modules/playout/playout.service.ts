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
  /** outputId → número de reintentos consecutivos fallidos */
  rtmpRetries: Map<string, number>;
  /** true → omitir overlays aunque estén configurados (fallback por falla rápida) */
  overlaysDisabled: boolean;
  /** Incrementa con cada nuevo lanzamiento FFmpeg para cancelar polls anteriores */
  pollToken: number;
}

const HLS_BASE    = path.join('/tmp', 'cloudtv-hls');
const MAX_LOGS    = 300;
const MAX_RESTARTS    = 5;
const MAX_RTMP_RETRIES = 5; // reintentos por salida RTMP antes de marcar ERROR permanente
const FONT        = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const FONT_BOLD   = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

/** Presets de calidad de emisión HLS.
 *  El usuario elige en Ajustes del canal; se aplica al arrancar FFmpeg. */
const VIDEO_QUALITY: Record<string, { scale: string; vBitrate: string; maxrate: string; bufsize: string; aBitrate: string }> = {
  '480p':  { scale: '854:480',   vBitrate: '1000k', maxrate: '1200k', bufsize: '2000k', aBitrate: '96k'  },
  '720p':  { scale: '1280:720',  vBitrate: '2500k', maxrate: '3000k', bufsize: '5000k', aBitrate: '128k' },
  '1080p': { scale: '1920:1080', vBitrate: '4500k', maxrate: '5400k', bufsize: '9000k', aBitrate: '192k' },
};

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
      rtmpRetries: new Map(),
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
      const p = s.process;
      try { p.kill('SIGTERM'); } catch { /* ok */ }
      // SIGKILL fallback: si SIGTERM no es suficiente (proceso bloqueado, Docker PID≠1)
      setTimeout(() => {
        if (p && !p.killed) {
          try { p.kill('SIGKILL'); } catch { /* ok */ }
        }
      }, 3000);
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

    // 2. Descargar MP4s — se reutiliza caché si ya existen del reinicio anterior
    const videosDir = path.join(session.hlsDir, 'videos');
    await fs.mkdir(videosDir, { recursive: true });

    const downloadedMp4s: string[] = [];
    for (let i = 0; i < playlist.items.length; i++) {
      if (session.stopping) return;
      const item = playlist.items[i];
      const key = item.video.processedKey ?? item.video.originalKey;
      if (!key) { this.log(session, `  WARN: video ${item.video.id} sin key`); continue; }
      const mp4Path = path.join(videosDir, `${String(i).padStart(4, '0')}.mp4`);
      // Reutilizar si ya está en disco (reinicio rápido tras falla de overlay, etc.)
      let alreadyCached = false;
      try { await fs.access(mp4Path); alreadyCached = true; } catch { /* no existe */ }
      if (alreadyCached) {
        this.log(session, `  ✓ (en caché) ${i + 1}/${playlist.items.length}: ${path.basename(mp4Path)}`);
        downloadedMp4s.push(mp4Path);
      } else {
        this.log(session, `  Descargando ${i + 1}/${playlist.items.length}: ${key}`);
        try {
          await this.storage.downloadToFile(key, mp4Path);
          downloadedMp4s.push(mp4Path);
          this.log(session, `  ✓ ${path.basename(mp4Path)} (${item.video.duration?.toFixed(1) ?? '?'}s)`);
        } catch (err: any) {
          this.log(session, `  ERROR descargando ${key}: ${err.message}`);
        }
      }
    }

    if (downloadedMp4s.length === 0) {
      this.log(session, 'ERROR: No se pudo descargar ningún video.');
      await this.prisma.channel.update({ where: { id: session.channelId }, data: { status: 'ERROR' } });
      return;
    }
    if (session.stopping) return;

    // 3. concat.txt apuntando a los MP4s originales (no hay pre-normalización)
    // El encode se hace en un único paso FFmpeg → segmentos HLS listos en segundos
    const concatPath = path.join(session.hlsDir, 'concat.txt');
    await fs.writeFile(concatPath, downloadedMp4s.map(f => `file '${f}'`).join('\n') + '\n');
    this.log(session, `concat.txt listo con ${downloadedMp4s.length} video(s)`);

    // 4. Calidad de emisión: leer del canal y resolver preset
    const channelData = await this.prisma.channel.findUnique({
      where: { id: session.channelId },
      select: { videoQuality: true },
    });
    const qKey = channelData?.videoQuality ?? '480p';
    const quality = VIDEO_QUALITY[qKey] ?? VIDEO_QUALITY['480p'];
    const scale = quality.scale;
    this.log(session, `Calidad: ${qKey} → ${scale} @ ${quality.vBitrate} video / ${quality.aBitrate} audio`);

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
      ? await this.buildOverlayFilter(session, overlays, scale)
      : null;

    this.log(session, overlayFilter
      ? `Overlays activos: ${overlays.length} → filter_complex`
      : 'Sin overlays → encode directo');

    // 6. FFmpeg HLS — encode único desde MP4 originales, sin pre-normalización
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

    const codecArgs = [
      '-c:v', 'libx264',
      '-preset', this.config.get('FFMPEG_PRESET', 'ultrafast'),
      '-crf', '26',
      '-b:v', quality.vBitrate, '-maxrate', quality.maxrate, '-bufsize', quality.bufsize,
      '-g', '50', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', quality.aBitrate, '-ar', '44100', '-ac', '2',
    ];

    // Filtro de normalización para cuando no hay overlays (scale + fps + formato)
    const normalizeVf = `scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2:black,fps=25,format=yuv420p`;

    // Filtro de audio: convierte cualquier layout (mono, 5.1, 7.1, etc.) a estéreo
    // y resamplea async para compensar gaps causados por paquetes corruptos descartados.
    // Esto soluciona "channel element 1.6 is not allocated" en videos con audio 5.1.
    const audioFilter = 'aformat=channel_layouts=stereo,aresample=async=1';

    // Para el camino con overlays: el audio se incluye dentro del mismo filter_complex
    // (video overlay chain + audio downmix chain en paralelo, separados por ';')
    const finalFilterComplex = overlayFilter
      ? `${overlayFilter.filterComplex};[0:a]${audioFilter}[aout]`
      : null;

    // Flags de tolerancia en el input: descarta paquetes corruptos (H264 AVCC start-code
    // errors, AAC 5.1 frames inválidos) en lugar de propagar errores al encoder.
    // -fflags +discardcorrupt : silencia "No start code is found" / "NAL unit" errors
    // -fflags +genpts        : regenera PTS faltantes o corruptos
    // -err_detect ignore_err : ignora errores no fatales en el decoder
    const inputFlags = [
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
    ];

    // -re: leer a velocidad real (1×) → imprescindible para live HLS
    // Sin -re FFmpeg encodes 50× más rápido, los segmentos se generan en segundos,
    // el playlist borra los viejos antes de que el player pueda cargarlos → 404 fatal.
    // -stream_loop -1: bucle infinito del playlist para broadcast 24/7
    const args: string[] = overlayFilter
      ? [
          '-loglevel', 'warning',
          '-re',
          '-stream_loop', '-1',
          ...inputFlags,
          '-f', 'concat', '-safe', '0', '-i', concatPath,
          ...overlayFilter.extraInputArgs,
          '-filter_complex', finalFilterComplex!,
          '-map', overlayFilter.videoMapLabel,
          '-map', '[aout]',
          ...codecArgs,
          ...hlsArgs,
        ]
      : [
          '-loglevel', 'warning',
          '-re',
          '-stream_loop', '-1',
          ...inputFlags,
          '-f', 'concat', '-safe', '0', '-i', concatPath,
          '-vf', normalizeVf,
          '-af', audioFilter,
          ...codecArgs,
          ...hlsArgs,
        ];

    this.log(session, `Lanzando FFmpeg HLS${overlayFilter ? ' + overlays' : ''}...`);
    if (finalFilterComplex) {
      // Log diagnóstico: mostrar el filter_complex completo (video + audio) para detectar errores de sintaxis
      const fc = finalFilterComplex;
      this.log(session, `[DIAG] filter_complex (${fc.length}ch): ${fc.length > 700 ? fc.substring(0, 700) + '...' : fc}`);
    }

    // Verificar que no se haya pedido un stop mientras se descargaban videos / se construían overlays
    if (session.stopping) {
      this.log(session, 'Stop solicitado antes de lanzar FFmpeg → cancelando');
      return;
    }

    let spawnedAt = Date.now(); // se ajusta en el evento 'spawn'
    const hadOverlays = !!overlayFilter;

    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: session.hlsDir,
    });
    session.process = proc;

    // Doble-check: si el stop llegó justo entre el check de arriba y el spawn, matar el proceso recién creado
    if (session.stopping) {
      this.log(session, 'Stop detectado post-spawn → matando proceso inmediatamente');
      try { proc.kill('SIGTERM'); } catch { /* ok */ }
      session.process = null;
      return;
    }

    proc.stderr.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach(l => {
        const t = l.trim();
        if (!t) return;
        // Suprimir "Late SEI is not implemented" — warning inofensivo del decoder
        // H.264 en los archivos de entrada; no afecta la salida re-encodada
        if (t.includes('Late SEI') || t.includes('late_sei') ||
            t.includes('streams.videolan.org') || t.includes('ffmpeg-devel')) return;
        this.log(session, `ffmpeg: ${t}`);
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

      const isCleanExit  = code === 0;
      const isRapidExit  = uptime < 5000;

      // ── Caso 1: falla rápida con overlays activos → overlay fallback ───────
      if (isRapidExit && !isCleanExit && hadOverlays && !session.overlaysDisabled) {
        session.overlaysDisabled = true;
        this.log(session, `ERROR: FFmpeg con overlays falló en ${uptime}ms (code=${code}) → ver [DIAG] filter_complex y errores "ffmpeg:" arriba`);
        this.log(session, 'WARN: Overlay fallback activado → reintentando sin overlays');
        this.stopRtmpOutputs(session, false);
        setTimeout(() => {
          if (session.stopping || !this.sessions.has(session.channelId)) return;
          this.launchFfmpeg(session);
        }, 2000);
        return;
      }

      // ── Caso 2: salida limpia code=0 (playlist terminó) → reinicio sin fallo
      // Con -stream_loop -1 esto no debería ocurrir, pero lo manejamos igual
      if (isCleanExit) {
        this.log(session, 'Playlist completada (code=0) → reiniciando en 1s...');
        this.stopRtmpOutputs(session, false);
        setTimeout(() => {
          if (session.stopping || !this.sessions.has(session.channelId)) return;
          this.launchFfmpeg(session);
        }, 1000);
        return;
      }

      // ── Caso 3: fallo real (code≠0) ────────────────────────────────────────
      session.restarts++;
      if (session.restarts >= MAX_RESTARTS) {
        this.log(session, `ERROR: Máximo de reinicios (${MAX_RESTARTS}) alcanzado → canal en ERROR. Revisá los logs para diagnosticar.`);
        // Marcar stopping para cancelar polls pendientes de waitForM3u8
        session.stopping = true;
        this.sessions.delete(session.channelId);
        this.prisma.channel.update({
          where: { id: session.channelId },
          data: { status: 'ERROR' },
        }).catch(() => {});
        return;
      }

      this.log(session, `Loop: reinicio #${session.restarts}/${MAX_RESTARTS} en 3s...`);
      this.stopRtmpOutputs(session, false);
      setTimeout(() => {
        if (session.stopping || !this.sessions.has(session.channelId)) return;
        this.launchFfmpeg(session);
      }, 3000);
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

  // ─── Control manual de salidas RTMP (independiente del canal) ────────────

  /** Inicia una salida RTMP individual si el canal está en live.
   *  Retorna éxito/error sin lanzar excepción (para respuesta HTTP limpia). */
  async startOutputNow(channelId: string, outputId: string): Promise<{ success: boolean; message: string }> {
    const session = this.sessions.get(channelId);
    if (!session || session.stopping) {
      return { success: false, message: 'El canal no está activo. Inicialo primero desde la sección Canal.' };
    }
    // Verificar que el m3u8 existe (canal realmente LIVE, no solo STARTING)
    const m3u8 = path.join(session.hlsDir, 'index.m3u8');
    try { await fs.access(m3u8); } catch {
      return { success: false, message: 'El canal está iniciando. Esperá unos segundos a que esté LIVE.' };
    }
    // Ya está corriendo?
    if (session.rtmpProcs.has(outputId)) {
      return { success: false, message: 'La salida ya está transmitiendo.' };
    }
    const output = await this.prisma.streamOutput.findFirst({ where: { id: outputId, channelId } });
    if (!output) {
      return { success: false, message: 'Salida no encontrada.' };
    }
    this.startSingleRtmpOutput(session, output);
    this.log(session, `RTMP [${output.name}] iniciado manualmente`);
    return { success: true, message: `Salida "${output.name}" iniciada.` };
  }

  /** Detiene una salida RTMP individual sin afectar al canal ni a las otras salidas. */
  async stopOutputNow(channelId: string, outputId: string): Promise<{ success: boolean; message: string }> {
    const session = this.sessions.get(channelId);
    if (session) {
      const proc = session.rtmpProcs.get(outputId);
      if (proc) {
        try { proc.kill('SIGTERM'); } catch { /* ok */ }
        session.rtmpProcs.delete(outputId);
        session.rtmpRetries.delete(outputId);
        const output = await this.prisma.streamOutput.findUnique({ where: { id: outputId } });
        if (output) this.log(session, `RTMP [${output.name}] detenido manualmente`);
      }
    }
    await this.streamOutputsService.updateStatus(outputId, 'IDLE');
    return { success: true, message: 'Salida detenida.' };
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
      session.rtmpRetries.delete(output.id); // conexión exitosa → resetear contador
      this.streamOutputsService.updateStatus(output.id, 'STREAMING').catch(() => {});
    });

    proc.on('close', async (code, sig) => {
      session.rtmpProcs.delete(output.id);
      this.log(session, `RTMP ${safeName} terminó (code=${code} sig=${sig})`);

      if (session.stopping) {
        await this.streamOutputsService.updateStatus(output.id, 'IDLE').catch(() => {});
        return;
      }

      const retries = (session.rtmpRetries.get(output.id) ?? 0) + 1;
      session.rtmpRetries.set(output.id, retries);

      if (retries >= MAX_RTMP_RETRIES) {
        this.log(session, `RTMP ${safeName} ERROR: ${retries} fallos consecutivos → desactivado. Revisá la URL/credenciales en Salidas de stream.`);
        await this.streamOutputsService.updateStatus(output.id, 'ERROR').catch(() => {});
        return;
      }

      await this.streamOutputsService.updateStatus(output.id, 'ERROR').catch(() => {});
      const delay = Math.min(10_000 * retries, 60_000); // backoff: 10s, 20s, 30s... máx 60s
      this.log(session, `RTMP ${safeName} reintentando en ${delay / 1000}s (intento ${retries}/${MAX_RTMP_RETRIES})...`);
      setTimeout(() => {
        if (session.stopping || !this.sessions.has(session.channelId)) return;
        this.startSingleRtmpOutput(session, output);
      }, delay);
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
    session.rtmpRetries.clear();
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
    scale: string,
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
            const { size } = await fs.stat(localPath);
            if (size < 8) throw new Error(`archivo inválido (${size}B — PNG mínimo 8B)`);
            logoLocalPaths.set(ov.id, localPath);
            this.log(session, `  ✓ Logo "${ov.name}" descargado (${Math.round(size / 1024)}KB)`);
          } catch (err: any) {
            this.log(session, `  WARN: Logo "${ov.name}" no disponible: ${err.message}`);
          }
        }
      }
    }

    const filterParts: string[] = [];
    const extraInputPaths: string[] = [];
    // Primer paso: normalizar resolución/fps igual que en el camino sin overlays
    filterParts.push(
      `[0:v]scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2:black,fps=25,format=yuv420p[norm]`,
    );
    let currentStream = 'norm';
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
          filterParts.push(`[${currentStream}][${sl}]overlay=${pos}:eof_action=repeat[${nextStream}]`);
        } else {
          filterParts.push(`[${currentStream}][${inputIdx}:v]overlay=${pos}:eof_action=repeat[${nextStream}]`);
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
      // -loop 1: el PNG se repite indefinidamente (sin esto provee 1 solo frame y luego EOF)
      extraInputArgs: extraInputPaths.flatMap(p => ['-loop', '1', '-i', p]),
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
