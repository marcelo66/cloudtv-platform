import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';

export interface AdImpression {
  id: string;
  advertiser: string;
  type: string;
  duration: number | null;
  scheduledAt: string;
  adSpot: { name: string; advertiser: string };
  adBlock: { name: string };
}

export interface AdReportSummary {
  totalImpressions: number;
  byAdvertiser: { advertiser: string; impressions: number; totalDuration: number }[];
  byType: { type: string; impressions: number }[];
  byBlock: { adBlockId: string; name: string; impressions: number }[];
  recentImpressions: AdImpression[];
}

export interface AdImpressionsPage {
  items: AdImpression[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}

export function useAdReportSummary(
  channelId: string | null,
  from?: string,
  to?: string,
) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  return useQuery<AdReportSummary>({
    queryKey: ['ad-report-summary', channelId, from, to],
    queryFn: async () => {
      const { data } = await apiClient.get(
        `/channels/${channelId}/ad-reports${qs ? `?${qs}` : ''}`,
      );
      return data;
    },
    enabled: !!channelId,
  });
}

export function useAdImpressions(
  channelId: string | null,
  from?: string,
  to?: string,
  page = 1,
  limit = 100,
) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('page', String(page));
  params.set('limit', String(limit));

  return useQuery<AdImpressionsPage>({
    queryKey: ['ad-impressions', channelId, from, to, page],
    queryFn: async () => {
      const { data } = await apiClient.get(
        `/channels/${channelId}/ad-reports/impressions?${params.toString()}`,
      );
      return data;
    },
    enabled: !!channelId,
  });
}
