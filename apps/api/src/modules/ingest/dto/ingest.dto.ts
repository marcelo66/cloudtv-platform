import {
  IsString, IsEnum, IsOptional, IsNotEmpty,
  IsInt, Min, Max, MaxLength,
} from 'class-validator';
import { IngestType } from '@prisma/client';

export class CreateIngestSourceDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsEnum(IngestType)
  type: IngestType;

  /**
   * YOUTUBE:      URL completa de YouTube (ej: https://www.youtube.com/watch?v=xxx)
   * SRT_CALLER:   "host:port" (ej: "10.10.0.5:9002")
   * SRT_LISTENER: vacío
   * RTMP_PUSH:    vacío
   */
  @IsString() @IsOptional()
  url?: string;

  // ── SRT ────────────────────────────────────────────────────────
  @IsInt() @Min(1) @Max(65535) @IsOptional()
  srtPort?: number;

  @IsInt() @Min(20) @Max(8000) @IsOptional()
  srtLatency?: number;

  @IsString() @IsOptional() @MaxLength(79)
  srtPassphrase?: string;

  // ── RTMP Push ──────────────────────────────────────────────────
  @IsInt() @Min(1) @Max(65535) @IsOptional()
  rtmpPort?: number;

  @IsString() @IsOptional() @MaxLength(128)
  rtmpKey?: string;
}

export class UpdateIngestSourceDto {
  @IsString() @IsNotEmpty() @IsOptional()
  name?: string;

  @IsString() @IsOptional()
  url?: string;

  @IsInt() @Min(1) @Max(65535) @IsOptional()
  srtPort?: number;

  @IsInt() @Min(20) @Max(8000) @IsOptional()
  srtLatency?: number;

  @IsString() @IsOptional() @MaxLength(79)
  srtPassphrase?: string;

  @IsInt() @Min(1) @Max(65535) @IsOptional()
  rtmpPort?: number;

  @IsString() @IsOptional() @MaxLength(128)
  rtmpKey?: string;
}
