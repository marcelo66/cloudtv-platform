import { IsString, IsOptional, IsNumber, Min } from 'class-validator';

export class AddItemDto {
  @IsString()
  videoId: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  trimStart?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  trimEnd?: number;
}
