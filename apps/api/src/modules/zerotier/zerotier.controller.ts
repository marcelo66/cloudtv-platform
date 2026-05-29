import {
  Controller,
  Get,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ZeroTierService } from './zerotier.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Endpoints para consultar el agente ZeroTier local.
 * Todos requieren autenticación JWT.
 *
 * Requiere configurar en el servidor:
 *   ZEROTIER_AUTH_TOKEN=<token>   (contenido de authtoken.secret)
 *   ZEROTIER_API_URL=http://localhost:9993  (default)
 *
 * En Docker, si ZeroTier corre en el HOST añadir a docker-compose:
 *   extra_hosts: ["host.docker.internal:host-gateway"]
 *   y setear ZEROTIER_API_URL=http://host.docker.internal:9993
 */
@Controller('zerotier')
@UseGuards(JwtAuthGuard)
export class ZeroTierController {
  constructor(private readonly ztService: ZeroTierService) {}

  /** Estado del nodo (online, node ID, versión). */
  @Get('status')
  async status() {
    return this.safeCall(() => this.ztService.getStatus());
  }

  /** Redes a las que está unido este nodo. */
  @Get('networks')
  async networks() {
    return this.safeCall(() => this.ztService.getNetworks());
  }

  /** Peers conectados (filtrado: solo LEAF activos). */
  @Get('peers')
  async peers() {
    const peers = await this.safeCall(() => this.ztService.getPeers());
    return (peers as any[]).filter(
      (p) => p.role === 'LEAF' && p.paths?.some?.((pa: any) => pa.active),
    );
  }

  /** Resumen completo: status + networks + peers LEAF en una sola llamada. */
  @Get('summary')
  async summary() {
    return this.safeCall(() => this.ztService.getSummary());
  }

  // ─── Helper ───────────────────────────────────────────────────

  private async safeCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      throw new HttpException(
        { error: 'ZeroTierError', message: err.message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
