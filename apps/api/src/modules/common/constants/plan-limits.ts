export const PLAN_LIMITS: Record<string, { maxChannels: number; trialDays?: number }> = {
  FREE:       { maxChannels: 1, trialDays: 3 },
  STARTER:    { maxChannels: 3 },
  PRO:        { maxChannels: 10 },
  ENTERPRISE: { maxChannels: 9999 },
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
