import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiQuery,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { VideosService } from './videos.service';
import {
  InitiateUploadDto,
  CompleteUploadDto,
  UpdateVideoDto,
} from './dto/video.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB por chunk máximo

@ApiTags('Videos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('videos')
export class VideosController {
  constructor(private videosService: VideosService) {}

  // ─── Upload endpoints ─────────────────────────────────────────

  @Post('upload/initiate')
  @ApiOperation({
    summary: 'Iniciar upload — crea registro y multipart upload en S3',
  })
  initiateUpload(
    @CurrentUser('id') userId: string,
    @Body() dto: InitiateUploadDto,
  ) {
    return this.videosService.initiateUpload(userId, dto);
  }

  @Post('upload/part')
  @ApiOperation({ summary: 'Subir un chunk del archivo' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('chunk', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CHUNK_SIZE },
    }),
  )
  uploadPart(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('videoId') videoId: string,
    @Body('partNumber') partNumberStr: string,
  ) {
    if (!file) throw new BadRequestException('Chunk requerido');
    if (!videoId) throw new BadRequestException('videoId requerido');

    const partNumber = parseInt(partNumberStr, 10);
    if (isNaN(partNumber) || partNumber < 1) {
      throw new BadRequestException('partNumber inválido');
    }

    return this.videosService.uploadPart(userId, videoId, partNumber, file.buffer);
  }

  @Post('upload/complete')
  @ApiOperation({ summary: 'Completar upload y encolar procesamiento' })
  completeUpload(
    @CurrentUser('id') userId: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.videosService.completeUpload(userId, dto);
  }

  @Post('upload/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancelar un upload en curso' })
  abortUpload(
    @CurrentUser('id') userId: string,
    @Body('videoId') videoId: string,
  ) {
    return this.videosService.abortUpload(userId, videoId);
  }

  // ─── CRUD ──────────────────────────────────────────────────────

  @Post('prenormalize')
  @ApiOperation({ summary: 'Pre-normalizar videos del canal sin norm keys (los encola para el worker)' })
  @ApiQuery({ name: 'channelId', required: true })
  prenormalize(
    @CurrentUser('id') userId: string,
    @Query('channelId') channelId: string,
  ) {
    if (!channelId) throw new BadRequestException('channelId requerido');
    return this.videosService.prenormalizeChannel(userId, channelId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar videos de un canal' })
  @ApiQuery({ name: 'channelId', required: true })
  findAll(
    @CurrentUser('id') userId: string,
    @Query('channelId') channelId: string,
  ) {
    if (!channelId) throw new BadRequestException('channelId requerido');
    return this.videosService.findAll(userId, channelId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener video por ID' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.videosService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar título / descripción / tags' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVideoDto,
  ) {
    return this.videosService.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar video y archivos en storage' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.videosService.remove(userId, id);
  }
}
