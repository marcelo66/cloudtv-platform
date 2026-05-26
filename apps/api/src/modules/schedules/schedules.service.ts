import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  private async verifyChannelOwnership(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Canal no encontrado');
    if (channel.userId !== userId) throw new ForbiddenException('Sin acceso');
    return channel;
  }

  private async verifyScheduleOwnership(id: string, userId: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id },
      include: { channel: true },
    });
    if (!schedule) throw new NotFoundException('Programación no encontrada');
    if (schedule.channel.userId !== userId) throw new ForbiddenException('Sin acceso');
    return schedule;
  }

  async create(dto: CreateScheduleDto, userId: string) {
    await this.verifyChannelOwnership(dto.channelId, userId);

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (end <= start) throw new BadRequestException('La hora de fin debe ser posterior al inicio');

    return this.prisma.schedule.create({
      data: {
        channelId: dto.channelId,
        playlistId: dto.playlistId,
        name: dto.name,
        startTime: start,
        endTime: end,
        recurrence: dto.recurrence ?? 'ONCE',
        priority: dto.priority ?? 0,
      },
      include: { playlist: { select: { id: true, name: true } } },
    });
  }

  async findAll(channelId: string, userId: string, from?: string, to?: string) {
    await this.verifyChannelOwnership(channelId, userId);

    const where: any = { channelId };
    if (from || to) {
      where.startTime = {};
      if (from) where.startTime.gte = new Date(from);
      if (to) where.startTime.lte = new Date(to);
    }

    return this.prisma.schedule.findMany({
      where,
      include: { playlist: { select: { id: true, name: true } } },
      orderBy: { startTime: 'asc' },
    });
  }

  async findOne(id: string, userId: string) {
    await this.verifyScheduleOwnership(id, userId);
    return this.prisma.schedule.findUnique({
      where: { id },
      include: { playlist: { select: { id: true, name: true } } },
    });
  }

  async update(id: string, dto: UpdateScheduleDto, userId: string) {
    await this.verifyScheduleOwnership(id, userId);

    const data: any = { ...dto };
    if (dto.startTime) data.startTime = new Date(dto.startTime);
    if (dto.endTime) data.endTime = new Date(dto.endTime);

    return this.prisma.schedule.update({
      where: { id },
      data,
      include: { playlist: { select: { id: true, name: true } } },
    });
  }

  async remove(id: string, userId: string) {
    await this.verifyScheduleOwnership(id, userId);
    await this.prisma.schedule.delete({ where: { id } });
    return { success: true };
  }
}
