import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdBlocksService } from './ad-blocks.service';
import {
  CreateAdBlockDto,
  UpdateAdBlockDto,
  CreateAdSpotDto,
  UpdateAdSpotDto,
  ReorderSpotsDto,
} from './dto/ad-block.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Ad Blocks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('channels/:channelId/ad-blocks')
export class AdBlocksController {
  constructor(private readonly adBlocksService: AdBlocksService) {}

  // ─── Ad Blocks ────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Crear tanda publicitaria' })
  create(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAdBlockDto,
  ) {
    return this.adBlocksService.createAdBlock(channelId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar tandas del canal' })
  findAll(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.adBlocksService.findAllAdBlocks(channelId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener tanda con spots' })
  findOne(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.adBlocksService.findAdBlock(id, channelId, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar tanda' })
  update(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAdBlockDto,
  ) {
    return this.adBlocksService.updateAdBlock(id, channelId, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar tanda' })
  remove(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.adBlocksService.deleteAdBlock(id, channelId, userId);
  }

  // ─── Ad Spots ─────────────────────────────────────────────────

  @Post(':id/spots')
  @ApiOperation({ summary: 'Agregar spot a la tanda' })
  addSpot(
    @Param('channelId') channelId: string,
    @Param('id') adBlockId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAdSpotDto,
  ) {
    return this.adBlocksService.addSpot(adBlockId, channelId, userId, dto);
  }

  @Patch(':id/spots/:spotId')
  @ApiOperation({ summary: 'Actualizar spot' })
  updateSpot(
    @Param('channelId') channelId: string,
    @Param('id') adBlockId: string,
    @Param('spotId') spotId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAdSpotDto,
  ) {
    return this.adBlocksService.updateSpot(adBlockId, spotId, channelId, userId, dto);
  }

  @Delete(':id/spots/:spotId')
  @ApiOperation({ summary: 'Eliminar spot' })
  removeSpot(
    @Param('channelId') channelId: string,
    @Param('id') adBlockId: string,
    @Param('spotId') spotId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.adBlocksService.removeSpot(adBlockId, spotId, channelId, userId);
  }

  @Patch(':id/spots/reorder')
  @ApiOperation({ summary: 'Reordenar spots' })
  reorderSpots(
    @Param('channelId') channelId: string,
    @Param('id') adBlockId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ReorderSpotsDto,
  ) {
    return this.adBlocksService.reorderSpots(adBlockId, channelId, userId, dto);
  }
}
