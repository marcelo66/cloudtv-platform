import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs/promises';

// ─── Servicio ─────────────────────────────────────────────────

@Injectable()
export class YoutubeAuthService {
  private readonly logger = new Logger(YoutubeAuthService.name);

  constructor(private prisma: PrismaService) {}

  // ── Estado de conexión ─────────────────────────────────────────
  async getStatus(userId: string) {
    const cred = await this.prisma.youtubeCredential.findUnique({
      where:  { userId },
      select: { accountEmail: true, updatedAt: true },
    });
    return {
      connected: !!cred,
      email:     cred?.accountEmail ?? null,
      since:     cred?.updatedAt    ?? null,
    };
  }

  // ── Guardar cookies.txt en DB ──────────────────────────────────
  // El usuario exporta las cookies desde su navegador con una extensión
  // (ej: "Get cookies.txt LOCALLY") y las pega/sube aquí.
  async saveCookies(userId: string, cookiesContent: string): Promise<{ success: boolean }> {
    const content = (cookiesContent ?? '').trim();

    if (!content) {
      throw new BadRequestException('El archivo de cookies está vacío.');
    }
    if (!content.includes('youtube.com') && !content.includes('.youtube.com')) {
      throw new BadRequestException(
        'El archivo no contiene cookies de YouTube. Exportalas desde youtube.com.',
      );
    }

    await this.prisma.youtubeCredential.upsert({
      where:  { userId },
      create: { userId, tokenJson: content },
      update: { tokenJson: content, updatedAt: new Date() },
    });

    this.logger.log(`[YoutubeAuth] ✅ Cookies guardadas para usuario ${userId}`);
    return { success: true };
  }

  // ── Preparar archivo de cookies para yt-dlp ───────────────────
  // Escribe las cookies en /tmp y devuelve la ruta, o null si no hay credenciales.
  async prepareCredentials(userId: string): Promise<string | null> {
    const cred = await this.prisma.youtubeCredential.findUnique({ where: { userId } });
    if (!cred) return null;

    const cookiesPath = `/tmp/yt-dlp-cookies-${userId}.txt`;
    try {
      await fs.writeFile(cookiesPath, cred.tokenJson, 'utf8');
      return cookiesPath;
    } catch (err) {
      this.logger.warn(`[YoutubeAuth] No se pudo escribir cookies para ${userId}: ${err}`);
      return null;
    }
  }

  // ── Desconectar cuenta ────────────────────────────────────────
  async disconnect(userId: string) {
    await this.prisma.youtubeCredential.deleteMany({ where: { userId } });
    // Limpiar archivo temporal si existe
    try { await fs.unlink(`/tmp/yt-dlp-cookies-${userId}.txt`); } catch {}
    this.logger.log(`[YoutubeAuth] Cuenta desconectada para usuario ${userId}`);
    return { success: true, message: 'Cuenta de YouTube desconectada' };
  }
}
