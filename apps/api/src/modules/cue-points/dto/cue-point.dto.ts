import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { CuePointType } from '@prisma/client';

export class CreateCuePointDto {
  @IsString()
  videoId: string;

  @IsString()
  adBlockId: string;

  @IsEnum(CuePointType)
  type: CuePointType;

  /** Segundos desde el inicio del video. Solo requerido para MID_ROLL. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  timeOffset?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

export class UpdateCuePointDto {
  @IsOptional()
  @IsString()
  adBlockId?: string;

  @IsOptional()
  @IsEnum(CuePointType)
  type?: CuePointType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  timeOffset?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
