import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  MaxLength,
  IsArray,
  IsOptional,
  IsIn,
} from 'class-validator';

export class InitiateUploadDto {
  @ApiProperty({ example: 'mi-video.mp4' })
  @IsString()
  @IsNotEmpty()
  filename: string;

  @ApiProperty({ example: 104857600, description: 'Tamaño en bytes' })
  @IsNumber()
  @IsPositive()
  fileSize: number;

  @ApiProperty({ example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  @IsIn(['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/webm', 'video/avi'])
  mimeType: string;

  @ApiProperty({ example: 'channel_id_aqui' })
  @IsString()
  @IsNotEmpty()
  channelId: string;
}

export class UploadPartDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  videoId: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  partNumber: number;
}

export class CompletedPartDto {
  @ApiProperty()
  @IsNumber()
  @IsPositive()
  partNumber: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  videoId: string;

  @ApiProperty({ type: [CompletedPartDto] })
  @IsArray()
  parts: CompletedPartDto[];
}

export class AbortUploadDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  videoId: string;
}

export class UpdateVideoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];
}
