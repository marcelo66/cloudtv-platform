import { Module } from '@nestjs/common';
import { StreamOutputsController } from './stream-outputs.controller';
import { StreamOutputsService } from './stream-outputs.service';

// PrismaModule es @Global() → no hace falta importarlo
@Module({
  controllers: [StreamOutputsController],
  providers: [StreamOutputsService],
  exports: [StreamOutputsService],
})
export class StreamOutputsModule {}
