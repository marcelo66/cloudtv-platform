import { Module } from '@nestjs/common';
import { PlayoutController } from './playout.controller';
import { PlayoutService } from './playout.service';
import { OverlaysModule } from '../overlays/overlays.module';
import { StreamOutputsModule } from '../stream-outputs/stream-outputs.module';
import { AdBlocksModule } from '../ad-blocks/ad-blocks.module';

@Module({
  imports: [OverlaysModule, StreamOutputsModule, AdBlocksModule],
  controllers: [PlayoutController],
  providers: [PlayoutService],
  exports: [PlayoutService],
})
export class PlayoutModule {}
