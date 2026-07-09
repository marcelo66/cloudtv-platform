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
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';
import { ChannelsService } from './channels.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/create-channel.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TrialGuard } from '../auth/guards/trial.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TrialGuard)
@Controller('channels')
export class ChannelsController {
  constructor(private channelsService: ChannelsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear canal' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateChannelDto) {
    return this.channelsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar mis canales' })
  findAll(@CurrentUser('id') userId: string) {
    return this.channelsService.findAllByUser(userId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Estadísticas del dashboard' })
  stats(@CurrentUser('id') userId: string) {
    return this.channelsService.getDashboardStats(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener canal por ID' })
  findOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.channelsService.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar canal' })
  update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channelsService.update(id, userId, dto);
  }

  @Post(':id/regenerate-key')
  @ApiOperation({ summary: 'Regenerar stream key' })
  regenerateKey(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.channelsService.regenerateStreamKey(id, userId);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Iniciar emisión del canal' })
  start(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.channelsService.startChannel(id, userId);
  }

  @Post(':id/stop')
  @ApiOperation({ summary: 'Detener emisión del canal' })
  stop(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.channelsService.stopChannel(id, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar canal' })
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.channelsService.remove(id, userId);
  }
}
