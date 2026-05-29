import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs/promises';

export interface ZTStatus {
  address: string;
  online: boolean;
  version: string;
  publicIdentity: string;
  tcpFallbackActive: boolean;
  clock: number;
}

export interface ZTNetwork {
  id: string;
  name: string;
  status: string;           // OK | REQUESTING_CONFIGURATION | ACCESS_DENIED | etc.
  type: string;             // PUBLIC | PRIVATE
  assignedAddresses: string[]; // IPs asignadas (ej: "10.147.17.1/24")
  mac: string;
  portDeviceName: string;
  allowManaged: boolean;
  allowGlobal: boolean;
  allowDefault: boolean;
}

export interface ZTPeer {
  address: string;          // Node ID de 10 hex (ej: "8056c2e21c")
  latency: number;          // ms, -1 si desconocida
  role: string;             // LEAF | PLANET | MOON
  version: string;
  paths: Array<{
    active: boolean;
    address: string;        // IP:puerto físico (ej: "203.0.113.5/9993")
    preferred: boolean;
    lastReceive: number;
    lastSend: number;
  }>;
}

@Injectable()
export class ZeroTierService {
  private readonly logger = new Logger(ZeroTierService.name);
  private readonly apiUrl: string;
  /** Token cacheado para no leer el archivo en cada request. */
  private tokenCache: string | null = null;

  /** Rutas comunes donde ZeroTier guarda el auth token en Linux/Mac. */
  private readonly TOKEN_PATHS = [
    '/var/lib/zerotier-one/authtoken.secret',
    '/Library/Application Support/ZeroTier/One/authtoken.secret',
    '/home/zerotier-one/authtoken.secret',
  ];

  constructor(private readonly config: ConfigService) {
    this.apiUrl = config.get<string>('ZEROTIER_API_URL', 'http://localhost:9993');
  }

  // ─── Token ────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    if (this.tokenCache) return this.tokenCache;

    // 1. Variable de entorno
    const envToken = this.config.get<string>('ZEROTIER_AUTH_TOKEN', '').trim();
    if (envToken) {
      this.tokenCache = envToken;
      return this.tokenCache;
    }

    // 2. Ruta personalizada via variable de entorno
    const customPath = this.config.get<string>('ZEROTIER_AUTH_FILE', '').trim();
    if (customPath) {
      try {
        this.tokenCache = (await fs.readFile(customPath, 'utf-8')).trim();
        return this.tokenCache;
      } catch {
        /* continuar */
      }
    }

    // 3. Paths conocidos
    for (const p of this.TOKEN_PATHS) {
      try {
        this.tokenCache = (await fs.readFile(p, 'utf-8')).trim();
        this.logger.log(`Token ZeroTier leído desde ${p}`);
        return this.tokenCache;
      } catch {
        /* probar siguiente */
      }
    }

    throw new Error(
      'Token ZeroTier no encontrado. ' +
      'Configurá la variable de entorno ZEROTIER_AUTH_TOKEN con el contenido de authtoken.secret, ' +
      'o ZEROTIER_AUTH_FILE con la ruta al archivo.',
    );
  }

  // ─── HTTP helper ──────────────────────────────────────────────

  private request<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      this.getToken()
        .then((token) => {
          const urlStr = `${this.apiUrl}${path}`;
          const parsedUrl = new URL(urlStr);
          const isHttps = parsedUrl.protocol === 'https:';
          const options: http.RequestOptions = {
            hostname: parsedUrl.hostname,
            port:     parseInt(parsedUrl.port || (isHttps ? '443' : '9993'), 10),
            path:     parsedUrl.pathname,
            method:   'GET',
            headers:  { 'X-ZT1-Auth': token },
            timeout:  5000,
          };

          const lib = isHttps ? https : http;
          const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`ZeroTier API HTTP ${res.statusCode} en ${path}`));
                return;
              }
              try {
                resolve(JSON.parse(data) as T);
              } catch {
                resolve(data as unknown as T);
              }
            });
          });

          req.on('error', (err) => reject(new Error(`ZeroTier no accesible: ${err.message}`)));
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout conectando con ZeroTier. Verificá que el daemon esté corriendo y que ZEROTIER_API_URL sea correcto.'));
          });
          req.end();
        })
        .catch(reject);
    });
  }

  // ─── API pública ──────────────────────────────────────────────

  /** Estado del nodo local (online, node ID, versión). */
  async getStatus(): Promise<ZTStatus> {
    return this.request<ZTStatus>('/status');
  }

  /** Redes a las que está unido este nodo con sus IPs asignadas. */
  async getNetworks(): Promise<ZTNetwork[]> {
    return this.request<ZTNetwork[]>('/network');
  }

  /** Peers conectados (nodos LEAF, PLANET, MOON conocidos). */
  async getPeers(): Promise<ZTPeer[]> {
    return this.request<ZTPeer[]>('/peer');
  }

  /**
   * Devuelve toda la información relevante en una sola llamada:
   * status + redes + peers LEAF activos.
   */
  async getSummary() {
    const [status, networks, peers] = await Promise.all([
      this.getStatus(),
      this.getNetworks(),
      this.getPeers().catch(() => [] as ZTPeer[]),
    ]);

    const leafPeers = peers.filter(
      (p) => p.role === 'LEAF' && p.paths.some((pa) => pa.active),
    );

    return { status, networks, peers: leafPeers };
  }
}
