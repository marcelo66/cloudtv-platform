import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { RotationMode, VideoStatus } from '@prisma/client';
import type { AdBlock, AdSpot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAdBlockDto,
  UpdateAdBlockDto,
  CreateAdSpotDto,
  UpdateAdSpotDto,
  ReorderSpotsDto,
} from './dto/ad-block.dto';

// Spot con su video incluido (usado por playout)
export interface AdSpotWithVideo extends AdSpot {
  video: {
    id: string;
    originalKey: string;
    processedKey: string | null;
    duration: number | null;
    status: VideoStatus;
  };
}

// Tanda con spots ordenados para playout
export interface AdBlockForPlayout extends AdBlock {
  spots: AdSpotWithVideo[];
}

// Cue point con tanda para playout
export interface CuePointForPlayout {
  id: string;
  videoId: string;
  type: string;
  timeOffset: number | null;
  adBlock: AdBlockForPlayout;
}

@Injectable()
export class AdBlocksService {
  constructor(private prisma: PrismaService) {}

  // ─── Helpers ──────────────────────────────────────────────────

  private async ensureChannelOwnership(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) throw new NotFoundException('Canal no encontrado');
    return channel;
  }

  private async ensureAdBlockOwnership(adBlockId: string, channelId: string) {
    const block = await this.prisma.adBlock.findFirst({
      where: { id: adBlockId, channelId },
    });
    if (!block) throw new NotFoundException('Tanda no encontrada');
    return block;
  }

  // ─── Ad Blocks CRUD ───────────────────────────────────────────

  async createAdBlock(channelId: string, userId: string, dto: CreateAdBlockDto) {
    await this.ensureChannelOwnership(channelId, userId);
    return this.prisma.adBlock.create({
      data: {
        channelId,
        name: dto.name,
        description: dto.description,
        rotationMode: dto.rotationMode ?? RotationMode.SEQUENTIAL,
      },
      include: { spots: { include: { video: { select: { id: true, title: true, duration: true, status: true, thumbnailUrl: true } } }, orderBy: { order: 'asc' } } },
    });
  }

  async findAllAdBlocks(channelId: string, userId: string) {
    await this.ensureChannelOwnership(channelId, userId);
    return this.prisma.adBlock.findMany({
      where: { channelId },
      include: {
        spots: {
          where: { isActive: true },
          include: {
            video: { select: { id: true, title: true, duration: true, status: true, thumbnailUrl: true } },
          },
          orderBy: { order: 'asc' },
        },
        _count: { select: { spots: true, cuePoints: true, impressions: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAdBlock(adBlockId: string, channelId: string, userId: string) {
    await this.ensureChannelOwnership(channelId, userId);
    const block = await this.prisma.adBlock.findFirst({
      where: { id: adBlockId, channelId },
      include: {
        spots: {
          include: {
            video: { select: { id: true, title: true, duration: true, status: true, thumbnailUrl: true } },
          },
          orderBy: { order: 'asc' },
        },
        _count: { select: { impressions: true } },
      },
    });
    if (!block) throw new NotFoundException('Tanda no encontrada');
    return block;
  }

  async updateAdBlock(adBlockId: string, channelId: string, userId: string, dto: UpdateAdBlockDto) {
    await this.ensureChannelOwnership(channelId, userId);
    await this.ensureAdBlockOwnership(adBlockId, channelId);
    return this.prisma.adBlock.update({
      where: { id: adBlockId },
      data: dto,
      include: {
        spots: {
          include: { video: { select: { id: true, title: true, duration: true, status: true } } },
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  async deleteAdBlock(adBlockId: string, channelId: string, userId: string) {
    await this.ensureChannelOwnership(channelId, userId);
    await this.ensureAdBlockOwnership(adBlockId, channelId);
    await this.prisma.adBlock.delete({ where: { id: adBlockId } });
    return { success: true };
  }

  // ─── Ad Spots CRUD ────────────────────────────────────────────

  async addSpot(adBlockId: string, channelId: string, userId: string, dto: CreateAdSpotDto) {
    await this.ensureChannelOwnership(channelId, userId);
    const block = await this.ensureAdBlockOwnership(adBlockId, channelId);

    // Validar que el video pertenece al canal
    const video = await this.prisma.video.findFirst({
      where: { id: dto.videoId, channelId },
    });
    if (!video) throw new NotFoundException('Video no encontrado en este canal');
    if (video.status !== VideoStatus.READY) {
      throw new BadRequestException('El video debe estar en estado READY para usarse como spot');
    }

    // Determinar el orden más alto actual
    const maxOrder = await this.prisma.adSpot.aggregate({
      where: { adBlockId },
      _max: { order: true },
    });
    const nextOrder = (maxOrder._max.order ?? -1) + 1;

    return this.prisma.adSpot.create({
      data: {
        adBlockId,
        videoId: dto.videoId,
        name: dto.name,
        advertiser: dto.advertiser,
        weight: dto.weight ?? 1,
        order: dto.order ?? nextOrder,
      },
      include: {
        video: { select: { id: true, title: true, duration: true, status: true, thumbnailUrl: true } },
      },
    });
  }

  async updateSpot(
    adBlockId: string,
    spotId: string,
    channelId: string,
    userId: string,
    dto: UpdateAdSpotDto,
  ) {
    await this.ensureChannelOwnership(channelId, userId);
    await this.ensureAdBlockOwnership(adBlockId, channelId);
    const spot = await this.prisma.adSpot.findFirst({ where: { id: spotId, adBlockId } });
    if (!spot) throw new NotFoundException('Spot no encontrado');
    return this.prisma.adSpot.update({
      where: { id: spotId },
      data: dto,
      include: {
        video: { select: { id: true, title: true, duration: true, status: true } },
      },
    });
  }

  async removeSpot(adBlockId: string, spotId: string, channelId: string, userId: string) {
    await this.ensureChannelOwnership(channelId, userId);
    await this.ensureAdBlockOwnership(adBlockId, channelId);
    const spot = await this.prisma.adSpot.findFirst({ where: { id: spotId, adBlockId } });
    if (!spot) throw new NotFoundException('Spot no encontrado');
    await this.prisma.adSpot.delete({ where: { id: spotId } });
    // Reordenar restantes
    const remaining = await this.prisma.adSpot.findMany({
      where: { adBlockId },
      orderBy: { order: 'asc' },
    });
    await Promise.all(
      remaining.map((s, i) => this.prisma.adSpot.update({ where: { id: s.id }, data: { order: i } })),
    );
    return { success: true };
  }

  async reorderSpots(adBlockId: string, channelId: string, userId: string, dto: ReorderSpotsDto) {
    await this.ensureChannelOwnership(channelId, userId);
    await this.ensureAdBlockOwnership(adBlockId, channelId);
    await Promise.all(
      dto.ids.map((id, index) =>
        this.prisma.adSpot.update({ where: { id }, data: { order: index } }),
      ),
    );
    return this.prisma.adBlock.findUnique({
      where: { id: adBlockId },
      include: {
        spots: {
          include: { video: { select: { id: true, title: true, duration: true } } },
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  // ─── Rotation logic ───────────────────────────────────────────

  /**
   * Devuelve los spots ordenados según el modo de rotación del bloque.
   * SEQUENTIAL: Rota el punto de inicio en cada llamada (round-robin).
   * RANDOM:     Mezcla aleatoriamente los spots.
   * WEIGHTED:   Los spots de mayor peso aparecen más veces (proporcional).
   */
  async getRotatedSpots(adBlock: AdBlockForPlayout): Promise<AdSpotWithVideo[]> {
    const active = adBlock.spots.filter(
      (s) => s.isActive && (s.video.processedKey ?? s.video.originalKey),
    );
    if (!active.length) return [];

    switch (adBlock.rotationMode) {
      case RotationMode.SEQUENTIAL: {
        const len = active.length;
        const startIdx = adBlock.sequenceIndex % len;
        // Rotamos el inicio para la próxima vez
        await this.prisma.adBlock.update({
          where: { id: adBlock.id },
          data: { sequenceIndex: startIdx + 1 },
        });
        // Reordenar desde startIdx (round-robin)
        return [...active.slice(startIdx), ...active.slice(0, startIdx)];
      }

      case RotationMode.RANDOM: {
        const shuffled = [...active];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      }

      case RotationMode.WEIGHTED: {
        // Expandir lista según peso: weight=3 → aparece 3 veces
        const expanded: AdSpotWithVideo[] = [];
        for (const spot of active) {
          for (let w = 0; w < Math.max(1, spot.weight); w++) {
            expanded.push(spot);
          }
        }
        // Deduplicar pero preservar proporción: reordenar por weighted shuffle
        return this.weightedShuffle(active);
      }

      default:
        return active;
    }
  }

  private weightedShuffle(spots: AdSpotWithVideo[]): AdSpotWithVideo[] {
    // Weighted random selection sin repetición
    const result: AdSpotWithVideo[] = [];
    const pool = spots.map((s) => ({ spot: s, w: Math.pow(Math.random(), 1 / Math.max(1, s.weight)) }));
    pool.sort((a, b) => b.w - a.w);
    return pool.map((p) => p.spot);
  }

  // ─── Playout helpers ──────────────────────────────────────────

  /**
   * Devuelve los cue points activos del canal con sus tandas y spots incluidos.
   * Usado por PlayoutService para inyectar publicidad en el concat.txt.
   */
  async getCuePointsForPlayout(channelId: string): Promise<CuePointForPlayout[]> {
    const cps = await this.prisma.cuePoint.findMany({
      where: { channelId, isActive: true },
      include: {
        adBlock: {
          include: {
            spots: {
              where: { isActive: true },
              include: {
                video: {
                  select: {
                    id: true,
                    originalKey: true,
                    processedKey: true,
                    duration: true,
                    status: true,
                  },
                },
              },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
      orderBy: [{ videoId: 'asc' }, { type: 'asc' }, { timeOffset: 'asc' }],
    });
    return cps.filter((cp) => cp.adBlock.isActive);
  }

  /**
   * Registra una impresión publicitaria (spot programado para emisión).
   */
  async recordImpression(
    spotId: string,
    adBlockId: string,
    channelId: string,
    advertiser: string,
    type: string,
    duration?: number | null,
  ) {
    return this.prisma.adImpression.create({
      data: {
        adSpotId: spotId,
        adBlockId,
        channelId,
        advertiser,
        type: type as any,
        duration: duration ?? null,
      },
    });
  }
}
