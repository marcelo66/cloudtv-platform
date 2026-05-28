import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdReportsService {
  constructor(private prisma: PrismaService) {}

  private async ensureOwnership(channelId: string, userId: string) {
    const ch = await this.prisma.channel.findFirst({ where: { id: channelId, userId } });
    if (!ch) throw new NotFoundException('Canal no encontrado');
  }

  /** Resumen del canal: totales por anunciante + por tipo */
  async getSummary(channelId: string, userId: string, from?: string, to?: string) {
    await this.ensureOwnership(channelId, userId);

    const dateFilter = this.buildDateFilter(from, to);

    const [totalImpressions, byAdvertiser, byType, byBlock, recentImpressions] =
      await Promise.all([
        this.prisma.adImpression.count({ where: { channelId, ...dateFilter } }),

        this.prisma.adImpression.groupBy({
          by: ['advertiser'],
          where: { channelId, ...dateFilter },
          _count: { advertiser: true },
          _sum: { duration: true },
          orderBy: { _count: { advertiser: 'desc' } },
        }),

        this.prisma.adImpression.groupBy({
          by: ['type'],
          where: { channelId, ...dateFilter },
          _count: { type: true },
          orderBy: { _count: { type: 'desc' } },
        }),

        this.prisma.adImpression.groupBy({
          by: ['adBlockId'],
          where: { channelId, ...dateFilter },
          _count: { adBlockId: true },
          orderBy: { _count: { adBlockId: 'desc' } },
          take: 10,
        }),

        this.prisma.adImpression.findMany({
          where: { channelId, ...dateFilter },
          orderBy: { scheduledAt: 'desc' },
          take: 50,
          include: {
            adSpot: { select: { name: true, advertiser: true } },
            adBlock: { select: { name: true } },
          },
        }),
      ]);

    // Enriquecer byBlock con nombres
    const blockIds = byBlock.map((b) => b.adBlockId);
    const blocks = await this.prisma.adBlock.findMany({
      where: { id: { in: blockIds } },
      select: { id: true, name: true },
    });
    const blockMap = Object.fromEntries(blocks.map((b) => [b.id, b.name]));

    return {
      totalImpressions,
      byAdvertiser: byAdvertiser.map((a) => ({
        advertiser: a.advertiser,
        impressions: a._count.advertiser,
        totalDuration: a._sum.duration ?? 0,
      })),
      byType: byType.map((t) => ({
        type: t.type,
        impressions: t._count.type,
      })),
      byBlock: byBlock.map((b) => ({
        adBlockId: b.adBlockId,
        name: blockMap[b.adBlockId] ?? b.adBlockId,
        impressions: b._count.adBlockId,
      })),
      recentImpressions,
    };
  }

  /** Lista paginada de impresiones */
  async getImpressions(
    channelId: string,
    userId: string,
    from?: string,
    to?: string,
    page = 1,
    limit = 100,
  ) {
    await this.ensureOwnership(channelId, userId);
    const dateFilter = this.buildDateFilter(from, to);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.adImpression.findMany({
        where: { channelId, ...dateFilter },
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: limit,
        include: {
          adSpot: { select: { name: true, advertiser: true } },
          adBlock: { select: { name: true } },
        },
      }),
      this.prisma.adImpression.count({ where: { channelId, ...dateFilter } }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  private buildDateFilter(from?: string, to?: string) {
    if (!from && !to) return {};
    const filter: any = {};
    if (from) filter.gte = new Date(from);
    if (to) filter.lte = new Date(to);
    return { scheduledAt: filter };
  }
}
