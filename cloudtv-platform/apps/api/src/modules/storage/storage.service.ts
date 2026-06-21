import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(private config: ConfigService) {}

  private endpoint: string;

  async onModuleInit() {
    const accountId = this.config.get('R2_ACCOUNT_ID');
    const endpoint =
      this.config.get('R2_ENDPOINT') ||
      (accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : 'http://localhost:9000');

    this.endpoint = endpoint;

    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: this.config.get('R2_ACCESS_KEY_ID', 'minioadmin'),
        secretAccessKey: this.config.get(
          'R2_SECRET_ACCESS_KEY',
          'minioadmin123',
        ),
      },
      // MinIO / R2 necesitan path-style para buckets locales
      forcePathStyle: !accountId,
    });

    this.bucket = this.config.get('R2_BUCKET', 'cloudtv-storage');
    this.publicUrl = this.config.get(
      'R2_PUBLIC_URL',
      'http://localhost:9000/cloudtv-storage',
    );

    this.logger.log(`Storage initialized → endpoint: ${endpoint}, bucket: ${this.bucket}`);

    // Crear el bucket automáticamente si no existe
    await this.ensureBucketExists();
  }

  private async ensureBucketExists(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket "${this.bucket}" ya existe`);
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket "${this.bucket}" creado`);

        // Política pública de lectura (para servir thumbnails y videos procesados)
        const policy = JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`],
            },
          ],
        });
        await this.s3.send(
          new PutBucketPolicyCommand({ Bucket: this.bucket, Policy: policy }),
        );
        this.logger.log(`Política pública aplicada al bucket "${this.bucket}"`);
      } catch (err) {
        this.logger.error(`No se pudo crear el bucket: ${err.message}`);
      }
    }
  }

  // ─── Upload simple (para thumbnails, logos, etc.) ────────────

  async putObject(
    key: string,
    body: Buffer | Readable,
    contentType: string,
  ): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return this.getPublicUrl(key);
  }

  // ─── Multipart Upload (para archivos grandes) ─────────────────

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const result = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    return result.UploadId!;
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<string> {
    const result = await this.s3.send(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
        ContentLength: body.byteLength,
      }),
    );
    return result.ETag!;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.PartNumber - b.PartNumber)
            .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.s3.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (err) {
      this.logger.warn(`Abort multipart failed for key ${key}: ${err.message}`);
    }
  }

  // ─── Download ─────────────────────────────────────────────────

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const stream = result.Body as Readable;
    await pipeline(stream, createWriteStream(destPath));
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const stream = result.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  // ─── Delete ───────────────────────────────────────────────────

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (!keys.length) return;
    await this.s3.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  // ─── URLs ─────────────────────────────────────────────────────

  getPublicUrl(key: string): string {
    return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
  }

  /** URL accesible desde dentro del contenedor (para FFmpeg) */
  getInternalUrl(key: string): string {
    return `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${key}`;
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  // ─── Helpers para keys ───────────────────────────────────────

  buildVideoKey(channelId: string, videoId: string, ext: string): string {
    return `videos/${channelId}/${videoId}/original.${ext}`;
  }

  buildThumbnailKey(channelId: string, videoId: string): string {
    return `videos/${channelId}/${videoId}/thumbnail.jpg`;
  }

  buildProcessedKey(channelId: string, videoId: string): string {
    return `videos/${channelId}/${videoId}/processed.mp4`;
  }

  /**
   * Key para la versión pre-normalizada al formato broadcast canónico.
   * Generada en el pipeline de upload (Option B) y usada directamente por playout.
   */
  buildNormKey(channelId: string, videoId: string, quality: '480p' | '720p' | '1080p'): string {
    return `videos/${channelId}/${videoId}/norm_${quality}.mp4`;
  }
}
