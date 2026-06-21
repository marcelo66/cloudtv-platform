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
   * SRT_CALLER:   Host / IP del servidor SRT remoto (ej: "10.10.0.5")
   * SRT_LISTENER: vacío — el servidor escucha conexiones entrantes
   * RTMP_PUSH:    vacío — el servidor recibe el push del encoder
   */
  @IsString() @IsOptional()
  url?: string;

  // ── SRT (Caller y Listener) ─────────────────────────────────────
  @IsInt() @Min(1) @Max(65535) @IsOptional()
  srtPort?: number;

  @IsInt() @Min(20) @Max(8000) @IsOptional()
  srtLatency?: number;

  @IsString() @IsOptional() @MaxLength(79)
  srtPassphrase?: string;

  /** Stream ID SRT — para servidores que enrutan por streamid (Haivision, SRT Hub, etc.) */
  @IsString() @IsOptional() @MaxLength(512)
  srtStreamId?: string;

  // ── RTMP (Push entrante o Pull desde fuente externa) ───────────
  /**
   * Host/IP del servidor RTMP remoto.
   * - Vacío → modo Push: el servidor escucha conexiones entrantes del encoder.
   * - Con valor → modo Pull: el servidor se conecta a la fuente RTMP externa.
   * Ejemplos: "stmvideo6.livecastv.com", "192.168.1.10"
   */
  @IsString() @IsOptional() @MaxLength(253)
  rtmpHost?: string;

  @IsInt() @Min(1) @Max(65535) @IsOptional()
  rtmpPort?: number;

  /**
   * Nombre de la aplicación RTMP (el segmento tras el puerto).
   * Ejemplos: "live", "stream", "broadcast"
   * Por defecto: "live"
   */
  @IsString() @IsOptional() @MaxLength(128)
  rtmpApp?: string;

  /** Stream key (nombre del stream). Opcional. */
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

  @IsString() @IsOptional() @MaxLength(512)
  srtStreamId?: string;

  @IsString() @IsOptional() @MaxLength(253)
  rtmpHost?: string;

  @IsInt() @Min(1) @Max(65535) @IsOptional()
  rtmpPort?: number;

  @IsString() @IsOptional() @MaxLength(128)
  rtmpApp?: string;

  @IsString() @IsOptional() @MaxLength(128)
  rtmpKey?: string;
}
