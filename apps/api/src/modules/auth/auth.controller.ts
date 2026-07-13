import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { getTrialExpiration, isTrialExpired, PLAN_LIMITS } from '../common/constants/plan-limits';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Crear nueva cuenta' })
  @ApiResponse({ status: 201, description: 'Cuenta creada correctamente' })
  @ApiResponse({ status: 409, description: 'Email ya registrado' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión' })
  @ApiResponse({ status: 200, description: 'Login exitoso' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiOperation({ summary: 'Renovar access token' })
  refresh(@Request() req: any, @Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(req.user.sub, dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar sesión' })
  logout(@CurrentUser() user: any, @Body() body: { refreshToken?: string }) {
    return this.authService.logout(user.id, body.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener usuario autenticado' })
  async me(@CurrentUser() user: any) {
    const { passwordHash, ...safe } = user;
    const trialExpiresAt = getTrialExpiration(user.plan, user.createdAt);
    const planLimit = PLAN_LIMITS[user.plan];

    const result = await this.prisma.video.aggregate({
      where: { channel: { userId: user.id } },
      _sum: { fileSize: true },
    });
    const storageUsed = Number(result._sum.fileSize ?? 0);

    return {
      ...safe,
      ...(trialExpiresAt && {
        trialExpiresAt,
        trialExpired: isTrialExpired(user.plan, user.createdAt),
      }),
      storageUsed,
      storageLimit: planLimit?.maxStorageBytes ?? 0,
      planLimits: planLimit ?? null,
    };
  }
}
