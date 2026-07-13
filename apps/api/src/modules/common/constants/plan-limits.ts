export interface PlanLimit {
  displayName: string;
  maxChannels: number;
  maxStorageBytes: number;
  maxOutputs: number;
  maxUsers: number;
  trialDays?: number;
}

export const PLAN_LIMITS: Record<string, PlanLimit> = {
  FREE: {
    displayName: 'Free',
    maxChannels: 1,
    maxStorageBytes: 1 * 1024 * 1024 * 1024,
    maxOutputs: 1,
    maxUsers: 1,
    trialDays: 3,
  },
  STARTER: {
    displayName: 'Starter',
    maxChannels: 1,
    maxStorageBytes: 10 * 1024 * 1024 * 1024,
    maxOutputs: 1,
    maxUsers: 2,
  },
  PRO: {
    displayName: 'Pro',
    maxChannels: 3,
    maxStorageBytes: 20 * 1024 * 1024 * 1024,
    maxOutputs: 5,
    maxUsers: 10,
  },
  ENTERPRISE: {
    displayName: 'Cloud Plus',
    maxChannels: 10,
    maxStorageBytes: 50 * 1024 * 1024 * 1024,
    maxOutputs: 20,
    maxUsers: 30,
  },
};

export function getTrialExpiration(plan: string, createdAt: Date): Date | null {
  const limit = PLAN_LIMITS[plan];
  if (!limit?.trialDays) return null;
  const expiration = new Date(createdAt);
  expiration.setDate(expiration.getDate() + limit.trialDays);
  return expiration;
}

export function isTrialExpired(plan: string, createdAt: Date): boolean {
  const expiration = getTrialExpiration(plan, createdAt);
  if (!expiration) return false;
  return new Date() > expiration;
}
