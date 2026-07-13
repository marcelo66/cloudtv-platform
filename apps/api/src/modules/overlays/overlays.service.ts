import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateOverlayDto, UpdateOverlayDto } from './dto/overlay.dto';

@Injectable()
export class OverlaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ─── Public CRUD ──────────────────────────────────────────────

  async findAll(channelId: string, userId: string) {
    await this.verifyOwnership(channelId, userId);
    return this.prisma.overlay.findMany({
      where: { channelId },
      orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(channelId: string, id: string, userId: string) {
    await this.verifyOwnership(channelId, userId);
    const overlay = await this.prisma.overlay.findFirst({ where: { id, channelId } });
    if (!overlay) throw new NotFoundException('Overlay no encontrado');
    return overlay;
  }

  async create(channelId: string, userId: string, dto: CreateOverlayDto) {
    await this.verifyOwnership(channelId, userId);
    return this.prisma.overlay.create({
      data: {
        channelId,
        name: dto.name,
        type: dto.type,
        enabled: dto.enabled ?? true,
        config: dto.config,
        zIndex: dto.zIndex ?? 0,
      },
    });
  }

  async update(channelId: string, id: string, userId: string, dto: UpdateOverlayDto) {
    await this.verifyOwnership(channelId, userId);
    const overlay = await this.prisma.overlay.findFirst({ where: { id, channelId } });
    if (!overlay) throw new NotFoundException('Overlay no encontrado');
    return this.prisma.overlay.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.config !== undefined && { config: dto.config }),
        ...(dto.zIndex !== undefined && { zIndex: dto.zIndex }),
      },
    });
  }

  async remove(channelId: string, id: string, userId: string) {
    await this.verifyOwnership(channelId, userId);
    const overlay = await this.prisma.overlay.findFirst({ where: { id, channelId } });
    if (!overlay) throw new NotFoundException('Overlay no encontrado');

    // Eliminar imagen del storage si es LOGO
    const cfg = overlay.config as any;
    if (cfg?.imageKey) {
      await this.storage.deleteObject(cfg.imageKey).catch(() => {/* ignorar */});
    }

    return this.prisma.overlay.delete({ where: { id } });
  }

  async uploadLogo(
    channelId: string,
    id: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    await this.verifyOwnership(channelId, userId);
    const overlay = await this.prisma.overlay.findFirst({ where: { id, channelId } });
    if (!overlay) throw new NotFoundException('Overlay no encontrado');

    const ext = file.mimetype.includes('gif') ? 'gif' : file.mimetype.includes('png') ? 'png' : 'jpg';
    const imageKey = `overlays/${channelId}/${id}/logo.${ext}`;

    // Eliminar imagen anterior si existe
    const oldCfg = (overlay.config as any) ?? {};
    if (oldCfg.imageKey && oldCfg.imageKey !== imageKey) {
      await this.storage.deleteObject(oldCfg.imageKey).catch(() => {/* ok */});
    }

    const imageUrl = await this.storage.putObject(imageKey, file.buffer, file.mimetype);

    const newConfig = { ...oldCfg, imageKey, imageUrl };
    return this.prisma.overlay.update({
      where: { id },
      data: { config: newConfig },
    });
  }

  // ─── Usado por PlayoutService ──────────────────────────────────

  async getEnabledForChannel(channelId: string) {
    return this.prisma.overlay.findMany({
      where: { channelId, enabled: true },
      orderBy: { zIndex: 'asc' },
    });
  }

  // ─── Helper ───────────────────────────────────────────────────

  private async verifyOwnership(channelId: string, userId: string) {
    const ch = await this.prisma.channel.findFirst({ where: { id: channelId, userId } });
    if (!ch) throw new NotFoundException('Canal no encontrado');
    return ch;
  }
}
