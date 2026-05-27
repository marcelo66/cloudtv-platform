import { Injectable, NotFoundException } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStreamOutputDto, UpdateStreamOutputDto } from './dto/stream-output.dto';

/** URL base de cada plataforma (sin stream key). */
export const PLATFORM_RTMP_BASE: Record<string, string> = {
  YOUTUBE:  'rtmp://a.rtmp.youtube.com/live2',
  FACEBOOK: 'rtmps://live-api-s.facebook.com:443/rtmp',
  TWITCH:   'rtmp://live.twitch.tv/app',
  RTMP_CUSTOM: '',
};

@Injectable()
export class StreamOutputsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD ─────────────────────────────────────────────────────

  async findAll(channelId: string, userId: string) {
    await this.verifyOwnership(channelId, userId);
    return this.prisma.streamOutput.findMany({
      where: { channelId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(channelId: string, id: string, userId: string) {
    await this.verifyOwnership(channelId, userId);
    const output = await this.prisma.streamOutput.findFirst({ where: { id, channelId } });
    if (!output) throw new NotFoundException('Salida no encontrada');
    return output;
  }

  async create(channelId: string, userId: string, dto: CreateStreamOutputDto) {
    await this.verifyOwnership(channelId, userId);

    // Auto-completar rtmpUrl para plataformas conocidas
    const rtmpUrl = dto.rtmpUrl?.trim() || PLATFORM_RTMP_BASE[dto.platform] || '';

    return this.prisma.streamOutput.create({
      data: {
        channelId,
        name: dto.name.trim(),
        platform: dto.platform,
        rtmpUrl,
        streamKey: dto.streamKey.trim(),
        enabled: dto.enabled ?? true,
        status: 'IDLE',
      },
    });
  }

  async update(channelId: string, id: string, userId: string, dto: UpdateStreamOutputDto) {
    await this.verifyOwnership(channelId, userId);
    const output = await this.prisma.streamOutput.findFirst({ where: { id, channelId } });
    if (!output) throw new NotFoundException('Salida no encontrada');

    return this.prisma.streamOutput.update({
      where: { id },
      data: {
        ...(dto.name !== undefined      && { name: dto.name.trim() }),
        ...(dto.rtmpUrl !== undefined   && { rtmpUrl: dto.rtmpUrl.trim() }),
        ...(dto.streamKey !== undefined && { streamKey: dto.streamKey.trim() }),
        ...(dto.enabled !== undefined   && { enabled: dto.enabled }),
      },
    });
  }

  async remove(channelId: string, id: string, userId: string) {
    await this.verifyOwnership(channelId, userId);
    const output = await this.prisma.streamOutput.findFirst({ where: { id, channelId } });
    if (!output) throw new NotFoundException('Salida no encontrada');
    return this.prisma.streamOutput.delete({ where: { id } });
  }

  // ─── Usado por PlayoutService ──────────────────────────────────

  async getEnabledForChannel(channelId: string) {
    return this.prisma.streamOutput.findMany({
      where: { channelId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateStatus(id: string, status: 'IDLE' | 'STREAMING' | 'ERROR') {
    return this.prisma.streamOutput.update({
      where: { id },
      data: { status },
    }).catch(() => { /* ignorar si el registro fue eliminado */ });
  }

  /** Resetea todas las salidas del canal a IDLE (se llama al detener o al arrancar el módulo). */
  async resetStatusesForChannel(channelId: string) {
    return this.prisma.streamOutput.updateMany({
      where: { channelId, status: { not: 'IDLE' } },
      data: { status: 'IDLE' },
    });
  }

  // ─── Helper ───────────────────────────────────────────────────

  private async verifyOwnership(channelId: string, userId: string) {
    const ch = await this.prisma.channel.findFirst({ where: { id: channelId, userId } });
    if (!ch) throw new NotFoundException('Canal no encontrado');
    return ch;
  }
}
