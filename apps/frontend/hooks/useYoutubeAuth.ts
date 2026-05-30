import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────

export interface YoutubeAuthStatus {
  connected: boolean;
  email:     string | null;
  since:     string | null;
}

/** Respuesta inmediata de POST /start — sólo el sessionId */
export interface DeviceFlowStart {
  sessionId: string;
}

/** Alias para compatibilidad con imports existentes en page.tsx */
export type DeviceFlowSession = DeviceFlowStart;

export type DeviceFlowStatus = 'pending' | 'url_ready' | 'authorized' | 'error' | 'not_found';

/** Respuesta del polling — incluye authUrl+userCode cuando status=url_ready */
export interface DeviceFlowPoll {
  status:        DeviceFlowStatus;
  authUrl?:      string;
  userCode?:     string;
  errorMessage?: string;
}

// ─── Queries ──────────────────────────────────────────────────

/** Estado de conexión del usuario actual (refresca cada 30s) */
export function useYoutubeAuthStatus() {
  return useQuery<YoutubeAuthStatus>({
    queryKey: ['youtube-auth'],
    queryFn:  async () => {
      const { data } = await apiClient.get('/youtube-auth');
      return data;
    },
    refetchInterval: 30_000,
  });
}

/** Polling de estado de una sesión de autorización activa (cada 2s) */
export function useYoutubeDevicePoll(sessionId: string | null) {
  return useQuery<DeviceFlowPoll>({
    queryKey: ['youtube-auth-poll', sessionId],
    queryFn:  async () => {
      const { data } = await apiClient.get(`/youtube-auth/status/${sessionId}`);
      return data;
    },
    enabled:         !!sessionId,
    refetchInterval: 2_000,
  });
}

// ─── Mutations ────────────────────────────────────────────────

/** Iniciar el Device Authorization Flow — devuelve { sessionId } inmediatamente */
export function useYoutubeStartFlow() {
  return useMutation<DeviceFlowStart>({
    mutationFn: async () => {
      const { data } = await apiClient.post('/youtube-auth/start');
      return data;
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Error al iniciar autorización con YouTube';
      toast.error(msg);
    },
  });
}

/** Desconectar cuenta de YouTube */
export function useYoutubeDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete('/youtube-auth'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['youtube-auth'] });
      toast.success('Cuenta de YouTube desconectada');
    },
    onError: () => toast.error('Error al desconectar la cuenta'),
  });
}
