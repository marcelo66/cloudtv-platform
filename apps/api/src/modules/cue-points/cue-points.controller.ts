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
import { CuePointsService } from './cue-points.service';
import { CreateCuePointDto, UpdateCuePointDto } from './dto/cue-point.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Cue Points')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('channels/:channelId/cue-points')
export class CuePointsController {
  constructor(private readonly cuePointsService: CuePointsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar cue points del canal' })
  findAll(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.cuePointsService.findAll(channelId, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear cue point' })
  create(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCuePointDto,
  ) {
    return this.cuePointsService.create(channelId, userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar cue point' })
  update(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCuePointDto,
  ) {
    return this.cuePointsService.update(id, channelId, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar cue point' })
  remove(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.cuePointsService.remove(id, channelId, userId);
  }
}
