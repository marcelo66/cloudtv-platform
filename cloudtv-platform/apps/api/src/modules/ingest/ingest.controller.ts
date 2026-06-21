import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IngestService } from './ingest.service';
import { CreateIngestSourceDto, UpdateIngestSourceDto } from './dto/ingest.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('channels/:channelId/ingest')
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  /** GET /channels/:channelId/ingest — listar todas las fuentes */
  @Get()
  findAll(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ingestService.findAll(channelId, userId);
  }

  /** POST /channels/:channelId/ingest — crear fuente */
  @Post()
  create(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateIngestSourceDto,
  ) {
    return this.ingestService.create(channelId, userId, dto);
  }

  /** GET /channels/:channelId/ingest/:id — obtener fuente */
  @Get(':id')
  findOne(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ingestService.findOne(channelId, id, userId);
  }

  /** PATCH /channels/:channelId/ingest/:id — actualizar fuente */
  @Patch(':id')
  update(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateIngestSourceDto,
  ) {
    return this.ingestService.update(channelId, id, userId, dto);
  }

  /** DELETE /channels/:channelId/ingest/:id — eliminar fuente */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ingestService.remove(channelId, id, userId);
  }
}
