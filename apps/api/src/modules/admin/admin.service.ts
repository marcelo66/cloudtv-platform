import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminUserDto, UpdateAdminUserDto } from './dto/admin-user.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async listUsers(search?: string) {
    return this.prisma.user.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        isActive: true,
        maxChannels: true,
        createdAt: true,
        _count: { select: { channels: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        isActive: true,
        maxChannels: true,
        createdAt: true,
        updatedAt: true,
        channels: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            createdAt: true,
            _count: { select: { videos: true, playlists: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { channels: true } },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async createUser(dto: CreateAdminUserDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (exists) throw new ConflictException('El email ya está registrado');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        name: dto.name.trim(),
        passwordHash,
        plan: dto.plan ?? 'FREE',
        maxChannels: dto.maxChannels ?? null,
      },
    });

    this.logger.log(`Admin created user: ${user.email}`);
    const { passwordHash: _pw, ...safe } = user;
    return safe;
  }

  async updateUser(id: string, dto: UpdateAdminUserDto) {
    await this.getUser(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.plan !== undefined && { plan: dto.plan }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...('maxChannels' in dto && { maxChannels: dto.maxChannels }),
      },
    });
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async deleteUser(id: string) {
    await this.getUser(id);
    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }

  async impersonate(adminUser: any, targetUserId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!target || !target.isActive) {
      throw new NotFoundException('Usuario no encontrado o inactivo');
    }

    if (target.role !== Role.USER && adminUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('No se puede impersonar a un administrador');
    }

    const payload = { sub: target.id, email: target.email, role: target.role };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: '2h',
    });

    const { passwordHash, ...safeTarget } = target;
    return { accessToken, user: safeTarget };
  }

  async getStats() {
    const [totalUsers, activeUsers, totalChannels, liveChannels, totalVideos] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.channel.count(),
        this.prisma.channel.count({
          where: { status: { in: ['LIVE_PLAYLIST', 'LIVE_RTMP'] } },
        }),
        this.prisma.video.count({ where: { status: 'READY' } }),
      ]);

    return { totalUsers, activeUsers, totalChannels, liveChannels, totalVideos };
  }
}
