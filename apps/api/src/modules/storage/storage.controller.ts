import { Controller, Get, Req, Res, NotFoundException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { StorageService } from './storage.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('storage')
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('files/*')
  async serveFile(@Req() req: Request, @Res() res: Response) {
    const key = (req.params as any)[0];
    if (!key) throw new NotFoundException();

    try {
      const { stream, contentType, contentLength } = await this.storage.getObjectStream(key);

      res.set({
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...(contentLength != null && { 'Content-Length': String(contentLength) }),
      });

      stream.pipe(res);
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException();
      }
      this.logger.error(`Error serving file ${key}: ${err.message}`);
      throw err;
    }
  }
}
