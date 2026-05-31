import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
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
import { AdBlocksService, AdBlockForPlayout, CuePointForPlayout, AdSpotWithVideo } from '../ad-blocks/ad-blocks.service';
import { YoutubeAuthService } from '../youtube-auth/youtube-auth.service';

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
  /** ID del schedule activo en el último lanzamiento (para detectar cambios) */
  activeScheduleId: string | null;
  /** true → el schedule cambió mientras corría; reiniciar sin contar como fallo */
  scheduleChangePending: boolean;
  /** Timer del watcher de schedule */
  scheduleWatchTimer: ReturnType<typeof setTimeout> | null;
  // ─── Ingesta ──────────────────────────────────────────────────
  /** ID de la fuente de ingesta activa (null = programación normal) */
  activeIngestId: string | null;
  /** Proceso FFmpeg de ingesta activo */
  ingestProcess: ChildProcess | null;
  /** Proceso yt-dlp activo (solo para tipo YOUTUBE, piped a ingestProcess) */
  ytDlpProcess: ChildProcess | null;
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

/** URL base RTMP de cada plataforma conocida. SRT no usa este mapa. */
const RTMP_BASE: Record<string, string> = {
  [Platform.YOUTUBE]:      'rtmp://a.rtmp.youtube.com/live2',
  [Platform.FACEBOOK]:     'rtmps://live-api-s.facebook.com:443/rtmp',
  [Platform.TWITCH]:       'rtmp://live.twitch.tv/app',
  [Platform.RTMP_CUSTOM]:  '',
  [Platform.SRT_CALLER]:   '',
  [Platform.SRT_LISTENER]: '',
};

