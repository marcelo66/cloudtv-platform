import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VideoProcessor } from './processors/video.processor';
import { FfprobeService } from './services/ffprobe.service';
import { FfmpegService } from './services/ffmpeg.service';
import { VIDEO_QUEUE } from '../videos/videos.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: VIDEO_QUEUE,
    }),
  ],
  providers: [VideoProcessor, FfprobeService, FfmpegService],
  exports: [FfprobeService, FfmpegService],
})
export class WorkerModule {}
