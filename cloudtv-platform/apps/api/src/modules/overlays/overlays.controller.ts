import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OverlaysService } from './overlays.service';
import { CreateOverlayDto, UpdateOverlayDto } from './dto/overlay.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('channels/:channelId/overlays')
@UseGuards(JwtAuthGuard)
export class OverlaysController {
  constructor(private readonly service: OverlaysService) {}

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
    @Body() dto: CreateOverlayDto,
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
    @Body() dto: UpdateOverlayDto,
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

  /**
   * Subir/reemplazar el logo de un overlay de tipo LOGO.
   * multipart/form-data con campo "file" (image/png o image/jpeg).
   */
  @Post(':id/logo')
  @UseInterceptors(FileInterceptor('file'))
  uploadLogo(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadLogo(channelId, id, userId, file);
  }
}
