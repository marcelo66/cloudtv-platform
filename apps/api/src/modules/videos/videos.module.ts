import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VideosController } from './videos.controller';
import { VideosService, VIDEO_QUEUE } from './videos.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: VIDEO_QUEUE,
    }),
  ],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
