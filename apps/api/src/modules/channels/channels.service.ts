import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import slugify from 'slugify';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/create-channel.dto';
import { PlayoutService } from '../playout/playout.service';

@Injectable()
export class ChannelsService {
  constructor(
    private prisma: PrismaService,
    private playout: PlayoutService,
  ) {}

  async create(userId: string, dto: CreateChannelDto) {
    let slug = dto.slug || slugify(dto.name, { lower: true, strict: true });

    // Verificar unicidad del slug
    const existing = await this.prisma.channel.findUnique({ where: { slug } });
    if (existing) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    return this.prisma.channel.create({
      data: {
        userId,
        name: dto.name,
        slug,
        description: dto.description,
        hlsUrl: `http://localhost:8888/live/${slug}/index.m3u8`,
      },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.channel.findMany({
      where: { userId },
      include: {
        _count: {
          select: { videos: true, playlists: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
      include: {
        _count: {
          select: { videos: true, playlists: true },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Canal no encontrado');
    }
    return channel;
  }

  async update(channelId: string, userId: string, dto: UpdateChannelDto) {
    await this.ensureOwnership(channelId, userId);
    return this.prisma.channel.update({
      where: { id: channelId },
      data: dto,
    });
  }

  async regenerateStreamKey(channelId: string, userId: string) {
    await this.ensureOwnership(channelId, userId);
    const { v4: uuidv4 } = await import('uuid');
    return this.prisma.channel.update({
      where: { id: channelId },
      data: { streamKey: uuidv4() },
      select: { streamKey: true },
    });
  }

  async startChannel(channelId: string, userId: string) {
    await this.playout.start(channelId, userId);
    return this.prisma.channel.findUnique({ where: { id: channelId } });
  }

  async stopChannel(channelId: string, userId: string) {
    await this.playout.stop(channelId, userId);
    return this.prisma.channel.findUnique({ where: { id: channelId } });
  }

  async remove(channelId: string, userId: string) {
    await this.ensureOwnership(channelId, userId);
    await this.prisma.channel.delete({ where: { id: channelId } });
    return { success: true };
  }

  async getDashboardStats(userId: string) {
    const channels = await this.prisma.channel.findMany({
      where: { userId },
      select: { id: true, status: true },
    });

    const channelIds = channels.map((c) => c.id);

    const [videoCount, playlistCount, totalDuration] = await Promise.all([
      this.prisma.video.count({
        where: { channelId: { in: channelIds }, status: 'READY' },
      }),
      this.prisma.playlist.count({
        where: { channelId: { in: channelIds } },
      }),
      this.prisma.video.aggregate({
        where: { channelId: { in: channelIds }, status: 'READY' },
        _sum: { duration: true },
      }),
    ]);

    const liveChannels = channels.filter(
      (c) => c.status === 'LIVE_PLAYLIST' || c.status === 'LIVE_RTMP',
    ).length;

    return {
      channels: channels.length,
      liveChannels,
      videos: videoCount,
      playlists: playlistCount,
      totalDurationSeconds: totalDuration._sum.duration || 0,
    };
  }

  private async ensureOwnership(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
    });
    if (!channel) {
      throw new NotFoundException('Canal no encontrado');
    }
    return channel;
  }
}
