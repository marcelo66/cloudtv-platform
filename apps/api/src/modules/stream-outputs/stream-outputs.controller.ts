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
import { StreamOutputsService } from './stream-outputs.service';
import { CreateStreamOutputDto, UpdateStreamOutputDto } from './dto/stream-output.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('channels/:channelId/outputs')
@UseGuards(JwtAuthGuard)
export class StreamOutputsController {
  constructor(private readonly service: StreamOutputsService) {}

  @Get()
  findAll(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.findAll(channelId, userId);
  }

  @Post()
  create(
    @Param('channelId') channelId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateStreamOutputDto,
  ) {
    return this.service.create(channelId, userId, dto);
  }

  @Get(':id')
  findOne(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.findOne(channelId, id, userId);
  }

  @Patch(':id')
  update(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateStreamOutputDto,
  ) {
    return this.service.update(channelId, id, userId, dto);
  }

  @Delete(':id')
  remove(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.remove(channelId, id, userId);
  }
}
