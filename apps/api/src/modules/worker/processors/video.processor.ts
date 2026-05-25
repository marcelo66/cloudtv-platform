import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { FfprobeService } from '../services/ffprobe.service';
import { FfmpegService } from '../services/ffmpeg.service';
import {
  VIDEO_QUEUE,
  VideoProcessingJobData,
} from '../../videos/videos.service';

@Processor(VIDEO_QUEUE, {
  concurrency: 2, // Máximo 2 videos procesando al mismo tiempo
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
    const { videoId, channelId, originalKey } = job.data;
    const tmpDir = path.join(os.tmpdir(), 'cloudtv', videoId);

    this.logger.log(`Processing video ${videoId} (job ${job.id})`);

    try {
      // ─── 1. Preparar directorio temporal ─────────────────────
      await fs.mkdir(tmpDir, { recursive: true });
      const ext = path.extname(originalKey) || '.mp4';
      const inputPath = path.join(tmpDir, `input${ext}`);
      const thumbPath = path.join(tmpDir, 'thumbnail.jpg');

      await job.updateProgress(5);

      // ─── 2. Descargar archivo original de S3 ─────────────────
      this.logger.debug(`Downloading ${originalKey}`);
      await this.storage.downloadToFile(originalKey, inputPath);
      await job.updateProgress(20);

      // ─── 3. Extraer metadata con FFprobe ─────────────────────
      this.logger.debug(`Running ffprobe on ${path.basename(inputPath)}`);
      const metadata = await this.ffprobe.getMetadata(inputPath);
      this.logger.log(
        `Metadata: ${metadata.width}x${metadata.height} ${metadata.fps}fps ${metadata.codec} ${metadata.duration}s`,
      );
      await job.updateProgress(35);

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
      await job.updateProgress(40);

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

      await job.updateProgress(65);
      this.logger.log(`Thumbnail uploaded: ${thumbnailKey}`);

      // ─── 6. Transcodificar si es necesario ───────────────────
      let finalKey = originalKey;

      if (this.ffmpeg.needsTranscode(metadata.codec, metadata.audioCodec)) {
        this.logger.log(
          `Transcoding required: codec=${metadata.codec} audio=${metadata.audioCodec}`,
        );
        const outputPath = path.join(tmpDir, 'processed.mp4');
        await this.ffmpeg.transcodeToH264(inputPath, outputPath);

        const processedKey = this.storage.buildProcessedKey(channelId, videoId);
        const processedBuffer = await fs.readFile(outputPath);
        await this.storage.putObject(processedKey, processedBuffer, 'video/mp4');

        finalKey = processedKey;
        await this.prisma.video.update({
          where: { id: videoId },
          data: { processedKey },
        });

        await job.updateProgress(90);
        this.logger.log(`Transcoded video uploaded: ${processedKey}`);
      } else {
        this.logger.log(
          `No transcode needed (${metadata.codec}/${metadata.audioCodec}) — using original`,
        );
        await this.prisma.video.update({
          where: { id: videoId },
          data: { processedKey: originalKey },
        });
        await job.updateProgress(90);
      }

      // ─── 7. Marcar como READY ─────────────────────────────────
      await this.prisma.video.update({
        where: { id: videoId },
        data: { status: 'READY' },
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
        data: { status: 'ERROR' },
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
