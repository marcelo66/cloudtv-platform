import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  HttpStatus,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
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
   * Endpoint de diagnóstico (público): muestra estado de sesión + contenido del m3u8.
   * Útil para verificar que el stream esté corriendo y que el m3u8 tenga paths relativos.
   */
  @Get(':channelId/debug')
  async debug(@Param('channelId') channelId: string) {
    const session = this.playoutService.getStatus(channelId);
    const hlsPath = this.playoutService.getHlsFilePath(channelId, 'index.m3u8');
    let m3u8Content: string | null = null;
    if (hlsPath) {
      try {
        m3u8Content = await fs.readFile(hlsPath, 'utf-8');
      } catch {
        m3u8Content = null;
      }
    }
    return {
      session,
      m3u8Exists: m3u8Content !== null,
      m3u8Content,
      logs: this.playoutService.getLogs(channelId).slice(-20),
    };
  }

  /**
   * Sirve index.m3u8 y seg*.ts — PÚBLICO (el player HLS hace requests sin token).
   * Usa createReadStream para mayor compatibilidad con NestJS StreamableFile.
   */
  @Get(':channelId/hls/:file')
  async serveHls(
    @Param('channelId') channelId: string,
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | void> {
    const filePath = this.playoutService.getHlsFilePath(channelId, file);

    if (!filePath) {
      res.status(HttpStatus.BAD_REQUEST).json({ message: 'Nombre inválido' });
      return;
    }

    try {
      await fs.access(filePath);
    } catch {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Segmento no disponible' });
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (file.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    } else {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'max-age=3600, immutable');
    }

    return new StreamableFile(createReadStream(filePath));
  }
}
