import { Module } from '@nestjs/common';
import { AdBlocksController } from './ad-blocks.controller';
import { AdBlocksService } from './ad-blocks.service';

@Module({
  controllers: [AdBlocksController],
  providers: [AdBlocksService],
  exports: [AdBlocksService],
})
export class AdBlocksModule {}
