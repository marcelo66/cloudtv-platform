import {
  IsEmail,
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  MinLength,
} from 'class-validator';
import { Plan, Role } from '@prisma/client';

export class CreateAdminUserDto {
  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(Plan)
  @IsOptional()
  plan?: Plan;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxChannels?: number;
}

export class UpdateAdminUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(Plan)
  @IsOptional()
  plan?: Plan;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxChannels?: number | null;
}
