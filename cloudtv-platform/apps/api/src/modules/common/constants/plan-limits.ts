export const PLAN_LIMITS: Record<string, { maxChannels: number }> = {
  FREE:       { maxChannels: 1 },
  STARTER:    { maxChannels: 3 },
  PRO:        { maxChannels: 10 },
  ENTERPRISE: { maxChannels: 9999 },
};
