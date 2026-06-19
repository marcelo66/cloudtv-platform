import {
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Platform } from '@prisma/client';

type Quality = '480p' | '720p' | '1080p';

export class CreateStreamOutputDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(Platform)
  platform: Platform;

  /**
   * RTMP:        URL base del servidor (ej: rtmp://servidor:1935/app)
   * SRT_CALLER:  host / IP de destino (ej: 10.147.17.5)
   * SRT_LISTENER: ignorado
   * Para YouTube/Facebook/Twitch se auto-completa en el servicio.
   */
  @IsString()
  @IsOptional()
  rtmpUrl?: string;

  /**
   * RTMP: stream key de la plataforma.
   * SRT:  no se usa; puede omitirse o enviarse vacío.
   */
  @IsString()
  @IsOptional()
  streamKey?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  // ── SRT-only fields ────────────────────────────────────────────────────────

  /** Puerto SRT (1-65535). Default: 9001. */
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  srtPort?: number;

  /** Latencia SRT en milisegundos (20-8000 ms). Default: 120 ms. */
  @IsInt()
  @Min(20)
  @Max(8000)
  @IsOptional()
  srtLatency?: number;

  /**
   * Passphrase de cifrado AES (10-79 caracteres).
   * Vacío / omitido = sin cifrado.
   */
  @IsString()
  @IsOptional()
  @MaxLength(79)
  srtPassphrase?: string;

  // ── Calidad de emisión personalizada ──────────────────────────────────────

  /** Bitrate de video en kbps (500-50000). null = stream-copy desde HLS. */
  @IsInt()
  @Min(500)
  @Max(50000)
  @IsOptional()
  customBitrate?: number | null;

  /** Resolución de salida. null = heredar del canal. */
  @IsEnum(['480p', '720p', '1080p'])
  @IsOptional()
  customQuality?: Quality | null;
}

export class UpdateStreamOutputDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  rtmpUrl?: string;

  @IsString()
  @IsOptional()
  streamKey?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  srtPort?: number;

  @IsInt()
  @Min(20)
  @Max(8000)
  @IsOptional()
  srtLatency?: number;

  @IsString()
  @IsOptional()
  @MaxLength(79)
  srtPassphrase?: string;

  @IsInt()
  @Min(500)
  @Max(50000)
  @IsOptional()
  customBitrate?: number | null;

  @IsEnum(['480p', '720p', '1080p'])
  @IsOptional()
  customQuality?: Quality | null;
}
