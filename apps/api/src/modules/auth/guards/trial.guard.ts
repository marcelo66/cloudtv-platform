import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { isTrialExpired } from '../../common/constants/plan-limits';

@Injectable()
export class TrialGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user) return true;
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true;

    if (isTrialExpired(user.plan, user.createdAt)) {
      throw new ForbiddenException({
        message: 'Tu periodo de prueba ha expirado. Actualiza tu plan para continuar.',
        code: 'TRIAL_EXPIRED',
      });
    }
    return true;
  }
}
