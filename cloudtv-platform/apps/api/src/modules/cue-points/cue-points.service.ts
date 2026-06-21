import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CuePointType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCuePointDto, UpdateCuePointDto } from './dto/cue-point.dto';

@Injectable()
export class CuePointsService {
  constructor(private prisma: PrismaService) {}

  private async ensureChannelOwnership(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Canal no encontrado');
    return channel;
  }

  async findAll(channelId: string, userId: string) {
    await this.ensureChannelOwnership(channelId, userId);
    return this.prisma.cuePoint.findMany({
      where: { channelId },
      include: {
        video: { select: { id: true, title: true, duration: true, thumbnailUrl: true } },
        adBlock: { select: { id: true, name: true, rotationMode: true, isActive: true } },
      },
      orderBy: [{ videoId: 'asc' }, { type: 'asc' }, { timeOffset: 'asc' }],
    });
  }

  async create(channelId: string, userId: string, dto: CreateCuePointDto) {
    await this.ensureChannelOwnership(channelId, userId);

    // Validar que el video pertenece al canal
    const video = await this.prisma.video.findFirst({ where: { id: dto.videoId, channelId } });
    if (!video) throw new NotFoundException('Video no encontrado en este canal');

    // Validar que la tanda pertenece al canal
    const adBlock = await this.prisma.adBlock.findFirst({ where: { id: dto.adBlockId, channelId } });
    if (!adBlock) throw new NotFoundException('Tanda no encontrada en este canal');

    // MID_ROLL requiere timeOffset
    if (dto.type === CuePointType.MID_ROLL && (dto.timeOffset == null || dto.timeOffset <= 0)) {
      throw new BadRequestException('Los cue points MID_ROLL requieren un tiempo de inserción > 0');
    }

    // Validar que el timeOffset no excede la duración del video
    if (dto.type === CuePointType.MID_ROLL && video.duration && dto.timeOffset! >= video.duration) {
      throw new BadRequestException(
        `El tiempo de inserción (${dto.timeOffset}s) supera la duración del video (${video.duration?.toFixed(1)}s)`,
      );
    }

    return this.prisma.cuePoint.create({
      data: {
        channelId,
        videoId: dto.videoId,
        adBlockId: dto.adBlockId,
        type: dto.type,
        timeOffset: dto.type === CuePointType.MID_ROLL ? dto.timeOffset : null,
        label: dto.label,
      },
      include: {
        video: { select: { id: true, title: true, duration: true, thumbnailUrl: true } },
        adBlock: { select: { id: true, name: true, rotationMode: true, isActive: true } },
      },
    });
  }

  async update(id: string, channelId: string, userId: string, dto: UpdateCuePointDto) {
    await this.ensureChannelOwnership(channelId, userId);
    const cp = await this.prisma.cuePoint.findFirst({ where: { id, channelId } });
    if (!cp) throw new NotFoundException('Cue point no encontrado');

    if (dto.adBlockId) {
      const adBlock = await this.prisma.adBlock.findFirst({ where: { id: dto.adBlockId, channelId } });
      if (!adBlock) throw new NotFoundException('Tanda no encontrada en este canal');
    }

    const type = dto.type ?? cp.type;
    if (type === CuePointType.MID_ROLL) {
      const offset = dto.timeOffset ?? cp.timeOffset;
      if (offset == null || offset <= 0) {
        throw new BadRequestException('MID_ROLL requiere un tiempo de inserción > 0');
      }
    }

    return this.prisma.cuePoint.update({
      where: { id },
      data: {
        ...dto,
        timeOffset: type === CuePointType.MID_ROLL ? (dto.timeOffset ?? cp.timeOffset) : null,
      },
      include: {
        video: { select: { id: true, title: true, duration: true, thumbnailUrl: true } },
        adBlock: { select: { id: true, name: true, rotationMode: true, isActive: true } },
      },
    });
  }

  async remove(id: string, channelId: string, userId: string) {
    await this.ensureChannelOwnership(channelId, userId);
    const cp = await this.prisma.cuePoint.findFirst({ where: { id, channelId } });
    if (!cp) throw new NotFoundException('Cue point no encontrado');
    await this.prisma.cuePoint.delete({ where: { id } });
    return { success: true };
  }
}
