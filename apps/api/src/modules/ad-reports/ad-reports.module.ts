import { Module } from '@nestjs/common';
import { AdReportsController } from './ad-reports.controller';
import { AdReportsService } from './ad-reports.service';

@Module({
  controllers: [AdReportsController],
  providers: [AdReportsService],
})
export class AdReportsModule {}
