import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────

export interface ZTStatus {
  address: string;
  online: boolean;
  version: string;
  publicIdentity: string;
  tcpFallbackActive: boolean;
}

export interface ZTNetwork {
  id: string;
  name: string;
  status: string;
  type: string;
  assignedAddresses: string[];
  mac: string;
  portDeviceName: string;
}

export interface ZTPeer {
  address: string;
  latency: number;
  role: string;
  version: string;
  paths: Array<{
    active: boolean;
    address: string;
    preferred: boolean;
  }>;
}

export interface ZTSummary {
  status: ZTStatus;
  networks: ZTNetwork[];
  peers: ZTPeer[];
}

export interface ZTError {
  error: string;
  message: string;
}

// ─── Helpers ──────────────────────────────────────────────────

/** Extrae sólo la IP (sin el prefijo /24) de una assigned address */
export function ztIpOnly(addr: string): string {
  return addr.split('/')[0];
}

// ─── Hooks ────────────────────────────────────────────────────

/**
 * Consulta el resumen ZeroTier: status + redes + peers LEAF.
 * Hace polling cada 30 s para reflejar cambios en redes/peers.
 * Si ZeroTier no está configurado la query devolverá un error manejable.
 */
export function useZeroTierSummary(enabled = true) {
  return useQuery<ZTSummary, ZTError>({
    queryKey: ['zerotier', 'summary'],
    queryFn: async () => {
      const { data } = await apiClient.get('/zerotier/summary');
      return data as ZTSummary;
    },
    enabled,
    retry: false,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
