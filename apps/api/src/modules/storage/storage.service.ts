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

  onModuleInit() {
    const accountId = this.config.get('R2_ACCOUNT_ID');
    const endpoint =
      this.config.get('R2_ENDPOINT') ||
      (accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : 'http://localhost:9000');

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
}
