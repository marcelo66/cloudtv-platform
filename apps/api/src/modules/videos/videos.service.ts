import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  InitiateUploadDto,
  CompleteUploadDto,
  UpdateVideoDto,
} from './dto/video.dto';

export const VIDEO_QUEUE = 'video-processing';

export interface VideoProcessingJobData {
  videoId: string;
  channelId: string;
  originalKey: string;
}

// Estado temporal en memoria del multipart upload
// En prod: mover a Redis
const pendingUploads = new Map<
  string,
  { uploadId: string; key: string; channelId: string }
>();

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    @InjectQueue(VIDEO_QUEUE) private videoQueue: Queue,
  ) {}

  // ─── Upload: Paso 1 ──────────────────────────────────────────

  async initiateUpload(userId: string, dto: InitiateUploadDto) {
    // Verificar que el canal le pertenece al usuario
    const channel = await this.prisma.channel.findFirst({
      where: { id: dto.channelId, userId },
    });
    if (!channel) {
      throw new ForbiddenException('Canal no encontrado o sin permisos');
    }

    const ext = this.getExtension(dto.filename, dto.mimeType);

    // Crear registro en BD con estado PENDING
    const video = await this.prisma.video.create({
      data: {
        channelId: dto.channelId,
        title: this.cleanTitle(dto.filename),
        status: 'PENDING',
        originalKey: '', // Se actualiza al completar
        fileSize: BigInt(dto.fileSize),
        mimeType: dto.mimeType,
      },
    });

    const key = this.storage.buildVideoKey(dto.channelId, video.id, ext);
    const uploadId = await this.storage.createMultipartUpload(key, dto.mimeType);

    // Guardar estado del upload en memoria
    pendingUploads.set(video.id, { uploadId, key, channelId: dto.channelId });

    this.logger.log(
      `Upload initiated: videoId=${video.id}, key=${key}, parts expected: ${Math.ceil(dto.fileSize / (5 * 1024 * 1024))}`,
    );

    return {
      videoId: video.id,
      uploadId,
      key,
    };
  }

  // ─── Upload: Paso 2 (recibir chunk) ─────────────────────────

  async uploadPart(
    userId: string,
    videoId: string,
    partNumber: number,
    buffer: Buffer,
  ) {
    const pending = pendingUploads.get(videoId);
    if (!pending) {
      throw new BadRequestException(
        'Upload no encontrado. Puede haber expirado.',
      );
    }

    // Verificar ownership
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, channel: { userId } },
    });
    if (!video) throw new ForbiddenException();

    // Subir parte a S3
    const etag = await this.storage.uploadPart(
      pending.key,
      pending.uploadId,
      partNumber,
      buffer,
    );

    return { partNumber, etag };
  }

  // ─── Upload: Paso 3 (completar) ──────────────────────────────

  async completeUpload(userId: string, dto: CompleteUploadDto) {
    const pending = pendingUploads.get(dto.videoId);
    if (!pending) {
      throw new BadRequestException('Upload no encontrado o ya completado');
    }

    const video = await this.prisma.video.findFirst({
      where: { id: dto.videoId, channel: { userId } },
    });
    if (!video) throw new ForbiddenException();

    // Completar el multipart upload en S3
    await this.storage.completeMultipartUpload(
      pending.key,
      pending.uploadId,
      dto.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
    );

    // Actualizar BD con key real + estado PROCESSING
    await this.prisma.video.update({
      where: { id: dto.videoId },
      data: {
        originalKey: pending.key,
        status: 'PROCESSING',
      },
    });

    // Limpiar estado en memoria
    pendingUploads.delete(dto.videoId);

    // Encolar job de procesamiento
    await this.videoQueue.add(
      'process-video',
      {
        videoId: dto.videoId,
        channelId: pending.channelId,
        originalKey: pending.key,
      } as VideoProcessingJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 }, // Retener 24h
        removeOnFail: { age: 604800 }, // Retener 7 días si falla
      },
    );

    this.logger.log(`Processing job queued for video ${dto.videoId}`);

    return this.prisma.video.findUnique({ where: { id: dto.videoId } });
  }

  // ─── Upload: Abort ───────────────────────────────────────────

  async abortUpload(userId: string, videoId: string) {
    const pending = pendingUploads.get(videoId);

    if (pending) {
      await this.storage.abortMultipartUpload(pending.key, pending.uploadId);
      pendingUploads.delete(videoId);
    }

    await this.prisma.video.deleteMany({
      where: { id: videoId, status: 'PENDING', channel: { userId } },
    });
  }

  // ─── CRUD ─────────────────────────────────────────────────────

  async findAll(userId: string, channelId: string) {
    // Verificar que el canal pertenece al usuario
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new ForbiddenException();

    return this.prisma.video.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        thumbnailUrl: true,
        duration: true,
        width: true,
        height: true,
        fileSize: true,
        mimeType: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, channel: { userId } },
    });
    if (!video) throw new NotFoundException('Video no encontrado');
    return video;
  }

  async update(userId: string, videoId: string, dto: UpdateVideoDto) {
    await this.findOne(userId, videoId); // verifica ownership
    return this.prisma.video.update({
      where: { id: videoId },
      data: dto,
    });
  }

  async remove(userId: string, videoId: string) {
    const video = await this.findOne(userId, videoId);

    // Eliminar archivos de S3
    const keysToDelete = [
      video.originalKey,
      video.processedKey,
      video.thumbnailUrl
        ? this.storage.buildThumbnailKey(video.channelId, videoId)
        : null,
    ].filter(Boolean) as string[];

    if (keysToDelete.length) {
      await this.storage.deleteObjects(keysToDelete);
    }

    await this.prisma.video.delete({ where: { id: videoId } });
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private getExtension(filename: string, mimeType: string): string {
    const fromFilename = path.extname(filename).replace('.', '').toLowerCase();
    if (fromFilename) return fromFilename;
    const mimeMap: Record<string, string> = {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/x-matroska': 'mkv',
      'video/x-msvideo': 'avi',
      'video/webm': 'webm',
    };
    return mimeMap[mimeType] || 'mp4';
  }

  private cleanTitle(filename: string): string {
    return path
      .basename(filename, path.extname(filename))
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
