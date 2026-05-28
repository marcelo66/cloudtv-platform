import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AdReportsService } from './ad-reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Ad Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('channels/:channelId/ad-reports')
export class AdReportsController {
  constructor(private readonly adReportsService: AdReportsService) {}

  @Get()
  @ApiOperation({ summary: 'Resumen de impresiones publicitarias' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getSummary(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adReportsService.getSummary(channelId, userId, from, to);
  }

  @Get('impressions')
  @ApiOperation({ summary: 'Lista detallada de impresiones' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getImpressions(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adReportsService.getImpressions(
      channelId,
      userId,
      from,
      to,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 100,
    );
  }
}
