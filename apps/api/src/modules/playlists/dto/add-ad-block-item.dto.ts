import { IsString } from 'class-validator';

export class AddAdBlockItemDto {
  @IsString()
  adBlockId: string;
}
