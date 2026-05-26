import {
  IsString, IsOptional, IsEnum, IsInt, IsDateString, Min, MaxLength,
} from 'class-validator';
import { Recurrence } from '@prisma/client';

export class CreateScheduleDto {
  @IsString()
  channelId: string;

  @IsString()
  @IsOptional()
  playlistId?: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsDateString()
  startTime: string;

  @IsDateString()
  endTime: string;

  @IsEnum(Recurrence)
  @IsOptional()
  recurrence?: Recurrence;

  @IsInt()
  @Min(0)
  @IsOptional()
  priority?: number;
}
