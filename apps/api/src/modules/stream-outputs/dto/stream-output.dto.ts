import {
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  IsUrl,
} from 'class-validator';
import { Platform } from '@prisma/client';

export class CreateStreamOutputDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(Platform)
  platform: Platform;

  /** URL base RTMP del servidor (sin la stream key).
   *  Para YouTube/Facebook/Twitch se auto-completa en el servicio.
   *  Para RTMP_CUSTOM el usuario debe proveerla.
   */
  @IsString()
  @IsOptional()
  rtmpUrl?: string;

  /** Stream key de la plataforma (se adjunta al rtmpUrl en FFmpeg). */
  @IsString()
  @IsNotEmpty()
  streamKey: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
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
  @IsNotEmpty()
  @IsOptional()
  streamKey?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
