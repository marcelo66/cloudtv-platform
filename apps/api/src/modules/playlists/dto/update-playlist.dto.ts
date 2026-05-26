import { IsString, IsOptional, IsBoolean, IsEnum, MaxLength } from 'class-validator';
import { LoopMode } from '@prisma/client';

export class UpdatePlaylistDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsEnum(LoopMode)
  @IsOptional()
  loopMode?: LoopMode;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
