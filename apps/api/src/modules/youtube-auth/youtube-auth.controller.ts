import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { YoutubeAuthService } from './youtube-auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('youtube-auth')
@UseGuards(JwtAuthGuard)
export class YoutubeAuthController {
  constructor(private readonly youtubeAuthService: YoutubeAuthService) {}

  /** Estado de conexión del usuario actual */
  @Get()
  getStatus(@CurrentUser('id') userId: string) {
    return this.youtubeAuthService.getStatus(userId);
  }

  /** Iniciar Device Authorization Flow — devuelve { sessionId, authUrl, userCode } */
  @Post('start')
  startDeviceFlow(@CurrentUser('id') userId: string) {
    return this.youtubeAuthService.startDeviceFlow(userId);
  }

  /** Consultar estado de una sesión de auth en curso */
  @Get('status/:sessionId')
  pollStatus(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.youtubeAuthService.pollStatus(sessionId, userId);
  }

  /** Desconectar cuenta y eliminar credenciales */
  @Delete()
  disconnect(@CurrentUser('id') userId: string) {
    return this.youtubeAuthService.disconnect(userId);
  }
}
