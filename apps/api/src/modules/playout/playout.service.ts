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
  /** Timer de refresco periódico de temperatura (TEMPERATURE overlays) */
  tempRefreshTimer: ReturnType<typeof setTimeout> | null;
  /** Timer de refresco periódico de RSS (TICKER overlays con textSource='rss') */
  rssRefreshTimer: ReturnType<typeof setTimeout> | null;
  /** true → runBackgroundNormalization está activo; no lanzar una segunda instancia */
  bgNormRunning: boolean;
  /** Timer del watchdog de segmentos HLS (detecta FFmpeg estancado) */
  segmentWatchTimer: ReturnType<typeof setTimeout> | null;
  // ─── Ingesta ──────────────────────────────────────────────────
  /** ID de la fuente de ingesta activa (null = programación normal) */
  activeIngestId: string | null;
  /** Proceso FFmpeg de ingesta activo */
  ingestProcess: ChildProcess | null;
  /** Proceso yt-dlp activo (solo para tipo YOUTUBE, piped a ingestProcess) */
  ytDlpProcess: ChildProcess | null;
  /**
   * Marca de tiempo (ms) cuando el HLS entró en LIVE_PLAYLIST por primera vez
   * en esta sesión de canal. Se preserva entre reinicios de FFmpeg para calcular
   * la posición correcta de reanudación con `inpoint` o `-ss`.
   * null = canal recién arrancado, aún no ha emitido ni un segmento.
   */
  contentStartedAt: number | null;
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
      tempRefreshTimer: null,
      rssRefreshTimer: null,
      bgNormRunning: false,
      segmentWatchTimer: null,
      activeIngestId: null,
      ingestProcess: null,
      ytDlpProcess: null,
      contentStartedAt: null,
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
      // Cancelar timer de refresco de temperatura
      if (session.tempRefreshTimer) {
        clearTimeout(session.tempRefreshTimer);
        session.tempRefreshTimer = null;
      }
      // Cancelar timer de refresco de RSS ticker
      if (session.rssRefreshTimer) {
        clearTimeout(session.rssRefreshTimer);
        session.rssRefreshTimer = null;
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

    // Limpiar segmentos y playlist HLS de la sesión anterior.
    //
    // Con hls_start_number_source=epoch, los números de segmento son timestamps Unix.
    // Si el proceso RTMP reconecta y el nuevo m3u8 tiene números ~337 más altos (porque
    // la sesión anterior duró 11 min → 330 segmentos), el HLS demuxer reporta
    // "skipping 337 segments ahead" y puede decodificar paquetes corruptos.
    //
    // Solución: borrar index.m3u8 y seg*.ts antes de que el nuevo FFmpeg arranque.
    // El waitForM3u8 espera a que el NUEVO index.m3u8 aparezca, por lo que RTMP
    // solo arranca cuando el nuevo HLS ya tiene segmentos frescos listos.
    try {
      const staleFiles = await fs.readdir(session.hlsDir).catch(() => [] as string[]);
      await Promise.all(
        staleFiles
          .filter(f => f === 'index.m3u8' || f.startsWith('seg') && f.endsWith('.ts'))
          .map(f => fs.unlink(path.join(session.hlsDir, f)).catch(() => {})),
      );
    } catch { /* no crítico */ }

    // Cancelar cualquier waitForM3u8 anterior
    session.pollToken++;
    const myPollToken = session.pollToken;

    // 1. Playlist activa
    const { playlist, scheduleEndTime, fillerPlaylist } = await this.getActivePlaylist(session.channelId);
    if (!playlist?.items?.length) {
      this.log(session, 'ERROR: Sin playlist o sin videos READY. Abortando.');
      await this.prisma.channel.update({
        where: { id: session.channelId },
        data: { status: 'ERROR' },
      });
      return;
    }
    this.log(session, `Playlist: "${playlist.name}" — ${playlist.items.length} video(s)`);

    // ── 2. Calidad de emisión (se necesita ANTES de la descarga para el nombre del caché) ──────
    const channelQualityEarly = await this.prisma.channel.findUnique({
      where: { id: session.channelId },
      select: { videoQuality: true },
    });
    const qKeyEarly    = channelQualityEarly?.videoQuality ?? '480p';
    const qualityEarly = VIDEO_QUALITY[qKeyEarly] ?? VIDEO_QUALITY['480p'];

    // ── 3. Descargar y preparar archivos para emisión ────────────────────────────────────────
    //
    // CACHÉ PERSISTENTE: los archivos normalizados se guardan en /tmp/cloudtv-norm/{channelId}/
    // fuera del hlsDir (que se borra al parar el canal). Así los reinicios son instantáneos:
    // los archivos ya descargados se reutilizan sin volver a descargar desde S3.
    //
    // DESCARGA PARALELA: todos los videos se descargan en paralelo (máximo DOWNLOAD_CONCURRENCY
    // simultáneos) en lugar de uno tras otro. Para playlists de N videos: tiempo ≈ max(t_i)
    // en lugar de Σ(t_i).

    const DOWNLOAD_CONCURRENCY = 4;

    // normCacheDir: persistente entre reinicios del canal
    const normCacheDir = path.join('/tmp', 'cloudtv-norm', session.channelId);
    await fs.mkdir(normCacheDir, { recursive: true });

    // videosDir: solo para archivos raw (se borra con hlsDir al parar)
    const videosDir = path.join(session.hlsDir, 'videos');
    await fs.mkdir(videosDir, { recursive: true });

    const downloadedMap  = new Map<number, string>();
    const normalizedSet  = new Set<number>(); // índices con norm file completo (no raw)
    const pendingNorm: Array<{ rawPath: string; normPath: string }> = [];
    let totalDuration = 0;

    // ── Fase 1: clasificar cada video (caché hit vs descarga necesaria) ───────
    type DlTask = {
      i: number;
      type: 'prenorm' | 'raw';
      srcKey: string;
      destPath: string;
      rawPath: string;
      normPath: string;
      duration: number;
    };
    const toDownload: DlTask[] = [];

    for (let i = 0; i < playlist.items.length; i++) {
      if (session.stopping) return;
      const item    = playlist.items[i];
      const videoId = item.video.id;
      const dur     = item.video.duration ?? 0;
      const rawPath  = path.join(videosDir,    `raw_${videoId}.mp4`);
      const normPath = path.join(normCacheDir, `norm_${qKeyEarly}_${videoId}.mp4`);

      const normKeyDb: string | null | undefined =
        qKeyEarly === '480p'  ? item.video.norm480pKey  :
        qKeyEarly === '720p'  ? item.video.norm720pKey  :
        qKeyEarly === '1080p' ? item.video.norm1080pKey :
        null;

      // Caché persistente: archivo ya descargado → reutilizar sin tocar S3
      let normExists = false;
      try { await fs.access(normPath); normExists = true; } catch { /* no existe */ }
      if (normExists) {
        this.log(session, `  ✓ [cache] ${i + 1}/${playlist.items.length} · ${dur.toFixed(1)}s`);
        downloadedMap.set(i, normPath);
        normalizedSet.add(i);
        totalDuration += dur;
        continue;
      }

      // Pre-normalizado en S3 (Opción B) → encolar descarga paralela
      if (normKeyDb) {
        toDownload.push({ i, type: 'prenorm', srcKey: normKeyDb, destPath: normPath, rawPath, normPath, duration: dur });
        continue;
      }

      // Fallback: raw → check disco primero, luego encolar descarga
      const rawKey = item.video.processedKey ?? item.video.originalKey;
      if (!rawKey) { this.log(session, `  WARN: video ${videoId} sin key`); continue; }

      // Raw file puede sobrevivir reinicios soft (scheduleChangePending no borra hlsDir)
      let rawExists = false;
      try { await fs.access(rawPath); rawExists = true; } catch { /* no existe */ }
      if (rawExists) {
        this.log(session, `  ✓ [raw-disk] ${i + 1}/${playlist.items.length} · ${dur.toFixed(1)}s`);
        downloadedMap.set(i, rawPath);
        pendingNorm.push({ rawPath, normPath });
        totalDuration += dur;
        continue;
      }

      toDownload.push({ i, type: 'raw', srcKey: rawKey, destPath: rawPath, rawPath, normPath, duration: dur });
    }

    // ── Fase 2: descargar en paralelo (DOWNLOAD_CONCURRENCY simultáneos) ─────
    if (toDownload.length > 0) {
      this.log(session, `↓ Descargando ${toDownload.length} video(s) en paralelo (${DOWNLOAD_CONCURRENCY} simultáneos)…`);
    }
    for (let b = 0; b < toDownload.length; b += DOWNLOAD_CONCURRENCY) {
      if (session.stopping) return;
      const batch = toDownload.slice(b, b + DOWNLOAD_CONCURRENCY);
      await Promise.all(batch.map(async (task) => {
        const label = `${task.i + 1}/${playlist.items.length}`;
        try {
          await this.storage.downloadToFile(task.srcKey, task.destPath);
          if (task.type === 'raw') {
            await this.ensureFaststart(task.rawPath).catch(() => {});
          }
          downloadedMap.set(task.i, task.destPath);
          if (task.type === 'raw') pendingNorm.push({ rawPath: task.rawPath, normPath: task.normPath });
          else normalizedSet.add(task.i);
          totalDuration += task.duration;
          this.log(session, `  ✓ [${task.type}] ${label} · ${task.duration.toFixed(1)}s`);
        } catch (err: any) {
          this.log(session, `  ERROR descargando ${label}: ${err.message}`);
        }
      }));
    }

    // ── Normalización broadcast EN BACKGROUND ────────────────────────────────────
    //
    // FFmpeg arranca INMEDIATAMENTE con los archivos disponibles:
    //
    //   · Videos con prenorm en S3 (Opción B) → normPath descargado → allNormalized=true
    //     → FFmpeg usa Ruta B (stream-copy). Sin re-encode, sin delay.
    //
    //   · Videos sin prenorm (raw) → rawPath descargado → allNormalized=false
    //     → FFmpeg usa Ruta C (re-encode en tiempo real). Emite en segundos.
    //     → Normalización corre en background. Al terminar: reinicio limpio
    //       → próximo arranque usa normPath del caché → Ruta B stream-copy.
    //
    // La clave: NUNCA bloqueamos esperando la normalización. El canal emite
    // en cuanto los archivos (raw o prenorm) están descargados.

    const allNormalized = pendingNorm.length === 0;

    if (allNormalized) {
      this.log(session, `✓ Todo broadcast-ready → stream-copy desde el primer frame`);
    } else if (!session.bgNormRunning) {
      // Lanzar normalización en background: no bloquea el arranque
      session.bgNormRunning = true;
      this.log(session, `⚙ Normalizando ${pendingNorm.length} video(s) en background — FFmpeg arranca con raw (re-encode)`);
      const normQueue = [...pendingNorm].sort((a, b) => {
        const dA = playlist.items.find(it => a.rawPath.includes(it.video.id))?.video.duration ?? 0;
        const dB = playlist.items.find(it => b.rawPath.includes(it.video.id))?.video.duration ?? 0;
        return dA - dB; // más cortos primero
      });
      (async () => {
        let done = 0;
        for (const { rawPath, normPath } of normQueue) {
          if (session.stopping) { session.bgNormRunning = false; return; }
          try {
            await this.normalizeVideoForBroadcast(rawPath, normPath, qualityEarly);
            done++;
            this.log(session, `  ✓ [bg-norm] ${done}/${normQueue.length} → ${path.basename(normPath)}`);
          } catch (err: any) {
            this.log(session, `  ✗ [bg-norm] falló ${path.basename(rawPath)}: ${err.message}`);
          }
        }
        session.bgNormRunning = false;
        if (!session.stopping && this.sessions.has(session.channelId)) {
          if (done > 0 && session.process) {
            // Al menos un video se normalizó: reiniciar FFmpeg para usar stream-copy en
            // el próximo ciclo. Con resume por horario la interrupción es < 4s y el
            // canal retoma exactamente donde estaba. Los archivos prenorm eliminan el
            // stall de transición que ocurre al abrir un MP4 raw sin faststart.
            this.log(session, `✓ [bg-norm] ${done}/${normQueue.length} completados → reiniciando para stream-copy`);
            session.scheduleChangePending = true;
            try { session.process.kill('SIGTERM'); } catch {}
          } else {
            this.log(session, `✓ Normalización completa (${done}/${normQueue.length}) → listos para próximo inicio`);
          }
        }
      })();
    } else {
      this.log(session, `⚙ Normalización background ya en progreso — FFmpeg arranca con raw disponible`);
    }
    // downloadedMap ya tiene los rawPaths; FFmpeg los usará con Ruta C.
    // El reinicio post-norm resolverá los normPaths del caché persistente.

    this.log(session, `Preparación: ${downloadedMap.size} video(s) · ${(totalDuration / 60).toFixed(1)} min`);

    if (downloadedMap.size === 0) {
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
              include: { video: { select: { id: true, originalKey: true, processedKey: true, norm480pKey: true, norm720pKey: true, norm1080pKey: true, duration: true, status: true } } },
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
    // Registra el índice en concatLines donde empieza el contenido de cada ítem del playlist
    // (DESPUÉS de sus pre-rolls, ANTES de la primera línea `file`). Usado para resume via inpoint.
    const videoStartLineIdx = new Map<number, number>();
    let totalAdsInjected = 0;
    let intervalElapsed = 0; // segundos de contenido acumulados desde la última tanda de intervalo

    // Tracking de tiempo para suppress-overlays: calculamos los rangos de segundos
    // dentro del concat que corresponden a publicidad con suppressOverlays=true.
    // Estos rangos se usan para generar expresiones :enable='...' en buildOverlayFilter.
    let currentConcatTime = 0;
    const adTimeRanges: { start: number; end: number }[] = [];

    /** Inserta los spots rotados de un bloque en concatLines (fire-and-forget para impresiones) */
    const insertBlock = async (adBlock: any, type: string) => {
      const spots = await this.adBlocksService.getRotatedSpots(adBlock as AdBlockForPlayout);
      const blockStart = currentConcatTime;
      for (const spot of spots) {
        const adPath = adDownloads.get(spot.videoId);
        if (!adPath) continue;
        const spotDur = spot.video.duration ?? 30;
        concatLines.push(`file '${adPath}'`);
        concatLines.push(`duration ${spotDur.toFixed(3)}`);
        currentConcatTime += spotDur;
        totalAdsInjected++;
        this.adBlocksService.recordImpression(
          spot.id, adBlock.id, session.channelId,
          spot.advertiser, type, spot.video.duration,
        ).catch(() => {});
      }
      if ((adBlock as any).suppressOverlays && currentConcatTime > blockStart) {
        adTimeRanges.push({ start: blockStart, end: currentConcatTime });
      }
    };

    // 4a. Pre-tanda del programa (schedule)
    if (scheduleEntry?.preAdBlock) {
      await insertBlock(scheduleEntry.preAdBlock, 'PRE_ROLL');
    }

    // 4b. Contenido: videos con cue-points y cortes de intervalo automático
    for (let i = 0; i < playlist.items.length; i++) {
      const item      = playlist.items[i];
      const mp4Path   = downloadedMap.get(i); // índice correcto incluso si hubo descargas fallidas
      if (!mp4Path) continue;
      const videoId       = item.video.id;
      const videoDuration = item.video.duration ?? 0;

      const videoCues = cuePoints.filter((cp) => cp.videoId === videoId);
      const preRolls  = videoCues.filter((cp) => cp.type === 'PRE_ROLL');
      const postRolls = videoCues.filter((cp) => cp.type === 'POST_ROLL');
      const midRolls  = videoCues
        .filter((cp) => cp.type === 'MID_ROLL' && cp.timeOffset != null)
        .sort((a, b) => (a.timeOffset ?? 0) - (b.timeOffset ?? 0));

      // PRE_ROLL de cue points
      for (const cp of preRolls) await insertBlock(cp.adBlock, 'PRE_ROLL');

      // Registrar dónde empieza el contenido de este ítem (tras pre-rolls, antes del primer `file`)
      videoStartLineIdx.set(i, concatLines.length);

      // Video principal (con posibles MID_ROLLs de cue points)
      if (midRolls.length === 0) {
        const segDur = (item.trimEnd ?? videoDuration) - (item.trimStart ?? 0);
        concatLines.push(`file '${mp4Path}'`);
        if (item.trimStart) concatLines.push(`inpoint ${item.trimStart}`);
        if (item.trimEnd)   concatLines.push(`outpoint ${item.trimEnd}`);
        if (normalizedSet.has(i)) concatLines.push(`duration ${segDur.toFixed(3)}`);
        currentConcatTime += segDur;
      } else {
        let inpoint: number = item.trimStart ?? 0;
        for (const cp of midRolls) {
          const outpoint = cp.timeOffset!;
          const segDur = outpoint - inpoint;
          concatLines.push(`file '${mp4Path}'`);
          if (inpoint > 0) concatLines.push(`inpoint ${inpoint}`);
          concatLines.push(`outpoint ${outpoint}`);
          if (normalizedSet.has(i)) concatLines.push(`duration ${segDur.toFixed(3)}`);
          currentConcatTime += segDur;
          await insertBlock(cp.adBlock, 'MID_ROLL');
          inpoint = outpoint;
        }
        const lastSegDur = (item.trimEnd ?? videoDuration) - inpoint;
        concatLines.push(`file '${mp4Path}'`);
        if (inpoint > 0)   concatLines.push(`inpoint ${inpoint}`);
        if (item.trimEnd)  concatLines.push(`outpoint ${item.trimEnd}`);
        if (normalizedSet.has(i)) concatLines.push(`duration ${lastSegDur.toFixed(3)}`);
        currentConcatTime += lastSegDur;
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

    // ── 4d. Relleno de slot ───────────────────────────────────────────────────────
    //
    // Si el contenido del programa es más corto que la duración del slot del schedule,
    // se descargan videos de la fillerPlaylist (configurada en el schedule o en el canal)
    // y se agregan al concat hasta cubrir el tiempo restante del slot.
    // Esto evita que el programa loopee y produce un ciclo limpio [programa + relleno].
    const gapSeconds = scheduleEndTime
      ? Math.max(0, (scheduleEndTime.getTime() - Date.now()) / 1000 - totalDuration)
      : 0;

    if (gapSeconds > 30 && fillerPlaylist && fillerPlaylist.items.length > 0) {
      this.log(session, `Relleno: gap de ${(gapSeconds / 60).toFixed(1)}min → "${fillerPlaylist.name}"`);

      type FillerEntry = { localPath: string; duration: number; isNorm: boolean };
      const fillerEntries: FillerEntry[] = [];

      for (const item of fillerPlaylist.items) {
        if (session.stopping) break;
        const videoId   = item.video.id;
        const dur       = item.video.duration ?? 0;
        if (dur <= 0) continue;

        const normPath  = path.join(normCacheDir, `norm_${qKeyEarly}_${videoId}.mp4`);
        const rawPath   = path.join(videosDir,    `raw_${videoId}.mp4`);
        const normKeyDb: string | null | undefined =
          qKeyEarly === '480p'  ? item.video.norm480pKey  :
          qKeyEarly === '720p'  ? item.video.norm720pKey  :
          qKeyEarly === '1080p' ? item.video.norm1080pKey : null;

        // 1. Caché norm en disco
        let normExists = false;
        try { await fs.access(normPath); normExists = true; } catch { /* no existe */ }
        if (normExists) { fillerEntries.push({ localPath: normPath, duration: dur, isNorm: true }); continue; }

        // 2. Pre-normalizado en S3
        if (normKeyDb) {
          try {
            await this.storage.downloadToFile(normKeyDb, normPath);
            fillerEntries.push({ localPath: normPath, duration: dur, isNorm: true });
            this.log(session, `  ✓ [filler-prenorm] ${videoId}`);
            continue;
          } catch { /* fallback a raw */ }
        }

        // 3. Raw
        const rawKey = item.video.processedKey ?? item.video.originalKey;
        if (!rawKey) continue;
        let rawExists = false;
        try { await fs.access(rawPath); rawExists = true; } catch { /* no existe */ }
        if (!rawExists) {
          try {
            await this.storage.downloadToFile(rawKey, rawPath);
            await this.ensureFaststart(rawPath).catch(() => {});
          } catch { continue; }
        }
        fillerEntries.push({ localPath: rawPath, duration: dur, isNorm: false });
        this.log(session, `  ✓ [filler-raw] ${videoId}`);
      }

      if (fillerEntries.length > 0) {
        let filled = 0;
        let passes = 0;
        while (filled < gapSeconds - 1 && passes < 200) {
          for (const f of fillerEntries) {
            if (filled >= gapSeconds - 1) break;
            concatLines.push(`file '${f.localPath}'`);
            if (f.isNorm) concatLines.push(`duration ${f.duration.toFixed(3)}`);
            filled            += f.duration;
            currentConcatTime += f.duration;
          }
          passes++;
        }
        totalDuration += filled;
        this.log(session, `  ✓ Relleno listo: ${(filled / 60).toFixed(1)}min (${fillerEntries.length} video(s))`);
      } else {
        this.log(session, '  WARN: Ningún video de relleno pudo descargarse');
      }
    }

    // ── Reanudación por horario: calcular posición correcta en el ciclo ─────────
    //
    // Cuando FFmpeg reinicia (stall, schedule-change, crash), la emisión debe
    // continuar donde le corresponde según el reloj del canal.
    //
    // Ancla (por prioridad):
    //   1. scheduleEntry.startTime — hay un programa activo con hora conocida
    //   2. session.contentStartedAt — canal llevaba emitiendo desde esa marca
    //   3. Sin ancla (primer arranque) → sin resume, empieza desde el principio
    //
    // IMPORTANTE: el concat demuxer NO soporta seek global con -ss. La solución
    // correcta es partir la primera copia del ciclo a partir del video correcto
    // y agregar la directiva `inpoint` al primer archivo en el concat.
    let resumeSeekSeconds = 0;
    if (scheduleEntry?.startTime) {
      const elapsedMs = Date.now() - (scheduleEntry.startTime as Date).getTime();
      resumeSeekSeconds = Math.max(0, elapsedMs / 1000);
    } else if (session.contentStartedAt) {
      const elapsedMs = Date.now() - session.contentStartedAt;
      resumeSeekSeconds = Math.max(0, elapsedMs / 1000);
    }

    // Usar solo la duración de contenido (sin filler) para el módulo.
    // El filler rota aleatoriamente y no tiene posición fija que "reanudar".
    const contentDurationForResume = playlist.items.reduce((sum, pItem) => {
      const ts = pItem.trimStart ?? 0;
      const te = pItem.trimEnd ?? (pItem.video.duration ?? 0);
      return sum + Math.max(0, te - ts);
    }, 0);

    let resumeVideoIndex = 0;
    let resumeVideoOffset = 0; // posición absoluta dentro del archivo (incluye trimStart)
    if (resumeSeekSeconds > 5 && contentDurationForResume > 0) {
      const seekInCycle = resumeSeekSeconds % contentDurationForResume;
      let cumDur = 0;
      for (let idx = 0; idx < playlist.items.length; idx++) {
        const pItem  = playlist.items[idx];
        const ts     = pItem.trimStart ?? 0;
        const te     = pItem.trimEnd ?? (pItem.video.duration ?? 0);
        const segDur = Math.max(0, te - ts);
        if (cumDur + segDur > seekInCycle) {
          resumeVideoIndex  = idx;
          resumeVideoOffset = (seekInCycle - cumDur) + ts;
          break;
        }
        cumDur += segDur;
      }
      this.log(
        session,
        `⏩ Reanudando en video ${resumeVideoIndex + 1}/${playlist.items.length}` +
        ` · ${resumeVideoOffset.toFixed(1)}s` +
        ` (${(resumeSeekSeconds / 60).toFixed(1)}min transcurridos · ciclo ${(contentDurationForResume / 60).toFixed(1)}min)`,
      );
    }

    // ── Expansión del concat para cobertura ~24h sin -stream_loop ────────────────
    const COVERAGE_SECONDS = 24 * 3600;
    const loopCount = totalDuration > 0
      ? Math.max(1, Math.ceil((COVERAGE_SECONDS + resumeSeekSeconds) / totalDuration))
      : 50;

    // ── Construir concat expandido con inpoint para reanudación frame-accurate ───
    //
    // La primera "vuelta" del concat comienza en el video correcto (startLine).
    // Se agrega `inpoint resumeVideoOffset` al primer archivo para saltar dentro
    // del video sin leer el archivo desde el inicio (seek dentro del MP4 individual).
    // Las vueltas siguientes son ciclos completos desde el video 0.
    const startLine = (resumeVideoIndex > 0 || resumeVideoOffset > 5)
      ? (videoStartLineIdx.get(resumeVideoIndex) ?? 0)
      : 0;
    let firstCycleFragment = [...concatLines.slice(startLine)];

    if (resumeVideoOffset > 5 && firstCycleFragment.length > 0) {
      const firstFileLineIdx = firstCycleFragment.findIndex(l => l.startsWith("file '"));
      if (firstFileLineIdx >= 0) {
        const insertAt = firstFileLineIdx + 1;
        if (firstCycleFragment[insertAt]?.startsWith('inpoint ')) {
          // Ya existe inpoint (trimStart del item) → usar el mayor de los dos
          const existing = parseFloat(firstCycleFragment[insertAt].replace('inpoint ', ''));
          firstCycleFragment[insertAt] = `inpoint ${Math.max(existing, resumeVideoOffset).toFixed(3)}`;
        } else {
          firstCycleFragment.splice(insertAt, 0, `inpoint ${resumeVideoOffset.toFixed(3)}`);
        }
      }
    }

    const remainingCycles = Array.from({ length: Math.max(0, loopCount - 1) }, () => concatLines).flat();
    const expandedLines = startLine === 0 && resumeVideoOffset <= 5
      ? (loopCount > 1 ? Array.from({ length: loopCount }, () => concatLines).flat() : concatLines)
      : [...firstCycleFragment, ...remainingCycles];

    if (loopCount > 1) {
      this.log(session, `Playlist expandida: ${loopCount}× → ~${Math.round(totalDuration * loopCount / 3600)}h de emisión continua sin wrap-around`);
    }
    await fs.writeFile(concatPath, expandedLines.join('\n') + '\n');
    this.log(
      session,
      `concat.txt: ${downloadedMap.size} video(s)${totalAdsInjected > 0 ? ` + ${totalAdsInjected} spot(s) publicitario(s)` : ' (sin publicidad)'}`,
    );

    // 4. Calidad de emisión (ya leída en el paso 2 para la normalización)
    const qKey    = qKeyEarly;
    const quality = qualityEarly;
    const scale   = quality.scale;
    this.log(session, `Calidad: ${qKey} → ${scale} @ ${quality.vBitrate} video / ${quality.aBitrate} audio`);

    // Expandir rangos de supresión de overlays para todos los ciclos repetidos.
    // currentConcatTime ahora contiene la duración real de 1 ciclo del concat.
    const baseCycleDuration = currentConcatTime;
    const expandedAdRanges: { start: number; end: number }[] = [];
    if (adTimeRanges.length > 0 && baseCycleDuration > 0) {
      for (let rep = 0; rep < loopCount; rep++) {
        for (const r of adTimeRanges) {
          expandedAdRanges.push({
            start: r.start + rep * baseCycleDuration,
            end:   r.end   + rep * baseCycleDuration,
          });
        }
      }
      this.log(session, `Overlay suppression: ${adTimeRanges.length} tanda(s) × ${loopCount} ciclos = ${expandedAdRanges.length} ventanas sin overlays`);
    }

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
      ? await this.buildOverlayFilter(session, overlays, scale, expandedAdRanges)
      : null;

    this.log(session, overlayFilter
      ? `Overlays activos: ${overlays.length} → filter_complex`
      : 'Sin overlays → encode directo');

    // Inicializar archivos de temperatura para overlays TEMPERATURE.
    // FFmpeg usa textfile=+reload=1 para leer el valor en cada frame.
    // El archivo debe existir ANTES de arrancar FFmpeg.
    const effectiveOvs = overlayFilter ? overlays.filter(o => o.enabled) : [];
    for (const ov of effectiveOvs) {
      if (ov.type === OverlayType.TEMPERATURE) {
        await this.writeTempFile(session, ov);
      }
      if (ov.type === OverlayType.TICKER || ov.type === OverlayType.TEXT_SCROLL) {
        const cfg = ov.config as any;
        const tickerFile = `/tmp/cloudtv-ticker-${session.channelId}-${ov.id}.txt`;
        if (cfg.textSource === 'rss' && cfg.rssUrl) {
          try {
            const text = await this.fetchRssFeed(cfg.rssUrl, cfg.rssItems ?? 5);
            await fs.writeFile(tickerFile, text, 'utf8');
            this.log(session, `✓ [rss] Feed cargado (${(cfg.rssItems ?? 5)} noticias): ${text.slice(0, 60)}…`);
          } catch (e: any) {
            this.log(session, `WARN: [rss] No se pudo obtener feed, usando texto de respaldo: ${e.message}`);
            await fs.writeFile(tickerFile, cfg.text ?? '', 'utf8').catch(() => {});
          }
        } else {
          await fs.writeFile(tickerFile, cfg.text ?? '', 'utf8').catch(() => {});
        }
      }
    }
    this.startTempRefresh(session, effectiveOvs);
    this.startRssRefresh(session, effectiveOvs);

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
      // Permite que el muxer HLS emita paquetes aunque lleguen ligeramente fuera de
      // orden en el tiempo. Sin esto, pequeñas discontinuidades de DTS en la
      // transición entre clips del concat disparan "Non-monotonous DTS" warnings y
      // pueden hacer que el muxer descarte paquetes de audio.
      '-max_interleave_delta', '0',
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

    // Filtro de audio (decode+encode paths — overlays o re-encode de raw).
    // aresample async=10000: compensa hasta ±111ms de drift de PTS en transiciones
    // entre clips del concat (aumentado desde 1000 para evitar "Queue input is
    // backward in time" cuando un raw file tiene timestamps ligeramente irregulares).
    // aformat: convierte cualquier layout (mono, 5.1…) a estéreo antes del encoder.
    const audioFilter = 'aformat=channel_layouts=stereo,aresample=async=10000';

    // Para el camino con overlays: el audio se incluye dentro del mismo filter_complex
    const finalFilterComplex = overlayFilter
      ? `${overlayFilter.filterComplex};[0:a]${audioFilter}[aout]`
      : null;

    // Filtro de video para el camino de re-encode sin overlays (archivos raw/mix).
    // Sin setpts=PTS-STARTPTS: el concat demuxer garantiza PTS monotónico entre archivos.
    const normalizeVf = `scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2:black,fps=25,format=yuv420p`;

    // Flags de tolerancia en el input: descarta paquetes corruptos / regenera PTS faltantes.
    // probesize + analyzeduration: limitan cuánto sondea FFmpeg cada archivo al hacer
    // la transición entre clips del concat. Sin esto, un MP4 con moov al final puede
    // causar un stall de 30-60s mientras FFmpeg busca los metadatos del siguiente archivo.
    const inputFlags = [
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-probesize', '4M',
      '-analyzeduration', '5000000',
    ];

    // ─── RUTAS FFmpeg ──────────────────────────────────────────────────────────────
    //
    //   A) overlayFilter activo  → decode + filter_complex + encode
    //      Funciona con archivos raw O normalizados indistintamente.
    //
    //   B) allNormalized + sin overlays → stream-copy (-c copy)
    //      Cero decode/encode: transiciones frame-perfect, CPU mínimo.
    //      Req: todos los archivos son norm_*.mp4 (H.264/AAC · GOP=50 fijo).
    //
    //   C) archivos raw presentes + sin overlays → re-encode en tiempo real
    //      Mismo resultado visual que A sin overlays; la normalización corre en
    //      background y en el próximo reinicio se activa la ruta B.
    //
    // Nota: NO se usa -stream_loop -1.
    // El concat.txt tiene las entradas repetidas para ~24h (ver paso 4 arriba).
    // Al terminar (code=0), el close handler reinicia el proceso automáticamente.
    // -thread_queue_size 512: aumenta el buffer de paquetes del concat demuxer
    //   para absorber la latencia al abrir el siguiente archivo en una transición.
    // -max_muxing_queue_size 9999: aumenta la cola del muxer HLS para absorber
    //   variaciones de PTS en las transiciones entre archivos del concat.
    const args: string[] = overlayFilter
      ? [
          // Ruta A: decode + filter_complex + encode
          '-loglevel', 'warning',
          '-re',
          ...inputFlags,
          '-thread_queue_size', '512',
          '-f', 'concat', '-safe', '0', '-i', concatPath,
          ...overlayFilter.extraInputArgs,
          '-filter_complex', finalFilterComplex!,
          '-map', overlayFilter.videoMapLabel,
          '-map', '[aout]',
          ...codecArgs,
          '-max_muxing_queue_size', '9999',
          ...hlsArgs,
        ]
      : allNormalized
        ? [
            // Ruta B: stream-copy — bitstream pasa directo al muxer HLS sin decode/encode
            '-loglevel', 'warning',
            '-re',
            '-thread_queue_size', '512',
            '-f', 'concat', '-safe', '0', '-i', concatPath,
            '-c', 'copy',
            // H.264 en MP4 usa AVCC (length-prefix); MPEG-TS/HLS requiere Annex B (start codes).
            // FFmpeg debería aplicar esto automáticamente, pero con el concat demuxer
            // algunos builds no lo hacen → forzarlo explícitamente.
            '-bsf:v', 'h264_mp4toannexb',
            '-max_muxing_queue_size', '9999',
            ...hlsArgs,
          ]
        : [
            // Ruta C: re-encode en tiempo real (archivos raw, primer arranque)
            '-loglevel', 'warning',
            '-re',
            ...inputFlags,
            '-thread_queue_size', '512',
            '-f', 'concat', '-safe', '0', '-i', concatPath,
            '-vf', normalizeVf,
            '-af', audioFilter,
            ...codecArgs,
            '-max_muxing_queue_size', '9999',
            ...hlsArgs,
          ];

    this.log(session, overlayFilter
      ? `Lanzando FFmpeg HLS + overlays (decode → filter → encode)…`
      : allNormalized
        ? `Lanzando FFmpeg HLS stream-copy (broadcast-ready, sin re-encode)…`
        : `Lanzando FFmpeg HLS re-encode (raw; normalización en background)…`);
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
      // Arrancar watchdog de segmentos después de un período de gracia (20 s).
      // El watchdog detecta si FFmpeg deja de producir segmentos sin crashear
      // (stall silencioso al transicionar entre archivos raw de formatos distintos)
      // y reinicia automáticamente para usar más archivos normalizados.
      setTimeout(() => {
        if (!session.stopping && session.process === proc) {
          this.startSegmentWatchdog(session, m3u8Path);
        }
      }, 20_000);
    });

    proc.on('close', (code, sig) => {
      const uptime = Date.now() - spawnedAt;
      this.log(session, `FFmpeg terminó (code=${code} sig=${sig} uptime=${uptime}ms)`);
      session.process = null;
      // Detener watchdog de segmentos — el nuevo FFmpeg arrancará uno propio
      if (session.segmentWatchTimer) { clearTimeout(session.segmentWatchTimer); session.segmentWatchTimer = null; }

      if (session.stopping) return;
      if (session.activeIngestId) return; // ingesta tomó el control — no reiniciar playlist

      // ── Reinicio limpio: cambio de programa O normalización completada ──────────
      if (session.scheduleChangePending) {
        session.scheduleChangePending = false;
        this.log(session, 'Reiniciando (programación o normalización lista)…');
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

      // ── Caso 2: salida limpia code=0 (concat 24h completado) → reinicio sin fallo
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
          // Fijar hora de primer LIVE (??= → no se sobreescribe en reinicios sucesivos)
          session.contentStartedAt ??= Date.now();
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

    const needsReencode = !!(output.customBitrate || output.customQuality);
    const ffmpegArgs = (() => {
      if (!needsReencode) {
        // -live_start_index -3: conectar desde los 3 últimos segmentos del m3u8.
        // Sin esto, al reconectarse tras un reinicio de HLS, FFmpeg intenta leer
        // desde el número de segmento anterior (epoch-based, ej: 1750000000) y
        // el nuevo m3u8 solo tiene segmentos desde el nuevo epoch → "skipping N ahead".
        return ['-loglevel', 'warning', '-re', '-live_start_index', '-3', '-i', m3u8, '-c', 'copy', '-f', format, target];
      }
      const QUALITY_PRESETS: Record<string, { scale: string; aBitrate: string }> = {
        '480p':  { scale: 'scale=854:480',   aBitrate: '96k'  },
        '720p':  { scale: 'scale=1280:720',  aBitrate: '128k' },
        '1080p': { scale: 'scale=1920:1080', aBitrate: '192k' },
      };
      const preset = output.customQuality ? QUALITY_PRESETS[output.customQuality] : null;
      const vBitrate = `${output.customBitrate ?? 2000}k`;
      const vFilter  = preset ? ['-vf', preset.scale] : [];
      const aBitrate = preset?.aBitrate ?? '128k';
      return [
        '-loglevel', 'warning',
        '-re',
        '-i', m3u8,
        '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', vBitrate,
        '-maxrate', vBitrate, '-bufsize', `${(output.customBitrate ?? 2000) * 2}k`,
        ...vFilter,
        '-c:a', 'aac', '-b:a', aBitrate, '-ar', '44100',
        '-f', format,
        target,
      ];
    })();

    const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

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
    adTimeRanges: { start: number; end: number }[] = [],
  ): Promise<{ filterComplex: string; extraInputArgs: string[]; videoMapLabel: string } | null> {
    // Construir expresión enable: "1" (siempre) o "not(between(t,s1,e1)+...)" (fuera de tandas)
    const enableExpr = adTimeRanges.length > 0
      ? `not(${adTimeRanges.map(r => `between(t,${r.start.toFixed(2)},${r.end.toFixed(2)})`).join('+')})`
      : null;
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

    // Helper: añade :enable='<expr>' al final de una cadena de filtro FFmpeg
    const withEnable = (filter: string) =>
      enableExpr ? `${filter}:enable='${enableExpr}'` : filter;

    const filterParts: string[] = [];
    const extraInputPaths: string[] = [];
    // Normalización: escalar + rellenar negro + convertir a 25fps yuv420p.
    // NO usar setpts=PTS-STARTPTS: el concat demuxer ya garantiza PTS monotónico
    // y setpts=PTS-STARTPTS corrompe timestamps cuando el primer frame tiene PTS≠0
    // (común en archivos raw, lo cual produce freezes al transicionar entre clips).
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
        const pos     = this.logoXY(cfg);
        const opacity = cfg.opacity ?? 1;
        const sl      = `sc${idx}`;

        // Construir pipeline de pre-procesado del logo (scale + opacidad)
        if (cfg.width && opacity < 1) {
          filterParts.push(`[${inputIdx}:v]scale=${cfg.width}:-1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[${sl}]`);
          filterParts.push(withEnable(`[${currentStream}][${sl}]overlay=${pos}:eof_action=repeat`) + `[${nextStream}]`);
        } else if (cfg.width) {
          filterParts.push(`[${inputIdx}:v]scale=${cfg.width}:-1[${sl}]`);
          filterParts.push(withEnable(`[${currentStream}][${sl}]overlay=${pos}:eof_action=repeat`) + `[${nextStream}]`);
        } else if (opacity < 1) {
          filterParts.push(`[${inputIdx}:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[${sl}]`);
          filterParts.push(withEnable(`[${currentStream}][${sl}]overlay=${pos}:eof_action=repeat`) + `[${nextStream}]`);
        } else {
          filterParts.push(withEnable(`[${currentStream}][${inputIdx}:v]overlay=${pos}:eof_action=repeat`) + `[${nextStream}]`);
        }

      } else if (ov.type === OverlayType.TEXT_STATIC) {
        const text = this.escapeText(cfg.text ?? '');
        const font = cfg.bold ? FONT_BOLD : FONT;
        const box  = `:box=1:boxcolor=${cfg.bgColor ?? 'black@0.5'}:boxborderw=8`;
        filterParts.push(withEnable(
          `[${currentStream}]drawtext=fontfile=${font}:text=${text}:fontsize=${cfg.fontSize ?? 24}:fontcolor=${cfg.fontColor ?? 'white'}:${this.textXY(cfg)}${box}:fix_bounds=1`,
        ) + `[${nextStream}]`);

      } else if (ov.type === OverlayType.CLOCK) {
        // expansion=strftime: drawtext evalúa la cadena como strftime() usando el TZ
        // del proceso (ver ffmpegEnv más arriba).
        // time_short → %R  (HH:MM, sin segundos) ← default
        // time        → %T  (HH:MM:SS)
        // datetime    → fecha + hora completa
        // Los ':' en los formatos de fecha deben escaparse con '\:' (separadores de opciones FFmpeg).
        const fmt = cfg.format === 'datetime'
          ? '%d/%m/%Y %H\\:%M\\:%S'
          : cfg.format === 'time'
            ? '%T'
            : '%R'; // default: time_short
        const box = `:box=1:boxcolor=${cfg.bgColor ?? 'black@0.6'}:boxborderw=10`;
        filterParts.push(withEnable(
          `[${currentStream}]drawtext=fontfile=${FONT_BOLD}:text=${fmt}:expansion=strftime:fontsize=${cfg.fontSize ?? 28}:fontcolor=${cfg.fontColor ?? 'white'}:${this.textXY(cfg)}${box}:fix_bounds=1`,
        ) + `[${nextStream}]`);

      } else if (ov.type === OverlayType.TEXT_SCROLL || ov.type === OverlayType.TICKER) {
        const barH    = cfg.barHeight ?? 36;
        const offX    = cfg.offsetX ?? 0;  // margen izquierdo de la banda en px (+ derecha / − no aplica)
        const offY    = cfg.offsetY ?? 0;  // desplazamiento vertical en px (+ abajo / − arriba desde el ancla)
        const isBot   = (cfg.position ?? 'bottom') !== 'top';
        // drawbox usa iw/ih; offsets calculados en JS para evitar expresiones complejas en el filtro
        const barX    = Math.max(0, offX);
        const barW    = `iw-${barX}`;
        const barY    = isBot ? `ih-${barH + offY}` : `${Math.max(0, offY)}`;
        const textY   = isBot ? `H-${barH + offY}+(${barH}-text_h)/2` : `${Math.max(0, offY)}+(${barH}-text_h)/2`;
        // scrollX: el texto entra por el borde derecho (W) y sale por la izquierda (-text_w)
        // SIN fix_bounds — el texto DEBE poder salirse de pantalla para que el scroll sea visible
        const scrollX = `W-mod(t*${cfg.speed ?? 80}\\,W+text_w)`;
        // Archivo ya escrito en pre-flight (writeTempFile/fetchRssFeed antes de arrancar FFmpeg)
        const tickerFile = `/tmp/cloudtv-ticker-${session.channelId}-${ov.id}.txt`;
        const barLabel = `bar${idx}`;
        filterParts.push(withEnable(
          `[${currentStream}]drawbox=x=${barX}:y=${barY}:w=${barW}:h=${barH}:color=${cfg.bgColor ?? 'black@0.7'}:t=fill`,
        ) + `[${barLabel}]`);
        filterParts.push(withEnable(
          `[${barLabel}]drawtext=fontfile=${FONT}:textfile=${tickerFile}:reload=1:fontsize=${cfg.fontSize ?? 20}:fontcolor=${cfg.fontColor ?? 'white'}:x=${scrollX}:y=${textY}`,
        ) + `[${nextStream}]`);

      } else if (ov.type === OverlayType.TEMPERATURE) {
        // TEMPERATURE: lee la temperatura desde un archivo temporal actualizado periódicamente.
        // textfile= + reload=1 → FFmpeg re-lee el archivo en cada frame (~10B, costo mínimo).
        // El archivo es escrito por writeTempFile() antes de arrancar y por startTempRefresh() cada 10 min.
        const tempFile = `/tmp/cloudtv-wtemp-${session.channelId}-${ov.id}.txt`;
        const box      = `:box=1:boxcolor=${cfg.bgColor ?? 'black@0.6'}:boxborderw=10`;
        filterParts.push(withEnable(
          `[${currentStream}]drawtext=fontfile=${FONT_BOLD}:textfile=${tempFile}:reload=1:fontsize=${cfg.fontSize ?? 28}:fontcolor=${cfg.fontColor ?? 'white'}:${this.textXY(cfg)}${box}:fix_bounds=1`,
        ) + `[${nextStream}]`);

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
    const p  = 10;
    const ox = cfg.offsetX ?? 0;
    const oy = cfg.offsetY ?? 0;
    const xOff = ox >= 0 ? `+${ox}` : `${ox}`;
    const yOff = oy >= 0 ? `+${oy}` : `${oy}`;
    switch (cfg.position ?? 'top-left') {
      case 'top-right':    return `W-w-${p}${xOff}:${p}${yOff}`;
      case 'bottom-left':  return `${p}${xOff}:H-h-${p}${yOff}`;
      case 'bottom-right': return `W-w-${p}${xOff}:H-h-${p}${yOff}`;
      case 'center':       return `(W-w)/2${xOff}:(H-h)/2${yOff}`;
      case 'custom':       return `${cfg.x ?? p}:${cfg.y ?? p}`;
      default:             return `${p}${xOff}:${p}${yOff}`;
    }
  }

  private textXY(cfg: any): string {
    const p  = 10;
    const ox = cfg.offsetX ?? 0;
    const oy = cfg.offsetY ?? 0;
    // xOff/yOff: desplazamiento adicional sobre la posición ancla.
    // Positivo X = mover a la derecha; positivo Y = mover hacia abajo.
    const xOff = ox >= 0 ? `+${ox}` : `${ox}`;
    const yOff = oy >= 0 ? `+${oy}` : `${oy}`;
    switch (cfg.position ?? 'top-left') {
      case 'top-right':    return `x=W-text_w-${p}${xOff}:y=${p}${yOff}`;
      case 'bottom-left':  return `x=${p}${xOff}:y=H-text_h-${p}${yOff}`;
      case 'bottom-right': return `x=W-text_w-${p}${xOff}:y=H-text_h-${p}${yOff}`;
      case 'center':       return `x=(W-text_w)/2${xOff}:y=(H-text_h)/2${yOff}`;
      case 'custom':       return `x=${cfg.x ?? p}:y=${cfg.y ?? p}`;
      default:             return `x=${p}${xOff}:y=${p}${yOff}`;
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

  // ─── Temperatura (TEMPERATURE overlay) ────────────────────────

  /**
   * Obtiene la temperatura actual de una ciudad desde wttr.in y la escribe
   * en un archivo temporal que FFmpeg lee frame a frame con textfile=+reload=1.
   * Si la petición falla, escribe "--°C" / "--°F" para que el overlay muestre
   * algo en lugar de crashear.
   */
  /**
   * Escribe el archivo de temperatura para el overlay.
   *
   * El archivo se crea INMEDIATAMENTE con el valor de fallback ("--°C/F") para que
   * FFmpeg pueda arrancar sin esperar la red. Luego, en background, se consulta
   * wttr.in y si tiene éxito se actualiza el archivo; drawtext lo leerá en el
   * siguiente frame gracias a reload=1.
   *
   * Evita el bloqueo de 8 s (timeout de red) que retrasaba el arranque del canal.
   */
  private async writeTempFile(session: PlayoutSession, overlay: Overlay): Promise<void> {
    const cfg      = overlay.config as any;
    const city     = ((cfg.city as string) ?? 'Buenos Aires').trim();
    const isFahr   = (cfg.unit as string) === 'fahrenheit';
    const showUnit = cfg.showUnit !== false;
    const filePath = `/tmp/cloudtv-wtemp-${session.channelId}-${overlay.id}.txt`;
    const fallback = isFahr ? '--F' : '--C';   // ASCII: el grado se añade en el fetch

    // Paso 1: escribir placeholder INMEDIATAMENTE para que FFmpeg arranque sin esperar
    await fs.writeFile(filePath, fallback, 'utf8');

    // Paso 2: obtener temperatura real en background (no bloquea el arranque)
    const fetchTemp = async () => {
      try {
        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), 3_000); // 3 s — falla rápido si no hay red
        const resp = await fetch(
          `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
          { signal: controller.signal },
        );
        clearTimeout(timer);
        if (resp.ok) {
          const json = await resp.json() as any;
          const cond = json.current_condition?.[0];
          if (cond) {
            const raw    = isFahr ? (cond.temp_F as string) : (cond.temp_C as string);
            const unit   = isFahr ? 'F' : 'C';
            const content = showUnit ? `${raw}${unit}` : `${raw}`;
            await fs.writeFile(filePath, content, 'utf8');
            this.log(session, `  ✓ Temperatura "${overlay.name}" (${city}): ${content}`);
          }
        }
      } catch (err: any) {
        this.log(session, `  WARN: Temperatura "${overlay.name}" no disponible (${err?.message ?? err})`);
      }
    };
    fetchTemp().catch(() => {});
  }

  /**
   * Inicia un timer que actualiza el archivo de temperatura cada 10 minutos.
   * Se llama tras cada launchFfmpeg para resetear el ciclo.
   * Si no hay overlays TEMPERATURE activos, cancela cualquier timer previo.
   */
  private startTempRefresh(session: PlayoutSession, enabledOverlays: Overlay[]): void {
    if (session.tempRefreshTimer) {
      clearTimeout(session.tempRefreshTimer);
      session.tempRefreshTimer = null;
    }

    const tempOvs = enabledOverlays.filter(o => o.type === OverlayType.TEMPERATURE);
    if (tempOvs.length === 0) return;

    const REFRESH_MS = 10 * 60 * 1_000; // 10 minutos

    const refresh = async () => {
      if (session.stopping || !this.sessions.has(session.channelId)) return;
      for (const ov of tempOvs) {
        await this.writeTempFile(session, ov).catch(() => {/* silencioso */});
      }
      if (!session.stopping && this.sessions.has(session.channelId)) {
        session.tempRefreshTimer = setTimeout(refresh, REFRESH_MS);
      }
    };

    session.tempRefreshTimer = setTimeout(refresh, REFRESH_MS);
  }

  // ─── RSS ticker refresh ────────────────────────────────────────

  /** Descarga y parsea un feed RSS/Atom, devuelve los títulos unidos por separador. */
  private async fetchRssFeed(url: string, maxItems: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const xml = await resp.text();

      // Captura títulos de RSS 2.0 (<item>) y Atom (<entry>)
      // Soporta texto plano, CDATA y entidades HTML básicas
      const titles: string[] = [];
      const re = /<(?:item|entry)[\s>][\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?<\/title>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null && titles.length < maxItems) {
        const title = m[1]
          .replace(/&amp;/g,  '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
          .replace(/<[^>]+>/g, '')   // quitar tags anidados
          .replace(/\s+/g, ' ')
          .trim();
        if (title) titles.push(title);
      }
      if (titles.length === 0) throw new Error('No se encontraron títulos en el feed');
      return titles.join('   ●   ');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Inicia refresh periódico del ticker RSS. Se llama tras cada launchFfmpeg. */
  private startRssRefresh(session: PlayoutSession, enabledOverlays: Overlay[]): void {
    if (session.rssRefreshTimer) {
      clearTimeout(session.rssRefreshTimer);
      session.rssRefreshTimer = null;
    }

    const rssOvs = enabledOverlays.filter(o =>
      (o.type === OverlayType.TICKER || o.type === OverlayType.TEXT_SCROLL) &&
      (o.config as any).textSource === 'rss' && (o.config as any).rssUrl,
    );
    if (rssOvs.length === 0) return;

    // Usa el menor intervalo configurado entre todos los tickers RSS (mín. 5 min)
    const minMin = rssOvs.reduce((min, o) => Math.min(min, (o.config as any).rssRefreshMin ?? 10), 60);
    const REFRESH_MS = Math.max(5, minMin) * 60_000;

    const refresh = async () => {
      if (session.stopping || !this.sessions.has(session.channelId)) return;
      for (const ov of rssOvs) {
        const cfg = ov.config as any;
        const tickerFile = `/tmp/cloudtv-ticker-${session.channelId}-${ov.id}.txt`;
        try {
          const text = await this.fetchRssFeed(cfg.rssUrl, cfg.rssItems ?? 5);
          await fs.writeFile(tickerFile, text, 'utf8');
          this.log(session, `✓ [rss] Ticker refrescado: ${text.slice(0, 50)}…`);
        } catch (e: any) {
          this.log(session, `WARN: [rss] Error refrescando ticker: ${e.message}`);
        }
      }
      if (!session.stopping && this.sessions.has(session.channelId)) {
        session.rssRefreshTimer = setTimeout(refresh, REFRESH_MS);
      }
    };

    session.rssRefreshTimer = setTimeout(refresh, REFRESH_MS);
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
      include: { video: { select: { id: true, originalKey: true, processedKey: true, norm480pKey: true, norm720pKey: true, norm1080pKey: true, duration: true, status: true } } },
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
   * Normaliza en background los archivos raw que aún no tienen caché norm_*.mp4.
   * Se ejecuta de forma asíncrona mientras el stream ya está corriendo.
   * Cuando termina, el próximo reinicio detectará todos los norm en caché
   * y usará stream-copy (ruta B, sin decode/encode).
   */
  /**
   * Watchdog de segmentos HLS.
   *
   * Después de que el stream arranca, monitorea la hora de modificación del m3u8
   * cada 5 segundos. Si el m3u8 no se actualiza en 15 s (FFmpeg dejó de emitir
   * segmentos sin crashear), reinicia FFmpeg via scheduleChangePending.
   *
   * Cada reinicio usa más archivos norm_*.mp4 (porque bg-norm avanzó), por lo que
   * las transiciones son más fluidas con cada iteración hasta que todas son smooth.
   */
  private startSegmentWatchdog(session: PlayoutSession, m3u8Path: string): void {
    const POLL_MS  = 5_000;   // comprobar cada 5 s
    const STALL_MS = 25_000;  // 25 s sin nuevo segmento = FFmpeg estancado
    // 25s: suficiente para cubrir una transición legítima lenta entre archivos del concat
    // (en prenorm < 1s, en raw con faststart < 5s, en raw sin faststart hasta ~20s).
    // Reducido de 45s: con auto-restart post-norm-bg ya no necesitamos tolerar stalls
    // largos — cuando toda la playlist está normalizada, los stalls no ocurren.

    let lastMtime    = 0;
    let lastUpdateAt = Date.now();

    // Semilla: capturar mtime actual para no dispararse al arrancar
    fs.stat(m3u8Path).then(s => { lastMtime = s.mtimeMs; lastUpdateAt = Date.now(); }).catch(() => {});

    const tick = async () => {
      if (session.stopping || !this.sessions.has(session.channelId) || !session.process) return;

      try {
        const stat = await fs.stat(m3u8Path);
        if (stat.mtimeMs > lastMtime) {
          // Nuevo segmento escrito → resetear contador de stall
          lastMtime    = stat.mtimeMs;
          lastUpdateAt = Date.now();
        } else if (Date.now() - lastUpdateAt > STALL_MS && !session.scheduleChangePending) {
          // Sin segmentos nuevos → FFmpeg estancado
          this.log(session, `WARN: FFmpeg estancado (${STALL_MS / 1000}s sin segmentos) → reiniciando`);
          session.segmentWatchTimer = null;
          session.scheduleChangePending = true;
          const proc = session.process;
          if (proc) { try { proc.kill('SIGTERM'); } catch {} }
          return; // El close handler reinicia; él iniciará un nuevo watchdog
        }
      } catch { /* m3u8 puede no existir brevemente — ignorar */ }

      if (!session.stopping && this.sessions.has(session.channelId) && session.process) {
        session.segmentWatchTimer = setTimeout(tick, POLL_MS);
      }
    };

    if (session.segmentWatchTimer) { clearTimeout(session.segmentWatchTimer); }
    session.segmentWatchTimer = setTimeout(tick, POLL_MS);
  }

  private runBackgroundNormalization(
    session: PlayoutSession,
    items: Array<{ rawPath: string; normPath: string }>,
    quality: { scale: string; vBitrate: string; maxrate: string; bufsize: string; aBitrate: string },
  ): void {
    session.bgNormRunning = true;
    (async () => {
      this.log(session, `[bg-norm] Iniciando normalización de ${items.length} video(s) en background…`);
      let done = 0;
      for (const { rawPath, normPath } of items) {
        if (session.stopping || !this.sessions.has(session.channelId)) {
          this.log(session, `[bg-norm] Cancelado (canal detenido)`);
          session.bgNormRunning = false;
          return;
        }
        try {
          await this.normalizeVideoForBroadcast(rawPath, normPath, quality);
          done++;
          this.log(session, `[bg-norm] ${done}/${items.length} listo → ${path.basename(normPath)}`);
        } catch (err: any) {
          this.log(session, `[bg-norm] WARN: falló ${path.basename(rawPath)}: ${err.message}`);
        }
      }
      session.bgNormRunning = false;
      if (session.stopping || !this.sessions.has(session.channelId)) return;

      if (done < items.length) {
        this.log(session, `[bg-norm] Completado con ${items.length - done} error(s). Archivos raw se mantendrán para esos videos.`);
        return;
      }

      // Los archivos normalizados quedan en caché — el próximo inicio del canal
      // los detectará automáticamente y usará stream-copy sin re-encode.
      this.log(session, `[bg-norm] ✓ ${done} video(s) normalizados → listos para próximo inicio del canal`);
    })().catch(() => { session.bgNormRunning = false; });
  }

  /**
   * Normaliza un video al formato broadcast canónico.
   *
   * Produce archivos con propiedades IDÉNTICAS entre sí para que el concat demuxer
   * opere sin incompatibilidades y el muxer HLS pueda hacer stream-copy puro:
   *
   *   Video : H.264 High Profile 4.0 · resolución del canal · 25 fps · yuv420p
   *           GOP fijo 50 frames (keyframe cada 2 s) · sc_threshold=0
   *   Audio : AAC 44100 Hz estéreo · bitrate del preset de calidad
   *   Tiempo: timestamps desde 0 (avoid_negative_ts make_zero)
   *
   * Usa preset 'ultrafast' para minimizar el tiempo de espera antes de salir al aire.
   * Los archivos normalizados son el input del encoder en vivo (re-encode con CRF 26),
   * por lo que la calidad de normalización tiene impacto mínimo en la salida final.
   *
   * Se llama UNA vez por video por sesión; el resultado se cachea en disco.
   */
  private async normalizeVideoForBroadcast(
    inputPath: string,
    outputPath: string,
    quality: { scale: string; vBitrate: string; maxrate: string; bufsize: string; aBitrate: string },
  ): Promise<void> {
    // Escribir a .tmp y renombrar atómicamente al terminar.
    // Evita que fs.access(normPath) devuelva true sobre un archivo incompleto
    // (sin moov atom) cuando FFmpeg reinicia antes de que termine la normalización.
    const tmpOutput = `${outputPath}.tmp`;
    const stderrLines: string[] = [];
    const ok = await new Promise<boolean>((resolve) => {
      // NOTA: NO usar `nice -n 10 ffmpeg` — `nice` puede no estar disponible en
      // el contenedor y causaría un error ENOENT inmediato sin ningún mensaje útil.
      const proc = spawn('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-i', inputPath,
        // ─── Video ─────────────────────────────────────────────────────────
        '-vf', [
          `scale=${quality.scale}:force_original_aspect_ratio=decrease`,
          `pad=${quality.scale}:(ow-iw)/2:(oh-ih)/2:black`,
          'fps=25',
          'format=yuv420p',
        ].join(','),
        '-c:v',         'libx264',
        '-preset',      'ultrafast',
        '-crf',         '22',
        '-b:v',         quality.vBitrate,
        '-maxrate',     quality.maxrate,
        '-bufsize',     quality.bufsize,
        '-g',           '50',
        '-keyint_min',  '50',
        '-sc_threshold','0',
        '-profile:v',   'high',
        '-level:v',     '4.0',
        // ─── Audio ─────────────────────────────────────────────────────────
        // aformat fuerza cualquier layout (mono, 5.1, 7.1, HE-AACv2…) a estéreo
        // antes del encoder; evita el error "channel element X not allocated" con
        // fuentes multicanal y garantiza AAC 2ch 44100Hz en el archivo de salida.
        '-af', 'aformat=channel_layouts=stereo',
        '-c:a',  'aac',
        '-ar',   '44100',
        '-ac',   '2',
        '-b:a',  quality.aBitrate,
        // ─── Timestamps ────────────────────────────────────────────────────
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        // -f mp4: forzar formato de salida porque la extensión es .tmp (no .mp4)
        // y FFmpeg no puede detectar el muxer por extensión en este caso.
        '-f', 'mp4',
        tmpOutput,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      proc.stderr.on('data', (d: Buffer) => stderrLines.push(d.toString().trim()));
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', (err) => { stderrLines.push(err.message); resolve(false); });
    });

    if (!ok) {
      await fs.unlink(tmpOutput).catch(() => {});
      const detail = stderrLines.filter(Boolean).slice(-3).join(' | ') || 'sin detalle';
      throw new Error(`normalizeVideoForBroadcast falló: ${path.basename(inputPath)} — ${detail}`);
    }
    await fs.rename(tmpOutput, outputPath);
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

  // ─── Faststart ─────────────────────────────────────────────────────────────

  /**
   * Comprueba si un MP4 tiene el átomo moov al inicio (faststart).
   *
   * Lee los primeros 64 KB del archivo. Si 'moov' NO aparece ahí, el archivo
   * requiere faststart: el concat demuxer tendrá que hacer seek hasta el final
   * del archivo para encontrar el moov, lo que congela el pipeline de video
   * durante varios segundos en archivos grandes.
   */
  private async needsFaststart(filePath: string): Promise<boolean> {
    try {
      const PROBE = 65536; // 64 KB — más que suficiente para el átomo moov en archivos faststart
      const buf   = Buffer.alloc(PROBE);
      const fh    = await fs.open(filePath, 'r');
      const { bytesRead } = await fh.read(buf, 0, PROBE, 0);
      await fh.close();
      return buf.slice(0, bytesRead).indexOf(Buffer.from('moov')) === -1;
    } catch {
      return false; // si no se puede leer, no intentar corregir
    }
  }

  /**
   * Reescribe el MP4 con moov al inicio si aún no lo tiene (stream-copy, sin re-encode).
   *
   * Esto evita que el concat demuxer haga seek hasta el final al abrir el archivo,
   * eliminando el freeze/stall al transicionar a videos grandes en el playlist.
   * Tiempo: proporcional al I/O del archivo (similar al tiempo de descarga).
   */
  private async ensureFaststart(filePath: string): Promise<void> {
    if (!(await this.needsFaststart(filePath))) return; // ya tiene faststart → no hacer nada
    const tmpPath = `${filePath}.tmp`;
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const proc = spawn('ffmpeg', [
          '-y', '-loglevel', 'error',
          '-i', filePath,
          '-c', 'copy',
          '-movflags', '+faststart',
          tmpPath,
        ], { stdio: ['ignore', 'ignore', 'pipe'] });
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error',  ()     => resolve(false));
      });
      if (ok) await fs.rename(tmpPath, filePath);
      else     await fs.unlink(tmpPath).catch(() => {});
    } catch {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }

  private async normalizeAdSpot(inputPath: string, outputPath: string): Promise<void> {
    // Re-encode completo: H.264 25fps + AAC estéreo 44100 Hz + timestamps desde 0.
    // Crítico para DTS consistency con el concat demuxer: los spots deben tener
    // el mismo FPS y timebase que el contenido principal para evitar saltos de DTS
    // en las transiciones spot→video. stream-copy de video conserva el FPS original
    // (24/30/60fps) lo que causa "DTS out of order" al concatenar con 25fps.
    const tmpOutput = `${outputPath}.tmp`;
    const runFfmpeg = (extraVideoArgs: string[], extraAudioArgs: string[]) =>
      new Promise<boolean>((resolve) => {
        const proc = spawn(
          'nice', ['-n', '10', 'ffmpeg',
            '-y', '-loglevel', 'error',
            '-i', inputPath,
            ...extraVideoArgs,
            ...extraAudioArgs,
            '-avoid_negative_ts', 'make_zero',
            '-movflags', '+faststart',
            tmpOutput,
          ],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });

    const videoArgs = [
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26',
      '-vf', 'fps=25,format=yuv420p',
      '-map', '0:v:0',
    ];

    // Intento 1: re-encode video + re-encode audio existente a AAC estéreo 44100 Hz
    const ok = await runFfmpeg(videoArgs, [
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-map', '0:a:0',
    ]);

    if (!ok) {
      // Intento 2: el spot no tiene pista de audio → agregar silencio sintético
      // para que concat demuxer encuentre un stream de audio en todos los archivos.
      const ok2 = await new Promise<boolean>((resolve) => {
        const proc = spawn(
          'nice', ['-n', '10', 'ffmpeg',
            '-y', '-loglevel', 'error',
            '-i', inputPath,
            '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            ...videoArgs,
            '-c:a', 'aac', '-ar', '44100', '-ac', '2',
            '-map', '1:a',
            '-shortest',
            '-avoid_negative_ts', 'make_zero',
            '-movflags', '+faststart',
            tmpOutput,
          ],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });

      if (!ok2) {
        await fs.unlink(tmpOutput).catch(() => {});
        throw new Error(`normalizeAdSpot falló para ${inputPath}`);
      }
    }

    await fs.rename(tmpOutput, outputPath);
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
  //
  // Devuelve la playlist a emitir junto con el contexto de relleno:
  //   · scheduleEndTime — hora de fin del slot activo (null si no hay schedule)
  //   · fillerPlaylist  — playlist para cubrir el gap (null si no aplica)
  //
  // Prioridad:
  //   1. Schedule activo (mayor priority gana) → usa su fillerPlaylist si el contenido es corto
  //   2. Sin schedule → fillerPlaylist del canal (emite relleno continuo hasta el próximo schedule)
  //   3. Playlist por defecto (isDefault=true) → comportamiento previo
  //   4. Cualquier playlist del canal → fallback de último recurso

  private async getActivePlaylist(channelId: string) {
    const now = new Date();
    const itemsArgs = {
      where: { video: { status: VideoStatus.READY } },
      orderBy: { order: 'asc' as const },
      include: {
        video: {
          select: { id: true, originalKey: true, processedKey: true, norm480pKey: true, norm720pKey: true, norm1080pKey: true, duration: true, status: true },
        },
      },
    } as const;

    // 1. Schedule activo con mayor prioridad
    const schedule = await this.prisma.schedule.findFirst({
      where: { channelId, playlistId: { not: null }, startTime: { lte: now }, endTime: { gte: now } },
      orderBy: { priority: 'desc' },
      include: {
        playlist:       { include: { items: itemsArgs } },
        fillerPlaylist: { include: { items: itemsArgs } },
      },
    });
    if (schedule?.playlist?.items?.length) {
      return {
        playlist:        schedule.playlist,
        scheduleEndTime: schedule.endTime as Date,
        fillerPlaylist:  schedule.fillerPlaylist?.items?.length ? schedule.fillerPlaylist : null,
      };
    }

    // 2. Sin schedule activo → playlist de relleno del canal
    const channelRow = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { fillerPlaylist: { include: { items: itemsArgs } } },
    });
    if (channelRow?.fillerPlaylist?.items?.length) {
      this.logger.log(`[${channelId}] Sin schedule → emitiendo playlist de relleno del canal`);
      return { playlist: channelRow.fillerPlaylist, scheduleEndTime: null, fillerPlaylist: null };
    }

    // 3 & 4. Fallback al comportamiento previo
    const def = await this.prisma.playlist.findFirst({
      where: { channelId, isDefault: true },
      include: { items: itemsArgs },
    });
    if (def?.items?.length) return { playlist: def, scheduleEndTime: null, fillerPlaylist: null };

    const any = await this.prisma.playlist.findFirst({
      where: { channelId },
      include: { items: itemsArgs },
    });
    return { playlist: any ?? null, scheduleEndTime: null, fillerPlaylist: null };
  }
}
