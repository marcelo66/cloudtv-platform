import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { AddItemDto } from './dto/add-item.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';

@Injectable()
export class PlaylistsService {
  constructor(private prisma: PrismaService) {}

  // ─── Helpers ─────────────────────────────────────────────────

  private async verifyChannelOwnership(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) throw new NotFoundException('Canal no encontrado');
    if (channel.userId !== userId) throw new ForbiddenException('Sin acceso');
    return channel;
  }

  private async verifyPlaylistOwnership(playlistId: string, userId: string) {
    const playlist = await this.prisma.playlist.findUnique({
      where: { id: playlistId },
      include: { channel: true },
    });
    if (!playlist) throw new NotFoundException('Playlist no encontrada');
    if (playlist.channel.userId !== userId) throw new ForbiddenException('Sin acceso');
    return playlist;
  }

  private async recalcDuration(playlistId: string) {
    const items = await this.prisma.playlistItem.findMany({
      where: { playlistId },
      include: { video: true },
    });
    const total = items.reduce((acc, item) => {
      if (!item.video.duration) return acc;
      const start = item.trimStart ?? 0;
      const end = item.trimEnd ?? item.video.duration;
      return acc + Math.max(0, end - start);
    }, 0);
    await this.prisma.playlist.update({
      where: { id: playlistId },
      data: { totalDuration: total },
    });
  }

  // ─── CRUD Playlists ───────────────────────────────────────────

  async create(dto: CreatePlaylistDto, userId: string) {
    await this.verifyChannelOwnership(dto.channelId, userId);

    // Si se marca como default, quitar default de las demás
    if (dto.isDefault) {
      await this.prisma.playlist.updateMany({
        where: { channelId: dto.channelId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.playlist.create({
      data: {
        channelId: dto.channelId,
        name: dto.name,
        description: dto.description,
        loopMode: dto.loopMode ?? 'LOOP_ALL',
        isDefault: dto.isDefault ?? false,
      },
      include: { items: { include: { video: true }, orderBy: { order: 'asc' } } },
    });
  }

  async findAll(channelId: string, userId: string) {
    await this.verifyChannelOwnership(channelId, userId);
    return this.prisma.playlist.findMany({
      where: { channelId },
      include: {
        _count: { select: { items: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string, userId: string) {
    await this.verifyPlaylistOwnership(id, userId);
    return this.prisma.playlist.findUnique({
      where: { id },
      include: {
        items: {
          include: { video: true },
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  async update(id: string, dto: UpdatePlaylistDto, userId: string) {
    const playlist = await this.verifyPlaylistOwnership(id, userId);

    if (dto.isDefault) {
      await this.prisma.playlist.updateMany({
        where: { channelId: playlist.channelId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.playlist.update({
      where: { id },
      data: dto,
      include: { items: { include: { video: true }, orderBy: { order: 'asc' } } },
    });
  }

  async remove(id: string, userId: string) {
    await this.verifyPlaylistOwnership(id, userId);
    await this.prisma.playlist.delete({ where: { id } });
    return { success: true };
  }

  // ─── Items ────────────────────────────────────────────────────

  async addItem(playlistId: string, dto: AddItemDto, userId: string) {
    await this.verifyPlaylistOwnership(playlistId, userId);

    // Verificar que el video existe y pertenece al mismo canal
    const playlist = await this.prisma.playlist.findUnique({ where: { id: playlistId } });
    const video = await this.prisma.video.findUnique({ where: { id: dto.videoId } });
    if (!video) throw new NotFoundException('Video no encontrado');
    if (video.channelId !== playlist!.channelId) {
      throw new BadRequestException('El video no pertenece a este canal');
    }

    // Calcular el siguiente orden
    const lastItem = await this.prisma.playlistItem.findFirst({
      where: { playlistId },
      orderBy: { order: 'desc' },
    });
    const nextOrder = (lastItem?.order ?? -1) + 1;

    const item = await this.prisma.playlistItem.create({
      data: {
        playlistId,
        videoId: dto.videoId,
        order: nextOrder,
        trimStart: dto.trimStart,
        trimEnd: dto.trimEnd,
      },
      include: { video: true },
    });

    await this.recalcDuration(playlistId);
    return item;
  }

  async removeItem(playlistId: string, itemId: string, userId: string) {
    await this.verifyPlaylistOwnership(playlistId, userId);
    await this.prisma.playlistItem.delete({ where: { id: itemId } });

    // Reordenar los ítems restantes
    const remaining = await this.prisma.playlistItem.findMany({
      where: { playlistId },
      orderBy: { order: 'asc' },
    });
    await Promise.all(
      remaining.map((item, idx) =>
        this.prisma.playlistItem.update({
          where: { id: item.id },
          data: { order: idx },
        }),
      ),
    );

    await this.recalcDuration(playlistId);
    return { success: true };
  }

  async reorderItems(playlistId: string, dto: ReorderItemsDto, userId: string) {
    await this.verifyPlaylistOwnership(playlistId, userId);

    await Promise.all(
      dto.items.map(({ id, order }) =>
        this.prisma.playlistItem.update({
          where: { id },
          data: { order },
        }),
      ),
    );

    return this.findOne(playlistId, userId);
  }
}
