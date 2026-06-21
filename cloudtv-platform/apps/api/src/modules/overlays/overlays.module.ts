import { Module } from '@nestjs/common';
import { OverlaysController } from './overlays.controller';
import { OverlaysService } from './overlays.service';

// PrismaModule y StorageModule son @Global() → no hace falta importarlos
@Module({
  controllers: [OverlaysController],
  providers: [OverlaysService],
  exports: [OverlaysService],
})
export class OverlaysModule {}
