import { Module } from '@nestjs/common';
import { YoutubeAuthController } from './youtube-auth.controller';
import { YoutubeAuthService } from './youtube-auth.service';

@Module({
  controllers: [YoutubeAuthController],
  providers:   [YoutubeAuthService],
  exports:     [YoutubeAuthService],
})
export class YoutubeAuthModule {}