const SRT_PLATFORMS = new Set<Platform>([Platform.SRT_CALLER, Platform.SRT_LISTENER]);

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
    private adBlocksService: AdBlocksService,
    private youtubeAuthService: YoutubeAuthService,
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
      // Resetear fuentes de ingesta activas (deploy anterior)
      await this.prisma.ingestSource.updateMany({
        where: { status: 'ACTIVE' },
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
      activeScheduleId: null,
      scheduleChangePending: false,
      scheduleWatchTimer: null,
      activeIngestId: null,
      ingestProcess: null,
      ytDlpProcess: null,
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
      active:         true,
      startedAt:      s.startedAt,
      restarts:       s.restarts,
      pid:            s.process?.pid      ?? null,
      rtmpOutputs:    s.rtmpProcs.size,
      activeIngestId: s.activeIngestId    ?? null,
      ingestPid:      s.ingestProcess?.pid ?? null,
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
      // Cancelar watcher de schedule
      if (session.scheduleWatchTimer) {
        clearTimeout(session.scheduleWatchTimer);
        session.scheduleWatchTimer = null;
      }
      // Matar proceso de ingesta si existe
      if (session.ytDlpProcess && !session.ytDlpProcess.killed) {
        try { session.ytDlpProcess.kill('SIGTERM'); } catch { /* ok */ }
      }
      session.ytDlpProcess = null;
      if (session.ingestProcess && !session.ingestProcess.killed) {
        try { session.ingestProcess.kill('SIGTERM'); } catch { /* ok */ }
      }
      session.ingestProcess = null;
      // Resetear fuente de ingesta activa
      if (session.activeIngestId) {
        this.prisma.ingestSource.update({
          where: { id: session.activeIngestId },
          data: { status: 'IDLE' },
        }).catch(() => {});
        session.activeIngestId = null;
      }
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
    if (session.activeIngestId) return; // ingesta activa — no reiniciar playlist

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

    // ── 3. Publicidad: cue points + schedule + intervalo de canal ───────────────

    // 3a. Cue points (publicidad a nivel de video)
    const cuePoints: CuePointForPlayout[] = await this.adBlocksService
      .getCuePointsForPlayout(session.channelId)
      .catch((): CuePointForPlayout[] => []);

    // 3b. Schedule activo — pre/post-tanda del programa
    const scheduleEntry = await this.getActiveScheduleEntry(session.channelId);
    session.activeScheduleId = scheduleEntry?.id ?? null;
    if (scheduleEntry) {
      const adInfo = [
        scheduleEntry.preAdBlock  ? `pre="${scheduleEntry.preAdBlock.name}"` : null,
        scheduleEntry.postAdBlock ? `post="${scheduleEntry.postAdBlock.name}"` : null,
      ].filter(Boolean).join(', ');
      if (adInfo) this.log(session, `Programa activo: "${scheduleEntry.name}" → tandas: ${adInfo}`);
    }

    // 3c. Intervalo automático del canal
    const channelAdConfig = await this.prisma.channel.findUnique({
      where: { id: session.channelId },
      select: {
        adIntervalMinutes: true,
        adIntervalBlock: {
          include: {
            spots: {
              where: { isActive: true },
              include: { video: { select: { id: true, originalKey: true, processedKey: true, duration: true, status: true } } },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });
    const intervalSeconds = channelAdConfig?.adIntervalMinutes
      ? channelAdConfig.adIntervalMinutes * 60
      : null;
    const intervalBlock = channelAdConfig?.adIntervalBlock ?? null;
    if (intervalSeconds && intervalBlock) {
      this.log(session, `Intervalo automático cada ${channelAdConfig!.adIntervalMinutes}min → "${intervalBlock.name}"`);
    }

    // 3d. Recopilar todos los spots únicos de TODAS las fuentes y descargar
    const allSpots = new Map<string, AdSpotWithVideo>();

    const collectSpots = (spots: AdSpotWithVideo[]) => {
      for (const s of spots) if (!allSpots.has(s.videoId)) allSpots.set(s.videoId, s);
    };

    for (const cp of cuePoints) collectSpots(cp.adBlock.spots as AdSpotWithVideo[]);
    if (scheduleEntry?.preAdBlock)  collectSpots(scheduleEntry.preAdBlock.spots  as AdSpotWithVideo[]);
    if (scheduleEntry?.postAdBlock) collectSpots(scheduleEntry.postAdBlock.spots as AdSpotWithVideo[]);
    if (intervalBlock)              collectSpots(intervalBlock.spots as AdSpotWithVideo[]);

    const adDownloads = new Map<string, string>(); // videoId → localPath
    if (allSpots.size > 0) {
      const adsDir = path.join(session.hlsDir, 'ads');
      await fs.mkdir(adsDir, { recursive: true });
      for (const [videoId, spot] of allSpots) {
        if (session.stopping) return;
        const key = spot.video.processedKey ?? spot.video.originalKey;
        if (!key) continue;
        const adPath = path.join(adsDir, `spot_${videoId}.mp4`);
        let cached = false;
        try { await fs.access(adPath); cached = true; } catch { /* no existe */ }
        if (cached) {
          adDownloads.set(videoId, adPath);
        } else {
          // Descargar a temporal → normalizar (AAC estéreo 44100Hz) → mover a caché final.
          // La normalización garantiza audio compatible en todos los spots y evita el cuelgue
          // del demuxer concat cuando el archivo tiene formato/codec distinto al contenido principal.
          const tmpDl = `${adPath}.dl.tmp`;
          try {
            await this.storage.downloadToFile(key, tmpDl);
            await this.normalizeAdSpot(tmpDl, adPath);
            try { await fs.unlink(tmpDl); } catch { /* ok */ }
            adDownloads.set(videoId, adPath);
            this.log(session, `  ✓ Spot "${spot.name}" (${spot.advertiser}) normalizado`);
          } catch (err: any) {
            try { await fs.unlink(tmpDl); } catch { /* ok */ }
            this.log(session, `  WARN: Spot "${spot.name}" no disponible: ${err.message}`);
          }
        }
      }
    }
    if (session.stopping) return;

    // ── 4. Construir concat.txt ──────────────────────────────────────────────────

    const concatPath = path.join(session.hlsDir, 'concat.txt');
    const concatLines: string[] = [];
    let totalAdsInjected = 0;
    let intervalElapsed = 0; // segundos de contenido acumulados desde la última tanda de intervalo

    /** Inserta los spots rotados de un bloque en concatLines (fire-and-forget para impresiones) */
    const insertBlock = async (adBlock: any, type: string) => {
      const spots = await this.adBlocksService.getRotatedSpots(adBlock as AdBlockForPlayout);
      for (const spot of spots) {
        const adPath = adDownloads.get(spot.videoId);
        if (!adPath) continue;
        concatLines.push(`file '${adPath}'`);
        totalAdsInjected++;
        this.adBlocksService.recordImpression(
          spot.id, adBlock.id, session.channelId,
          spot.advertiser, type, spot.video.duration,
        ).catch(() => {});
      }
    };

    // 4a. Pre-tanda del programa (schedule)
    if (scheduleEntry?.preAdBlock) {
      await insertBlock(scheduleEntry.preAdBlock, 'PRE_ROLL');
    }

    // 4b. Contenido: videos con cue-points y cortes de intervalo automático
    for (let i = 0; i < playlist.items.length; i++) {
      const item    = playlist.items[i];
      const mp4Path = downloadedMp4s[i];
      if (!mp4Path) continue;
      const videoId      = item.video.id;
      const videoDuration = item.video.duration ?? 0;

      const videoCues = cuePoints.filter((cp) => cp.videoId === videoId);
      const preRolls  = videoCues.filter((cp) => cp.type === 'PRE_ROLL');
      const postRolls = videoCues.filter((cp) => cp.type === 'POST_ROLL');
      const midRolls  = videoCues
        .filter((cp) => cp.type === 'MID_ROLL' && cp.timeOffset != null)
        .sort((a, b) => (a.timeOffset ?? 0) - (b.timeOffset ?? 0));

      // PRE_ROLL de cue points
      for (const cp of preRolls) await insertBlock(cp.adBlock, 'PRE_ROLL');

      // Video principal (con posibles MID_ROLLs de cue points)
      if (midRolls.length === 0) {
        concatLines.push(`file '${mp4Path}'`);
        if (item.trimStart) concatLines.push(`inpoint ${item.trimStart}`);
        if (item.trimEnd)   concatLines.push(`outpoint ${item.trimEnd}`);
      } else {
        let inpoint: number = item.trimStart ?? 0;
        for (const cp of midRolls) {
          const outpoint = cp.timeOffset!;
          concatLines.push(`file '${mp4Path}'`);
          if (inpoint > 0) concatLines.push(`inpoint ${inpoint}`);
          concatLines.push(`outpoint ${outpoint}`);
          await insertBlock(cp.adBlock, 'MID_ROLL');
          inpoint = outpoint;
        }
        concatLines.push(`file '${mp4Path}'`);
        if (inpoint > 0)   concatLines.push(`inpoint ${inpoint}`);
        if (item.trimEnd)  concatLines.push(`outpoint ${item.trimEnd}`);
      }

      // POST_ROLL de cue points
      for (const cp of postRolls) await insertBlock(cp.adBlock, 'POST_ROLL');

      // Intervalo automático: acumular duración real de contenido
      intervalElapsed += videoDuration;
      if (intervalSeconds && intervalElapsed >= intervalSeconds && intervalBlock) {
        this.log(session, `Tanda automática tras ${(intervalElapsed / 60).toFixed(1)}min de contenido`);
        await insertBlock(intervalBlock, 'MID_ROLL');
        intervalElapsed = 0;
      }
    }

    // 4c. Post-tanda del programa (schedule)
    if (scheduleEntry?.postAdBlock) {
      await insertBlock(scheduleEntry.postAdBlock, 'POST_ROLL');
    }

    // NOTA: NO usar "ffconcat version 1.0" header aquí.
    // Con -stream_loop -1 el concat demuxer necesita el modo clásico (-f concat)
    // para mantener timestamps continuos en el loop infinito.
    // El header "ffconcat version 1.0" cambia el manejo de timestamps y rompe
    // el loopeo cuando el playlist termina su primer ciclo.
    await fs.writeFile(concatPath, concatLines.join('\n') + '\n');
    this.log(
      session,
      `concat.txt: ${downloadedMp4s.length} video(s)${totalAdsInjected > 0 ? ` + ${totalAdsInjected} spot(s) publicitario(s)` : ' (sin publicidad)'}`,
    );

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
      '-hls_time', '2',
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
    // setpts=PTS-STARTPTS: normaliza timestamps al cruzar archivos en el concat demuxer
    // eliminando saltos/freezes entre videos en la transición.
    const normalizeVf = `scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS,fps=25,format=yuv420p`;

    // Filtro de audio: convierte cualquier layout (mono, 5.1, 7.1, etc.) a estéreo
    // y resamplea async para compensar gaps causados por paquetes corruptos descartados.
    // Esto soluciona "channel element 1.6 is not allocated" en videos con audio 5.1.
    const audioFilter = 'aformat=channel_layouts=stereo,aresample=async=1000';

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

    // Verificar que no se haya pedido un stop / ingesta mientras se descargaban videos
    if (session.stopping) {
      this.log(session, 'Stop solicitado antes de lanzar FFmpeg → cancelando');
      return;
    }
    if (session.activeIngestId) {
      this.log(session, 'Ingesta activada durante descarga → cancelando lanzamiento de playlist');
      return;
    }

    let spawnedAt = Date.now(); // se ajusta en el evento 'spawn'
    const hadOverlays = !!overlayFilter;

    // Zona horaria para el reloj en tiempo real (CLOCK overlay).
    // Tomar la timezone del primer overlay CLOCK activo (si existe).
    const clockOv = overlays.find(o => o.type === OverlayType.CLOCK && o.enabled);
    const ffmpegEnv = clockOv && (clockOv.config as any)?.timezone
      ? { ...process.env, TZ: (clockOv.config as any).timezone as string }
      : process.env;

    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: session.hlsDir,
      env: ffmpegEnv,
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
      if (session.activeIngestId) return; // ingesta tomó el control — no reiniciar playlist

      // ── Reinicio limpio por cambio de programa (no cuenta como fallo) ──────────
      if (session.scheduleChangePending) {
        session.scheduleChangePending = false;
        this.log(session, 'Reiniciando con nueva programación...');
        this.stopRtmpOutputs(session, false);
        setTimeout(() => {
          if (!session.stopping && this.sessions.has(session.channelId)) {
            this.launchFfmpeg(session);
          }
        }, 1000);
        return;
      }

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

    // Arrancar el watcher de schedule para detectar cambios de programa
    this.startScheduleWatcher(session);
  }

  // ─── Polling m3u8 ──────────────────────────────────────────────

  /**
   * Espera hasta que index.m3u8 exista y luego marca el canal como LIVE_PLAYLIST.
   * @param maxMs Tiempo máximo de espera en ms. 0 = sin límite (para SRT/RTMP listener).
   *              Por defecto 120 s para fuentes playlist normales.
   */
  private waitForM3u8(session: PlayoutSession, m3u8Path: string, token: number, maxMs?: number) {
    // 0 → sin límite efectivo (FFmpeg puede tardar indefinidamente esperando conexión entrante)
    const MAX_MS  = maxMs === 0 ? Number.MAX_SAFE_INTEGER : (maxMs ?? 120_000);
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

    const isSrt  = SRT_PLATFORMS.has(output.platform);
    const target = isSrt ? this.buildSrtTarget(output) : this.buildRtmpTarget(output);
    const format = isSrt ? 'mpegts' : 'flv';
    const m3u8   = path.join(session.hlsDir, 'index.m3u8');
    const safeName = `[${output.name}/${output.platform}]`;
    // Para logs: ocultar passphrase o stream key
    const safeTarget = isSrt
      ? target.replace(/passphrase=[^&]+/, 'passphrase=***')
      : target.replace(/\/([^\/]+)$/, '/***');

    const proc = spawn('ffmpeg', [
      '-loglevel', 'warning',
      '-re',
      '-i', m3u8,
      '-c', 'copy',
      '-f', format,
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

  /**
   * Construye la URL SRT para salidas SRT_CALLER y SRT_LISTENER.
   *
   * Formato FFmpeg SRT:
   *   Caller:   srt://HOST:PORT?mode=caller&latency=LATENCY_US[&passphrase=PASS]
   *   Listener: srt://:PORT?mode=listener&latency=LATENCY_US[&passphrase=PASS]
   *
   * latency en FFmpeg: microsegundos (ms × 1000).
   */
  private buildSrtTarget(output: StreamOutput): string {
    // Acceder con any porque los campos SRT se añaden en la misma migración y
    // estarán en el tipo Prisma generado en el build del deploy.
    const o = output as any;
    const port      = (o.srtPort      as number  | null | undefined) ?? 9001;
    const latencyMs = (o.srtLatency   as number  | null | undefined) ?? 120;
    const passphrase = (o.srtPassphrase as string | null | undefined)?.trim() ?? '';
    const latencyUs  = latencyMs * 1000; // ms → µs (unidad que usa FFmpeg para SRT)

    const params: string[] = [];
    if (output.platform === Platform.SRT_LISTENER) {
      params.push('mode=listener');
    } else {
      params.push('mode=caller');
    }
    params.push(`latency=${latencyUs}`);
    if (passphrase) params.push(`passphrase=${passphrase}`);

    if (output.platform === Platform.SRT_LISTENER) {
      return `srt://:${port}?${params.join('&')}`;
    }

    const host = output.rtmpUrl?.trim() || '127.0.0.1';
    return `srt://${host}:${port}?${params.join('&')}`;
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
    // Normalización: misma cadena que el path sin overlays + setpts para timestamps limpios
    filterParts.push(
      `[0:v]scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS,fps=25,format=yuv420p[norm]`,
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
        const pos     = this.logoXY(cfg);
        const opacity = cfg.opacity ?? 1;
        const sl      = `sc${idx}`;

        // Construir pipeline de pre-procesado del logo (scale + opacidad)
        if (cfg.width && opacity < 1) {
          filterParts.push(`[${inputIdx}:v]scale=${cfg.width}:-1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[${sl}]`);
          filterParts.push(`[${currentStream}][${sl}]overlay=${pos}:eof_action=repeat[${nextStream}]`);
        } else if (cfg.width) {
          filterParts.push(`[${inputIdx}:v]scale=${cfg.width}:-1[${sl}]`);
          filterParts.push(`[${currentStream}][${sl}]overlay=${pos}:eof_action=repeat[${nextStream}]`);
        } else if (opacity < 1) {
          filterParts.push(`[${inputIdx}:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[${sl}]`);
          filterParts.push(`[${currentStream}][${sl}]overlay=${pos}:eof_action=repeat[${nextStream}]`);
        } else {
          filterParts.push(`[${currentStream}][${inputIdx}:v]overlay=${pos}:eof_action=repeat[${nextStream}]`);
        }

      } else if (ov.type === OverlayType.TEXT_STATIC) {
        const text = this.escapeText(cfg.text ?? '');
        const font = cfg.bold ? FONT_BOLD : FONT;
        const box  = `:box=1:boxcolor=${cfg.bgColor ?? 'black@0.5'}:boxborderw=8`;
        filterParts.push(
          `[${currentStream}]drawtext=fontfile=${font}:text=${text}:fontsize=${cfg.fontSize ?? 24}:fontcolor=${cfg.fontColor ?? 'white'}:${this.textXY(cfg)}${box}:fix_bounds=1[${nextStream}]`,
        );

      } else if (ov.type === OverlayType.CLOCK) {
        // El formato 'datetime' usa fecha + hora; 'time' solo hora
        const fmt  = cfg.format === 'datetime' ? '%d/%m/%Y %H\\:%M\\:%S' : '%H\\:%M\\:%S';
        // %{localtime\:FORMAT} → evalúa strftime(FORMAT) por frame con TZ del proceso
        const text = `%{localtime\\:${fmt}}`;
        const box  = `:box=1:boxcolor=${cfg.bgColor ?? 'black@0.6'}:boxborderw=10`;
        filterParts.push(
          `[${currentStream}]drawtext=fontfile=${FONT_BOLD}:text=${text}:fontsize=${cfg.fontSize ?? 28}:fontcolor=${cfg.fontColor ?? 'white'}:${this.textXY(cfg)}${box}:fix_bounds=1[${nextStream}]`,
        );

      } else if (ov.type === OverlayType.TEXT_SCROLL || ov.type === OverlayType.TICKER) {
        const text    = this.escapeText(cfg.text ?? '');
        const barH    = cfg.barHeight ?? 36;
        const isBot   = (cfg.position ?? 'bottom') !== 'top';
        const barY    = isBot ? `H-${barH}` : '0';
        const textY   = isBot ? `H-${barH}+(${barH}-text_h)/2` : `(${barH}-text_h)/2`;
        // Fórmula: el texto arranca en el borde derecho y avanza speed px/s
        // mod(...) garantiza que reinicia el ciclo al llegar al extremo izquierdo
        const scrollX = `W-mod(t*${cfg.speed ?? 80}\\,W+text_w)`;
        const barLabel = `bar${idx}`;
        filterParts.push(
          `[${currentStream}]drawbox=x=0:y=${barY}:w=W:h=${barH}:color=${cfg.bgColor ?? 'black@0.7'}:t=fill[${barLabel}]`,
        );
        filterParts.push(
          `[${barLabel}]drawtext=fontfile=${FONT}:text=${text}:fontsize=${cfg.fontSize ?? 20}:fontcolor=${cfg.fontColor ?? 'white'}:x=${scrollX}:y=${textY}:fix_bounds=1[${nextStream}]`,
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

  // ─── Schedule watcher ──────────────────────────────────────────

  /**
   * Inicia un timer que cada 30 s comprueba si el schedule activo cambió.
   * Si detecta un cambio, marca scheduleChangePending y mata FFmpeg:
   * el handler 'close' reconstruirá el concat con el nuevo programa y sus tandas.
   */
  private startScheduleWatcher(session: PlayoutSession): void {
    // Cancelar el timer anterior si existe (evita duplicados en reinicios)
    if (session.scheduleWatchTimer) {
      clearTimeout(session.scheduleWatchTimer);
      session.scheduleWatchTimer = null;
    }

    const CHECK_MS = 30_000;

    const check = async () => {
      if (session.stopping || !this.sessions.has(session.channelId)) return;
      try {
        const entry = await this.getActiveScheduleEntry(session.channelId);
        const newId = entry?.id ?? null;
        if (newId !== session.activeScheduleId) {
          this.log(
            session,
            `Cambio de programa detectado (${session.activeScheduleId ?? 'default'} → ${newId ?? 'default'}) → reconstruyendo emisión`,
          );
          session.scheduleChangePending = true;
          this.killSession(session);
          return; // El handler 'close' relanzará y llamará a startScheduleWatcher de nuevo
        }
      } catch (err: any) {
        this.log(session, `WARN schedule watcher: ${err.message}`);
      }
      // Reprogramar solo si no hubo cambio
      if (!session.stopping && this.sessions.has(session.channelId)) {
        session.scheduleWatchTimer = setTimeout(check, CHECK_MS);
      }
    };

    session.scheduleWatchTimer = setTimeout(check, CHECK_MS);
  }

  /** Devuelve el schedule activo con sus tandas incluidas (para playout). */
  private getActiveScheduleEntry(channelId: string) {
    const now = new Date();
    const spotSelect = {
      where:   { isActive: true },
      include: { video: { select: { id: true, originalKey: true, processedKey: true, duration: true, status: true } } },
      orderBy: { order: 'asc' as const },
    };
    return this.prisma.schedule.findFirst({
      where: { channelId, playlistId: { not: null }, startTime: { lte: now }, endTime: { gte: now } },
      orderBy: { priority: 'desc' },
      include: {
        preAdBlock: {
          include: { spots: spotSelect },
        },
        postAdBlock: {
          include: { spots: spotSelect },
        },
      },
    });
  }

  /**
   * Normaliza un spot publicitario para garantizar compatibilidad con el concat demuxer:
   *   - Stream-copy de video (rápido, no re-encode)
   *   - Audio re-codificado a AAC estéreo 44100 Hz
   *   - Si el archivo no tiene pista de audio, agrega silencio para evitar que el
   *     demuxer se quede esperando un stream de audio que nunca llega.
   *
   * Se llama UNA vez por spot al descargar; el resultado queda en caché.
   */
  private async normalizeAdSpot(inputPath: string, outputPath: string): Promise<void> {
    const runFfmpeg = (extraArgs: string[]) =>
      new Promise<boolean>((resolve) => {
        const proc = spawn(
          'ffmpeg',
          ['-y', '-loglevel', 'error', '-i', inputPath, ...extraArgs, outputPath],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });

    // Intento 1: stream-copy video + re-encode audio existente a AAC estéreo 44100 Hz
    const ok = await runFfmpeg([
      '-c:v', 'copy',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2',
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-movflags', '+faststart',
    ]);

    if (!ok) {
      // Intento 2: el spot no tiene pista de audio → agregar silencio sintético
      // para que concat demuxer encuentre un stream de audio en todos los archivos.
      const ok2 = await new Promise<boolean>((resolve) => {
        const proc = spawn(
          'ffmpeg',
          [
            '-y', '-loglevel', 'error',
            '-i', inputPath,
            '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-c:v', 'copy',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2',
            '-map', '0:v:0',
            '-map', '1:a',
            '-shortest',
            '-movflags', '+faststart',
            outputPath,
          ],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });

      if (!ok2) {
        throw new Error(`normalizeAdSpot falló para ${inputPath}`);
      }
    }
  }

  // ─── Ingest pública API ───────────────────────────────────────

  /**
   * Activa una fuente de ingesta: pausa la playlist y lanza FFmpeg con la fuente externa.
   * El canal debe estar iniciado (sesión activa).
   */
  async activateIngest(channelId: string, ingestId: string, userId: string) {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, userId } });
    if (!channel) throw new NotFoundException('Canal no encontrado');

    const source = await this.prisma.ingestSource.findFirst({ where: { id: ingestId, channelId } });
    if (!source) throw new NotFoundException('Fuente de ingesta no encontrada');

    const session = this.sessions.get(channelId);
    if (!session || session.stopping) {
      throw new BadRequestException('El canal debe estar activo para activar la ingesta. Inicialo primero desde "Canal en vivo".');
    }

    // Si ya hay otro ingest activo, detenerlo primero
    if (session.activeIngestId && session.activeIngestId !== ingestId) {
      const prevId = session.activeIngestId;
      session.activeIngestId = null;
      if (session.ytDlpProcess && !session.ytDlpProcess.killed) {
        try { session.ytDlpProcess.kill('SIGTERM'); } catch { /* ok */ }
      }
      session.ytDlpProcess = null;
      if (session.ingestProcess && !session.ingestProcess.killed) {
        try { session.ingestProcess.kill('SIGTERM'); } catch { /* ok */ }
      }
      session.ingestProcess = null;
      await this.prisma.ingestSource.update({ where: { id: prevId }, data: { status: 'IDLE' } }).catch(() => {});
    }

    // Marcar ingesta activa ANTES de matar el proceso principal (evita que el close handler reinicie playlist)
    session.activeIngestId = ingestId;

    // Matar el proceso principal de playlist si corre
    if (session.process && !session.process.killed) {
      this.killSession(session);
    }

    // Detener salidas RTMP (se reinician cuando la ingesta produce el primer segmento)
    this.stopRtmpOutputs(session, false);

    // Marcar fuente como ACTIVE y canal como STARTING mientras la ingesta arranca
    await this.prisma.ingestSource.update({ where: { id: ingestId }, data: { status: 'ACTIVE' } }).catch(() => {});
    await this.prisma.channel.update({ where: { id: channelId }, data: { status: 'STARTING' } }).catch(() => {});

    this.log(session, `INGEST: Activando fuente "${source.name}" [${source.type}]`);

    // Lanzar en background — la canalización HLS comienza cuando FFmpeg produce el primer m3u8
    this.launchIngestFfmpeg(session, source).catch((err) => {
      this.log(session, `ERROR launchIngestFfmpeg: ${err.message}`);
    });

    return { success: true, message: `Ingesta "${source.name}" activada.` };
  }

  /**
   * Desactiva la ingesta activa y retoma la programación normal.
   */
  async deactivateIngest(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, userId } });
    if (!channel) throw new NotFoundException('Canal no encontrado');

    const session = this.sessions.get(channelId);
    if (!session) return { success: false, message: 'El canal no está activo.' };
    if (!session.activeIngestId) return { success: false, message: 'No hay ingesta activa.' };

    const ingestId = session.activeIngestId;
    this.log(session, `INGEST: Desactivando "${ingestId}" → retomando programación normal`);

    // Limpiar ANTES de matar los procesos (el close handler chequeará activeIngestId === null)
    session.activeIngestId = null;

    if (session.ytDlpProcess && !session.ytDlpProcess.killed) {
      try { session.ytDlpProcess.kill('SIGTERM'); } catch { /* ok */ }
    }
    session.ytDlpProcess = null;

    if (session.ingestProcess && !session.ingestProcess.killed) {
      try { session.ingestProcess.kill('SIGTERM'); } catch { /* ok */ }
    }
    session.ingestProcess = null;

    // Actualizar status de la fuente
    await this.prisma.ingestSource.update({ where: { id: ingestId }, data: { status: 'IDLE' } }).catch(() => {});

    // Detener salidas RTMP (se reinician con la playlist)
    this.stopRtmpOutputs(session, false);

    // Retomar programación normal
    this.launchFfmpeg(session).catch((err) => {
      this.log(session, `ERROR retomando playlist: ${err.message}`);
    });

    return { success: true, message: 'Ingesta desactivada. Retomando programación normal.' };
  }

  // ─── Ingest privado ───────────────────────────────────────────

  /**
   * Lanza el proceso FFmpeg para una fuente de ingesta.
   * Para YOUTUBE usa pipe yt-dlp → FFmpeg (stdin) para evitar URLs expiradas.
   * Para SRT/RTMP FFmpeg conecta directamente.
   */
  private async launchIngestFfmpeg(session: PlayoutSession, source: any): Promise<void> {
    if (session.stopping || !session.activeIngestId) return;

    const m3u8Path = path.join(session.hlsDir, 'index.m3u8');
    const hlsArgs  = [
      '-f',                       'hls',
      '-hls_time',                '4',
      '-hls_list_size',           '10',
      '-hls_flags',               'delete_segments+append_list+independent_segments+omit_endlist',
      '-hls_start_number_source', 'epoch',
      '-hls_segment_type',        'mpegts',
      '-hls_segment_filename',    'seg%d.ts',
      '-y',                       'index.m3u8',
    ];

    // ─── Armar input según tipo ──────────────────────────────────
    let inputArgs: string[] = [];
    let waitMaxMs: number | undefined;
    let ytDlpProc: ChildProcess | null = null; // solo para YOUTUBE

    switch (source.type as string) {

      // ── YouTube: yt-dlp piped a FFmpeg ──────────────────────────
      // NO se extrae la URL previamente — esas URLs de YouTube expiran en segundos.
      // yt-dlp escribe el stream a su stdout; FFmpeg lo lee desde stdin (pipe:0).
      case 'YOUTUBE': {
        this.log(session, 'INGEST: Iniciando yt-dlp → FFmpeg pipe para YouTube Live...');

        // Buscar cookies del propietario del canal
        const channelOwner = await this.prisma.channel.findUnique({
          where:  { id: session.channelId },
          select: { userId: true },
        });
        const userId      = channelOwner?.userId ?? null;
        let cookiesPath: string | null = null;

        if (userId) {
          cookiesPath = await this.youtubeAuthService.prepareCredentials(userId);
        }

        const ytArgs: string[] = [
          '--no-playlist',
          // Node.js como JS runtime para resolver el "n challenge" de YouTube.
          // --remote-components ejs:github descarga el solver de JS desde GitHub
          // (requerido desde 2025 para que yt-dlp pueda obtener formatos de video).
          '--js-runtimes', 'node',
          '--remote-components', 'ejs:github',
          '-f', 'best[height<=720]/best',
          '-o', '-',
        ];

        if (cookiesPath) {
          // ── Autenticado con cookies.txt ────────────────────────────
          ytArgs.push('--cookies', cookiesPath);
          ytArgs.push('--no-cache-dir');
          this.log(session, `INGEST: Cookies YouTube activas (usuario ${userId}) — sin bot-detection`);
        } else {
          // ── Sin autenticación — fallback por compatibilidad ───────
          ytArgs.push('--extractor-args', 'youtube:player_client=ios,web');
          ytArgs.push('--no-cache-dir');
          // Soporte legacy: cookies.txt via env var
          const cookiesFile = this.config.get<string>('YTDLP_COOKIES_FILE', '');
          const cookiesB64  = this.config.get<string>('YTDLP_COOKIES_B64', '');
          if (cookiesFile) {
            ytArgs.push('--cookies', cookiesFile);
            this.log(session, `INGEST: yt-dlp usando cookies desde ${cookiesFile}`);
          } else if (cookiesB64) {
            const tmpCookies = '/tmp/yt-dlp-cookies.txt';
            try {
              await fs.writeFile(tmpCookies, Buffer.from(cookiesB64, 'base64'));
              ytArgs.push('--cookies', tmpCookies);
              this.log(session, 'INGEST: yt-dlp usando cookies (YTDLP_COOKIES_B64)');
            } catch (e: any) {
              this.log(session, `INGEST: WARN no se pudo escribir cookies temp: ${e.message}`);
            }
          } else {
            this.log(session, 'INGEST: ⚠ Sin cookies — conectá tu cuenta YouTube en Ingesta → Autenticación');
          }
        }

        ytArgs.push(source.url as string);
        ytDlpProc = spawn('yt-dlp', ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        session.ytDlpProcess = ytDlpProc;
        inputArgs = ['-i', 'pipe:0'];
        break;
      }

      case 'SRT_CALLER': {
        const latencyUs  = ((source.srtLatency  as number | null) ?? 120) * 1_000;
        const pass       = (source.srtPassphrase as string | null)?.trim() ?? '';
        const streamId   = (source.srtStreamId  as string | null)?.trim() ?? '';
        const host       = (source.url          as string)?.trim() || '127.0.0.1';
        const port       = (source.srtPort      as number | null) ?? 9000;
        let srtUrl = `srt://${host}:${port}?mode=caller&latency=${latencyUs}`;
        if (pass)     srtUrl += `&passphrase=${pass}`;
        if (streamId) srtUrl += `&streamid=${encodeURIComponent(streamId)}`;
        this.log(session, `INGEST: SRT Caller → ${srtUrl}`);
        inputArgs = ['-i', srtUrl];
        break;
      }

      case 'SRT_LISTENER': {
        const latencyUs  = ((source.srtLatency  as number | null) ?? 120) * 1_000;
        const pass       = (source.srtPassphrase as string | null)?.trim() ?? '';
        const streamId   = (source.srtStreamId  as string | null)?.trim() ?? '';
        const port       = (source.srtPort      as number | null) ?? 9000;
        let srtUrl = `srt://:${port}?mode=listener&latency=${latencyUs}`;
        if (pass)     srtUrl += `&passphrase=${pass}`;
        if (streamId) srtUrl += `&streamid=${encodeURIComponent(streamId)}`;
        this.log(session, `INGEST: SRT Listener → esperando en :${port}${streamId ? ` (streamid: ${streamId})` : ''}`);
        inputArgs = ['-i', srtUrl];
        waitMaxMs = 0; // sin límite — FFmpeg espera conexión entrante
        break;
      }

      case 'RTMP_PUSH': {
        const port = (source.rtmpPort as number | null) ?? 1935;
        const app  = (source.rtmpApp  as string | null)?.trim() || 'live';
        const key  = (source.rtmpKey  as string | null)?.trim() || '';
        const host = (source.rtmpHost as string | null)?.trim() || '';

        const rtmpPath = key ? `/${app}/${key}` : `/${app}`;

        if (host) {
          // ── Pull: el servidor conecta a la fuente RTMP externa ───
          const rtmpPullUrl = `rtmp://${host}:${port}${rtmpPath}`;
          this.log(session, `INGEST: RTMP Pull → conectando a ${rtmpPullUrl}`);
          inputArgs = ['-i', rtmpPullUrl];
        } else {
          // ── Push: el servidor escucha conexiones entrantes ───────
          const rtmpListenUrl = `rtmp://0.0.0.0:${port}${rtmpPath}`;
          this.log(session, `INGEST: RTMP Push → escuchando en ${rtmpListenUrl}`);
          inputArgs = ['-listen', '1', '-i', rtmpListenUrl];
          waitMaxMs = 0;
        }
        break;
      }

      default:
        this.log(session, `INGEST ERROR: Tipo desconocido "${source.type}"`);
        return;
    }

    // ─── Calidad de re-encode ────────────────────────────────────
    const channelData = await this.prisma.channel.findUnique({
      where:  { id: session.channelId },
      select: { videoQuality: true },
    });
    const qKey    = channelData?.videoQuality ?? '480p';
    const quality = VIDEO_QUALITY[qKey] ?? VIDEO_QUALITY['480p'];
    const scale   = quality.scale;

    // setpts=PTS-STARTPTS: normaliza timestamps al cruzar archivos en el concat demuxer
    // eliminando saltos/freezes entre videos en la transición.
    const normalizeVf = `scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS,fps=25,format=yuv420p`;
    const audioFilter = 'aformat=channel_layouts=stereo,aresample=async=1000';

    const ffmpegArgs: string[] = [
      '-loglevel', 'warning',
      ...inputArgs,
      '-vf', normalizeVf,
      '-af', audioFilter,
      '-c:v', 'libx264',
      '-preset', this.config.get('FFMPEG_PRESET', 'ultrafast'),
      '-crf', '26',
      '-b:v', quality.vBitrate, '-maxrate', quality.maxrate, '-bufsize', quality.bufsize,
      '-g', '50', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', quality.aBitrate, '-ar', '44100', '-ac', '2',
      ...hlsArgs,
    ];

    if (session.stopping || !session.activeIngestId) {
      if (ytDlpProc) { try { ytDlpProc.kill('SIGTERM'); } catch { /* ok */ } session.ytDlpProcess = null; }
      return;
    }

    // Token para waitForM3u8
    session.pollToken++;
    const myPollToken = session.pollToken;

    // stdin: 'pipe' si leemos de yt-dlp, 'ignore' si no
    const proc = spawn('ffmpeg', ffmpegArgs, {
      stdio: [ytDlpProc ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      cwd:   session.hlsDir,
    });
    session.ingestProcess = proc;

    // ─── Conectar pipe yt-dlp → FFmpeg stdin ────────────────────
    if (ytDlpProc) {
      (ytDlpProc.stdout as NodeJS.ReadableStream).pipe(proc.stdin as NodeJS.WritableStream);

      ytDlpProc.stderr?.on('data', (chunk: Buffer) => {
        chunk.toString().split('\n').forEach(l => {
          const t = l.trim();
          if (t) this.log(session, `yt-dlp: ${t}`);
        });
      });

      ytDlpProc.on('error', (err: any) => {
        session.ytDlpProcess = null;
        const msg = err.code === 'ENOENT'
          ? 'yt-dlp no está instalado — reconstruí el container con Deploy (no solo Restart)'
          : `yt-dlp spawn error: ${err.message}`;
        this.log(session, `INGEST ERROR: ${msg}`);
      });

      ytDlpProc.on('close', (code, sig) => {
        session.ytDlpProcess = null;
        // yt-dlp terminó — FFmpeg leerá EOF en stdin y también terminará
        if (code !== 0 && sig !== 'SIGTERM') {
          this.log(session, `yt-dlp terminó con error (code=${code}) — revisá la URL y los permisos de YouTube`);
        }
      });
    }

    if (session.stopping || !session.activeIngestId) {
      if (ytDlpProc && !ytDlpProc.killed) { try { ytDlpProc.kill('SIGTERM'); } catch { /* ok */ } }
      try { proc.kill('SIGTERM'); } catch { /* ok */ }
      session.ingestProcess = null;
      session.ytDlpProcess  = null;
      return;
    }

    let spawnedAt = Date.now();

    proc.stderr?.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach(l => {
        const t = l.trim();
        if (t) this.log(session, `ingest: ${t}`);
      });
    });

    proc.on('spawn', () => {
      spawnedAt = Date.now();
      this.log(session, `FFmpeg INGEST PID=${proc.pid}${ytDlpProc ? ` ← yt-dlp PID=${ytDlpProc.pid}` : ''}. Esperando segmentos HLS...`);
      this.waitForM3u8(session, m3u8Path, myPollToken, waitMaxMs);
    });

    proc.on('close', async (code, sig) => {
      const uptime = Date.now() - spawnedAt;
      this.log(session, `FFmpeg INGEST terminó (code=${code} sig=${sig} uptime=${uptime}ms)`);
      session.ingestProcess = null;

      // Matar yt-dlp si todavía corre
      if (session.ytDlpProcess && !session.ytDlpProcess.killed) {
        try { session.ytDlpProcess.kill('SIGTERM'); } catch { /* ok */ }
      }
      session.ytDlpProcess = null;

      if (session.stopping) return;
      if (!session.activeIngestId) return; // deactivateIngest() ya limpió y llamó launchFfmpeg

      // Terminación inesperada
      this.log(session, 'INGEST: Fuente terminó inesperadamente → retomando programación normal');
      const ingestId = session.activeIngestId;
      session.activeIngestId = null;

      await this.prisma.ingestSource.update({ where: { id: ingestId }, data: { status: 'ERROR' } }).catch(() => {});
      this.stopRtmpOutputs(session, false);

      setTimeout(() => {
        if (!session.stopping && this.sessions.has(session.channelId)) {
          this.launchFfmpeg(session);
        }
      }, 2_000);
    });

    proc.on('error', async (err) => {
      session.ingestProcess = null;
      this.log(session, `INGEST spawn error: ${err.message}`);
      if (session.activeIngestId) {
        const ingestId = session.activeIngestId;
        session.activeIngestId = null;
        await this.prisma.ingestSource.update({ where: { id: ingestId }, data: { status: 'ERROR' } }).catch(() => {});
        if (!session.stopping && this.sessions.has(session.channelId)) {
          setTimeout(() => this.launchFfmpeg(session), 2_000);
        }
      }
    });
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
