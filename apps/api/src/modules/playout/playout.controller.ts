import {
  Controller,
  Get,
  Post,
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
   * Inicia una salida RTMP individual si el canal está live.
   * No requiere que el canal haya iniciado sus salidas automáticamente.
   */
  @Post(':channelId/outputs/:outputId/start')
  @UseGuards(JwtAuthGuard)
  startOutput(
    @Param('channelId') channelId: string,
    @Param('outputId') outputId: string,
  ) {
    return this.playoutService.startOutputNow(channelId, outputId);
  }

  /**
   * Detiene una salida RTMP individual sin afectar el canal ni otras salidas.
   */
  @Post(':channelId/outputs/:outputId/stop')
  @UseGuards(JwtAuthGuard)
  stopOutput(
    @Param('channelId') channelId: string,
    @Param('outputId') outputId: string,
  ) {
    return this.playoutService.stopOutputNow(channelId, outputId);
  }

  /**
   * Activa una fuente de ingesta: interrumpe la playlist y emite la señal externa.
   * Requiere que el canal esté activo.
   */
  @Post(':channelId/ingest/:ingestId/activate')
  @UseGuards(JwtAuthGuard)
  activateIngest(
    @Param('channelId') channelId: string,
    @Param('ingestId')  ingestId:  string,
    @CurrentUser('id')  userId:    string,
  ) {
    return this.playoutService.activateIngest(channelId, ingestId, userId);
  }

  /**
   * Desactiva la ingesta activa y retoma la programación normal del canal.
   */
  @Post(':channelId/ingest/deactivate')
  @UseGuards(JwtAuthGuard)
  deactivateIngest(
    @Param('channelId') channelId: string,
    @CurrentUser('id')  userId:    string,
  ) {
    return this.playoutService.deactivateIngest(channelId, userId);
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
