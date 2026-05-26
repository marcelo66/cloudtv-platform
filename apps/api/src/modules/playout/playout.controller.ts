import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs/promises';
import { PlayoutService } from './playout.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('playout')
export class PlayoutController {
  constructor(private readonly playoutService: PlayoutService) {}

  /**
   * Devuelve los últimos logs de FFmpeg para el canal indicado.
   * Requiere autenticación.
   */
  @Get(':channelId/logs')
  @UseGuards(JwtAuthGuard)
  getLogs(
    @Param('channelId') channelId: string,
    @CurrentUser('id') _userId: string,
  ) {
    return {
      logs: this.playoutService.getLogs(channelId),
      status: this.playoutService.getStatus(channelId),
    };
  }

  /**
   * Sirve index.m3u8 y seg*.ts — PÚBLICO (el player HLS hace requests sin token).
   */
  @Get(':channelId/hls/:file')
  async serveHls(
    @Param('channelId') channelId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    const filePath = this.playoutService.getHlsFilePath(channelId, file);

    if (!filePath) {
      return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Nombre inválido' });
    }

    try {
      await fs.access(filePath);
    } catch {
      return res.status(HttpStatus.NOT_FOUND).json({ message: 'Segmento no disponible' });
    }

    if (file.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
    } else {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'max-age=3600');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.sendFile(filePath);
  }
}
