import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { FfprobeService } from '../services/ffprobe.service';
import { FfmpegService, BroadcastQuality } from '../services/ffmpeg.service';
import {
  VIDEO_QUEUE,
  VideoProcessingJobData,
} from '../../videos/videos.service';

@Processor(VIDEO_QUEUE, {
  concurrency: 1,      // Un video a la vez — FFmpeg ya usa todos los threads disponibles
  lockDuration: 120_000, // 2 min de lock (default 30s es demasiado corto para normalización)
  lockRenewTime: 50_000, // Renovar cada 50s (< lockDuration/2 = 60s para margen)
})
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ffprobe: FfprobeService,
    private ffmpeg: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    if (job.name === 'renormalize-video') {
      return this.processRenormalize(job);
    }
    return this.processUpload(job);
  }

  // ─── Re-normalización de videos viejos (sin norm keys en S3) ────────────────
  //
  // Job name: 'renormalize-video'
  // Solo descarga el original y genera las 3 variantes broadcast.
  // No regenera thumbnail ni metadata (ya existen en BD).
  //
  private async processRenormalize(job: Job<VideoProcessingJobData>): Promise<void> {
    const { videoId, channelId, originalKey } = job.data;
    const tmpDir = path.join(os.tmpdir(), 'cloudtv', `renorm_${videoId}`);

    this.logger.log(`Re-normalizing video ${videoId} (job ${job.id})`);

    // Progreso throttled → BD (cada 5%)
    let lastDbPct = -1;
    const saveProgress = (pct: number) => {
      if (pct - lastDbPct >= 5) {
        lastDbPct = pct;
        this.prisma.video.update({ where: { id: videoId }, data: { processingProgress: pct } }).catch(() => {});
      }
    };

    try {
      await fs.mkdir(tmpDir, { recursive: true });
      const ext = path.extname(originalKey) || '.mp4';
      const inputPath = path.join(tmpDir, `input${ext}`);

      await job.updateProgress(5); saveProgress(5);
      this.logger.debug(`Downloading original ${originalKey}`);
      await this.storage.downloadToFile(originalKey, inputPath);
      await job.updateProgress(20); saveProgress(20);

      // Obtener duración del video para reportar progreso real
      const reNormMeta = await this.ffprobe.getMetadata(inputPath).catch(() => null);
      const reNormDuration = reNormMeta?.duration;

      const qualities: BroadcastQuality[] = ['480p', '720p', '1080p'];
      const normKeyMap: Record<string, string> = {};

      for (let qi = 0; qi < qualities.length; qi++) {
        const q = qualities[qi];
        const normPath = path.join(tmpDir, `norm_${q}.mp4`);
        const qStart = 20 + qi * 23;
        const qEnd   = qStart + 21;

        this.logger.log(`Re-normalizing to ${q} (${qi + 1}/3)…`);
        await this.ffmpeg.normalizeToBroadcast(inputPath, normPath, q, reNormDuration,
          (ffmpegPct) => {
            const globalPct = Math.round(qStart + (ffmpegPct / 100) * (qEnd - qStart));
            job.updateProgress(globalPct).catch(() => {});
            saveProgress(globalPct);
          },
        );

        await job.updateProgress(qEnd); saveProgress(qEnd);

        const normKey = this.storage.buildNormKey(channelId, videoId, q);
        await this.storage.putObject(normKey, createReadStream(normPath), 'video/mp4');
        normKeyMap[q] = normKey;

        await fs.rm(normPath).catch(() => {});
        await job.updateProgress(qStart + 23); saveProgress(qStart + 23);
        this.logger.log(`✓ renorm_${q}: ${normKey}`);
      }

      await this.prisma.video.update({
        where: { id: videoId },
        data: {
          norm480pKey:  normKeyMap['480p'],
          norm720pKey:  normKeyMap['720p'],
          norm1080pKey: normKeyMap['1080p'],
          processedKey: normKeyMap['720p'],
          processingProgress: null,
        },
      });

      await job.updateProgress(100);
      this.logger.log(`✓ Re-normalization complete for video ${videoId}`);
    } catch (error) {
      this.logger.error(`✗ Re-normalization failed for ${videoId}: ${error.message}`, error.stack);
      this.prisma.video.update({ where: { id: videoId }, data: { processingProgress: null } }).catch(() => {});
      throw error;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ─── Procesamiento de upload nuevo (pipeline completo) ───────────────────────
  //
  // Job name: 'process-video' (default)
  //
  private async processUpload(job: Job<VideoProcessingJobData>): Promise<void> {
    const { videoId, channelId, originalKey } = job.data;
    const tmpDir = path.join(os.tmpdir(), 'cloudtv', videoId);

    this.logger.log(`Processing video ${videoId} (job ${job.id})`);

    // Progreso throttled → BD (cada 5%)
    let lastDbPct = -1;
    const saveProgress = (pct: number) => {
      if (pct - lastDbPct >= 5) {
        lastDbPct = pct;
        this.prisma.video.update({ where: { id: videoId }, data: { processingProgress: pct } }).catch(() => {});
      }
    };

    try {
      // ─── 1. Preparar directorio temporal ─────────────────────
      await fs.mkdir(tmpDir, { recursive: true });
      const ext = path.extname(originalKey) || '.mp4';
      const inputPath = path.join(tmpDir, `input${ext}`);
      const thumbPath = path.join(tmpDir, 'thumbnail.jpg');

      await job.updateProgress(5); saveProgress(5);

      // ─── 2. Descargar archivo original de S3 ─────────────────
      this.logger.debug(`Downloading ${originalKey}`);
      await this.storage.downloadToFile(originalKey, inputPath);
      await job.updateProgress(20); saveProgress(20);

      // ─── 3. Extraer metadata con FFprobe ─────────────────────
      this.logger.debug(`Running ffprobe on ${path.basename(inputPath)}`);
      const metadata = await this.ffprobe.getMetadata(inputPath);
      this.logger.log(
        `Metadata: ${metadata.width}x${metadata.height} ${metadata.fps}fps ${metadata.codec} ${metadata.duration}s`,
      );
      await job.updateProgress(35); saveProgress(35);

      // ─── 4. Guardar metadata en BD ───────────────────────────
      await this.prisma.video.update({
        where: { id: videoId },
        data: {
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          codec: metadata.codec,
          bitrate: metadata.bitrate,
        },
      });
      await job.updateProgress(40); saveProgress(40);

      // ─── 5. Generar thumbnail ─────────────────────────────────
      const seekAt = Math.min(5, metadata.duration * 0.1);
      await this.ffmpeg.generateThumbnail(inputPath, thumbPath, seekAt);

      // Subir thumbnail a S3
      const thumbnailKey = this.storage.buildThumbnailKey(channelId, videoId);
      const thumbBuffer = await fs.readFile(thumbPath);
      const thumbnailUrl = await this.storage.putObject(
        thumbnailKey,
        thumbBuffer,
        'image/jpeg',
      );

      await this.prisma.video.update({
        where: { id: videoId },
        data: { thumbnailUrl },
      });

      await job.updateProgress(65); saveProgress(65);
      this.logger.log(`Thumbnail uploaded: ${thumbnailKey}`);

      // ─── 6. Normalizar a formato broadcast canónico (Opción B) ──────────────
      //
      // Genera 3 versiones pre-normalizadas (480p, 720p, 1080p) desde el original.
      // Cada una queda en S3 con key norm_Xp.mp4 lista para stream-copy en playout.
      //
      // Usamos stream de lectura para el upload (evita cargar GBs en memoria).

      const qualities: BroadcastQuality[] = ['480p', '720p', '1080p'];
      const normKeyMap: Record<string, string> = {};

      // Rango de progreso por calidad: 65→73→81→89
      // Dentro de cada rango, FFmpeg reporta progreso en tiempo real vía stderr.
      const NORM_START = 65;
      const RANGE_PER_Q = 8;

      for (let qi = 0; qi < qualities.length; qi++) {
        const q = qualities[qi];
        const normPath = path.join(tmpDir, `norm_${q}.mp4`);
        const qStart = NORM_START + qi * RANGE_PER_Q;
        const qEnd   = qStart + RANGE_PER_Q - 1; // -1 para el upload posterior

        this.logger.log(`Normalizing to ${q} (${qi + 1}/3)…`);
        await this.ffmpeg.normalizeToBroadcast(inputPath, normPath, q, metadata.duration,
          (ffmpegPct) => {
            const globalPct = Math.round(qStart + (ffmpegPct / 100) * (qEnd - qStart));
            job.updateProgress(globalPct).catch(() => {});
            saveProgress(globalPct);
          },
        );

        await job.updateProgress(qEnd); saveProgress(qEnd);

        const normKey = this.storage.buildNormKey(channelId, videoId, q);
        await this.storage.putObject(normKey, createReadStream(normPath), 'video/mp4');
        normKeyMap[q] = normKey;

        // Liberar espacio en disco inmediatamente
        await fs.rm(normPath).catch(() => {});

        await job.updateProgress(qStart + RANGE_PER_Q); saveProgress(qStart + RANGE_PER_Q);
        this.logger.log(`✓ norm_${q} subido a S3: ${normKey}`);
      }

      // Guardar las 3 keys + processedKey = 720p (backward compat con ad spots y playout viejo)
      await this.prisma.video.update({
        where: { id: videoId },
        data: {
          norm480pKey:  normKeyMap['480p'],
          norm720pKey:  normKeyMap['720p'],
          norm1080pKey: normKeyMap['1080p'],
          processedKey: normKeyMap['720p'], // Backward compat
        },
      });

      await job.updateProgress(95); saveProgress(95);

      // ─── 7. Marcar como READY ─────────────────────────────────
      await this.prisma.video.update({
        where: { id: videoId },
        data: { status: 'READY', processingProgress: null },
      });

      await job.updateProgress(100);
      this.logger.log(`✓ Video ${videoId} processing complete`);
    } catch (error) {
      this.logger.error(
        `✗ Video ${videoId} processing failed: ${error.message}`,
        error.stack,
      );

      await this.prisma.video.update({
        where: { id: videoId },
        data: { status: 'ERROR', processingProgress: null },
      });

      throw error; // BullMQ reintentará según la config del job
    } finally {
      // ─── 8. Limpiar archivos temporales ─────────────────────
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        this.logger.debug(`Temp dir cleaned: ${tmpDir}`);
      } catch {
        // No crítico
      }
    }
  }
}
