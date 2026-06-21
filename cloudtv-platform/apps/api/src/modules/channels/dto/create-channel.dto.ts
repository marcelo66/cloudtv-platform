import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  Matches,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class CreateChannelDto {
  @ApiProperty({ example: 'Mi Canal de TV' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'mi-canal-de-tv' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'El slug solo puede contener letras minúsculas, números y guiones',
  })
  slug?: string;

  @ApiPropertyOptional({ example: 'Canal de entretenimiento 24/7' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateChannelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: ['480p', '720p', '1080p'], description: 'Resolución / calidad de salida HLS' })
  @IsOptional()
  @IsString()
  @IsIn(['480p', '720p', '1080p'])
  videoQuality?: string;

  @ApiPropertyOptional({ description: 'Intervalo en minutos para insertar tanda automática (null = desactivado)' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  adIntervalMinutes?: number | null;

  @ApiPropertyOptional({ description: 'ID de la tanda a insertar en cada intervalo' })
  @IsOptional()
  @IsString()
  adIntervalBlockId?: string | null;

  @ApiPropertyOptional({ description: 'ID de la playlist de relleno (se emite cuando no hay schedule activo o para completar slots cortos)' })
  @IsOptional()
  @IsString()
  fillerPlaylistId?: string | null;
}
