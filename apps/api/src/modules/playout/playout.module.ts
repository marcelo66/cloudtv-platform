import { Module } from '@nestjs/common';
import { PlayoutController } from './playout.controller';
import { PlayoutService } from './playout.service';

@Module({
  controllers: [PlayoutController],
  providers: [PlayoutService],
  exports: [PlayoutService],
})
export class PlayoutModule {}
