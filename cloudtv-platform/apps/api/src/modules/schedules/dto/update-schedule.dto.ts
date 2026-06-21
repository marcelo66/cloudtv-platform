import { IsString, IsOptional, IsEnum, IsInt, IsDateString, Min, MaxLength } from 'class-validator';
import { Recurrence } from '@prisma/client';

export class UpdateScheduleDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  playlistId?: string;

  @IsDateString()
  @IsOptional()
  startTime?: string;

  @IsDateString()
  @IsOptional()
  endTime?: string;

  @IsEnum(Recurrence)
  @IsOptional()
  recurrence?: Recurrence;

  @IsInt()
  @Min(0)
  @IsOptional()
  priority?: number;

  @IsString()
  @IsOptional()
  preAdBlockId?: string | null;

  @IsString()
  @IsOptional()
  postAdBlockId?: string | null;
}
