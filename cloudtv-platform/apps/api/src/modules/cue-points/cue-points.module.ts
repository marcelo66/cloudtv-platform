import { Module } from '@nestjs/common';
import { CuePointsController } from './cue-points.controller';
import { CuePointsService } from './cue-points.service';

@Module({
  controllers: [CuePointsController],
  providers: [CuePointsService],
  exports: [CuePointsService],
})
export class CuePointsModule {}
