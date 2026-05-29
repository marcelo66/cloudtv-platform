import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIngestSourceDto, UpdateIngestSourceDto } from './dto/ingest.dto';

@Injectable()
export class IngestService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Ownership helper ────────────────────────────────────────────

  private async verifyOwnership(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Canal no encontrado');
    return channel;
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  async findAll(channelId: string, userId: string) {
    await this.verifyOwnership(channelId, userId);
    return this.prisma.ingestSource.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(channelId: string, id: string, userId: string) {
    await this.verifyOwnership(channelId, userId);
    const source = await this.prisma.ingestSource.findFirst({
      where: { id, channelId },
    });
    if (!source) throw new NotFoundException('Fuente de ingesta no encontrada');
    return source;
  }

  async create(channelId: string, userId: string, dto: CreateIngestSourceDto) {
    await this.verifyOwnership(channelId, userId);
    return this.prisma.ingestSource.create({
      data: {
        channelId,
        name:          dto.name.trim(),
        type:          dto.type,
        url:           dto.url?.trim()          ?? '',
        srtPort:       dto.srtPort              ?? null,
        srtLatency:    dto.srtLatency           ?? null,
        srtPassphrase: dto.srtPassphrase        ?? null,
        rtmpPort:      dto.rtmpPort             ?? null,
        rtmpKey:       dto.rtmpKey              ?? null,
      },
    });
  }

  async update(channelId: string, id: string, userId: string, dto: UpdateIngestSourceDto) {
    await this.verifyOwnership(channelId, userId);
    const existing = await this.prisma.ingestSource.findFirst({
      where: { id, channelId },
    });
    if (!existing) throw new NotFoundException('Fuente de ingesta no encontrada');

    return this.prisma.ingestSource.update({
      where: { id },
      data: {
        ...(dto.name          !== undefined && { name:          dto.name.trim() }),
        ...(dto.url           !== undefined && { url:           dto.url.trim()  }),
        ...(dto.srtPort       !== undefined && { srtPort:       dto.srtPort     }),
        ...(dto.srtLatency    !== undefined && { srtLatency:    dto.srtLatency  }),
        ...(dto.srtPassphrase !== undefined && { srtPassphrase: dto.srtPassphrase }),
        ...(dto.rtmpPort      !== undefined && { rtmpPort:      dto.rtmpPort    }),
        ...(dto.rtmpKey       !== undefined && { rtmpKey:       dto.rtmpKey     }),
      },
    });
  }

  async remove(channelId: string, id: string, userId: string) {
    await this.verifyOwnership(channelId, userId);
    const existing = await this.prisma.ingestSource.findFirst({
      where: { id, channelId },
    });
    if (!existing) throw new NotFoundException('Fuente de ingesta no encontrada');
    await this.prisma.ingestSource.delete({ where: { id } });
    return { message: 'Fuente de ingesta eliminada' };
  }
}
