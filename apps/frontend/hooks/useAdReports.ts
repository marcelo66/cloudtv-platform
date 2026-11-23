import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

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

// ─── Diagnóstico de publicidad ───────────────────────────────

export interface AdSpotDiag {
  id: string;
  name: string;
  advertiser: string;
  isActive: boolean;
  weight: number;
  video: {
    id: string;
    title: string;
    status: string;
    processedKey: string | null;
    originalKey: string | null;
    duration: number | null;
  };
}

export interface AdBlockDiag {
  id: string;
  name: string;
  isActive: boolean;
  rotationMode: string;
  spots: AdSpotDiag[];
  activeSpots: number;
  readySpots: number;
  issues: string[];
  _count: { cuePoints: number; impressions: number };
}

export interface AdBuildEntry {
  at: string;
  details: {
    blocks: number;
    totalSpots: number;
    downloaded: number;
    skipped: string[];
    spotsIncluded: string[];
  };
}

export interface AdDiagnostics {
  channelActive: boolean;
  adWatcherActive: boolean;
  lastBuild: { at: string; details: AdBuildEntry['details'] } | null;
  recentBuilds: AdBuildEntry[];
  blocks: AdBlockDiag[];
}

export function useAdDiagnostics(channelId: string | null) {
  return useQuery<AdDiagnostics>({
    queryKey: ['ad-diagnostics', channelId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/playout/${channelId}/ad-diagnostics`);
      return data;
    },
    enabled: !!channelId,
    refetchInterval: 30_000,
  });
}

export function useRefreshAds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      apiClient.post(`/playout/${channelId}/refresh-ads`),
    onSuccess: (_, channelId) => {
      toast.success('Reconstrucción de publicidad iniciada');
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['ad-diagnostics', channelId] });
        qc.invalidateQueries({ queryKey: ['ad-report-summary', channelId] });
      }, 5000);
    },
    onError: () => toast.error('Error al forzar reconstrucción'),
  });
}
