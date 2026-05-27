import {
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsInt,
  IsObject,
  IsNotEmpty,
  Min,
} from 'class-validator';
import { OverlayType } from '@prisma/client';

export class CreateOverlayDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(OverlayType)
  type: OverlayType;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  /** Configuración específica según el tipo:
   *  LOGO        → { position, x?, y?, width?, opacity? }
   *  TEXT_STATIC → { text, position, x?, y?, fontSize, fontColor, bgColor?, bold? }
   *  TEXT_SCROLL → { text, position, fontSize, fontColor, bgColor?, speed?, barHeight? }
   *  TICKER      → (igual que TEXT_SCROLL)
   *  CLOCK       → { position, x?, y?, fontSize, fontColor, bgColor?, format? }
   */
  @IsObject()
  config: Record<string, any>;

  @IsInt()
  @Min(0)
  @IsOptional()
  zIndex?: number;
}

export class UpdateOverlayDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsObject()
  @IsOptional()
  config?: Record<string, any>;

  @IsInt()
  @Min(0)
  @IsOptional()
  zIndex?: number;
}
