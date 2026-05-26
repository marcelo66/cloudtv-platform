import {
  Controller,
  Get,
  Param,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs/promises';
import { PlayoutService } from './playout.service';

@Controller('playout')
export class PlayoutController {
  constructor(private readonly playoutService: PlayoutService) {}

  /**
   * Sirve los archivos HLS del canal: index.m3u8 + seg*.ts
   * Este endpoint es PÚBLICO — el video player del navegador hace
   * sus propias requests sin token de auth.
   */
  @Get(':channelId/hls/:file')
  async serveHls(
    @Param('channelId') channelId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    const filePath = this.playoutService.getHlsFilePath(channelId, file);

    if (!filePath) {
      return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Nombre de archivo inválido' });
    }

    try {
      await fs.access(filePath);
    } catch {
      return res.status(HttpStatus.NOT_FOUND).json({ message: 'Segmento no disponible aún' });
    }

    // Headers para HLS
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
