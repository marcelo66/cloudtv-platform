import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
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

  /**
   * Guardar cookies.txt exportadas desde el navegador.
   * Body: { cookies: string }  — contenido completo del archivo cookies.txt (formato Netscape)
   */
  @Post('cookies')
  uploadCookies(
    @Body('cookies') cookies: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.youtubeAuthService.saveCookies(userId, cookies);
  }

  /** Desconectar cuenta y eliminar credenciales */
  @Delete()
  disconnect(@CurrentUser('id') userId: string) {
    return this.youtubeAuthService.disconnect(userId);
  }
}
