import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────

export interface YoutubeAuthStatus {
  connected: boolean;
  email:     string | null;
  since:     string | null;
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

// ─── Mutations ────────────────────────────────────────────────

/**
 * Subir cookies.txt exportadas desde el navegador.
 * Recibe el contenido completo del archivo como string.
 */
export function useYoutubeUploadCookies() {
  const qc = useQueryClient();
  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (cookies: string) => {
      const { data } = await apiClient.post('/youtube-auth/cookies', { cookies });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['youtube-auth'] });
      toast.success('¡Cookies de YouTube guardadas! Las fuentes YouTube están autenticadas.');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Error al guardar las cookies';
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
