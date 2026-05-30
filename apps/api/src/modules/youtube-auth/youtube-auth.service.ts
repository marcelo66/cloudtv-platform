import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ─── Tipos ────────────────────────────────────────────────────

/** Resultado inmediato de POST /start — el URL+código llegan via polling */
export interface DeviceFlowResult {
  sessionId: string;
}

/** Respuesta del endpoint de polling — incluye authUrl+userCode cuando están disponibles */
export interface AuthStatusResult {
  status:        'pending' | 'url_ready' | 'authorized' | 'error' | 'not_found';
  authUrl?:      string;
  userCode?:     string;
  errorMessage?: string;
}

interface AuthSession {
  process:   ChildProcess;
  authUrl:   string | null;
  userCode:  string | null;
  status:    'pending' | 'url_ready' | 'authorized' | 'error';
  userId:    string;
  cacheDir:  string;
  pollTimer: ReturnType<typeof setInterval> | null;
  outputBuf: string;   // ← output acumulado de yt-dlp para diagnóstico
  errorMsg?: string;
}

// ─── Servicio ─────────────────────────────────────────────────

@Injectable()
export class YoutubeAuthService {
  private readonly logger = new Logger(YoutubeAuthService.name);
  /** Sesiones de autorización activas: sessionId → estado */
  private sessions = new Map<string, AuthSession>();

  constructor(private prisma: PrismaService) {}

  // ── Estado de conexión ─────────────────────────────────────────
  async getStatus(userId: string) {
    const cred = await this.prisma.youtubeCredential.findUnique({
      where:  { userId },
      select: { accountEmail: true, updatedAt: true },
    });
    return {
      connected: !!cred,
      email:     cred?.accountEmail ?? null,
      since:     cred?.updatedAt    ?? null,
    };
  }

  // ── Iniciar Device Authorization Flow ─────────────────────────
  // Retorna { sessionId } INMEDIATAMENTE sin esperar el URL/código.
  // El frontend hace polling a /status/:sessionId hasta que status=url_ready
  // (URL+código disponibles para mostrar al usuario) o status=error.
  async startDeviceFlow(userId: string): Promise<DeviceFlowResult> {
    // Cerrar sesión previa del mismo usuario si existe
    for (const [sid, sess] of this.sessions) {
      if (sess.userId === userId) {
        this.logger.log(`[YoutubeAuth] Cerrando sesión previa ${sid} para usuario ${userId}`);
        this.cleanupSession(sid);
      }
    }

    const sessionId = randomUUID();
    const cacheDir  = `/tmp/yt-dlp-auth-${sessionId}`;
    await fs.mkdir(path.join(cacheDir, 'youtube-oauth2'), { recursive: true });

    // Usamos un video público clásico solo para disparar el flujo OAuth.
    // --skip-download evita descargar el video real.
    const proc = spawn('yt-dlp', [
      '--username', 'oauth',
      '--password', '',
      '--cache-dir', cacheDir,
      '--skip-download',
      '--no-playlist',
      // "Me at the zoo" — primer video de YouTube, siempre público
      'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const session: AuthSession = {
      process:   proc,
      authUrl:   null,
      userCode:  null,
      status:    'pending',
      userId,
      cacheDir,
      pollTimer: null,
      outputBuf: '',
    };
    this.sessions.set(sessionId, session);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      session.outputBuf += text;
      this.logger.verbose(`[yt-dlp oauth] ${text.trim()}`);

      // Parseo flexible de distintos formatos que emite yt-dlp:
      // "open https://... and enter ... code: XXXX-XXXX"
      // "visit: https://www.google.com/device"
      // "authorization code: XXXX-XXXX"
      if (!session.authUrl) {
        const buf = session.outputBuf;
        const urlMatch =
          buf.match(/(?:open|visit)[^\n]*(https?:\/\/www\.google\.com\/device[^\s\n]*)/i) ??
          buf.match(/(https?:\/\/www\.google\.com\/device[^\s\n]*)/i) ??
          buf.match(/(?:open|visit)[^\n]*(https?:\/\/accounts\.google\.com[^\s\n]*)/i);

        const codeMatch =
          buf.match(/(?:enter|code)[:\s]+([A-Z0-9]{4}-[A-Z0-9]{4})/i) ??
          buf.match(/\b([A-Z]{4}-[A-Z]{4})\b/);

        if (urlMatch && codeMatch) {
          session.authUrl  = urlMatch[1].trim();
          session.userCode = codeMatch[1].trim();
          session.status   = 'url_ready';
          this.logger.log(`[YoutubeAuth] Device flow iniciado | URL: ${session.authUrl} | Código: ${session.userCode}`);

          // Poll del sistema de archivos cada 2s para detectar cuando el token aparece
          session.pollTimer = setInterval(
            () => this.checkForToken(session, sessionId, userId),
            2_000,
          );
        }
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('close', async (code) => {
      const tail = session.outputBuf.slice(-500);
      this.logger.log(`[YoutubeAuth] yt-dlp cerró con código ${code} | tail: ${tail}`);
      if (session.pollTimer) { clearInterval(session.pollTimer); session.pollTimer = null; }

      // Chequeo final del filesystem — captura el token si yt-dlp lo guardó
      // justo antes de salir (o si el timer aún no había detectado el archivo).
      if (session.status === 'url_ready' || session.status === 'pending') {
        await this.checkForToken(session, sessionId, userId, true);
      }

      // Si sigue sin token después del chequeo final → error con detalle del output
      if (session.status === 'url_ready' || session.status === 'pending') {
        session.status = 'error';
        const hint = session.outputBuf.slice(-400).trim().replace(/\n+/g, ' | ');
        session.errorMsg = hint
          ? `yt-dlp salió (código ${code}) sin guardar token: ${hint}`
          : `yt-dlp salió (código ${code}) sin generar token OAuth2. ¿El plugin oauth2 está instalado?`;
      }

      // Limpiar en 5 min para dar tiempo al frontend de consultar el estado final
      setTimeout(() => this.cleanupSession(sessionId), 5 * 60_000);
    });

    proc.on('error', (err) => {
      if (session.pollTimer) { clearInterval(session.pollTimer); session.pollTimer = null; }
      session.status   = 'error';
      session.errorMsg = err.message.includes('ENOENT')
        ? 'yt-dlp no está instalado en el servidor'
        : err.message;
    });

    // Timeout: si en 120s el usuario no autorizó, marcar error
    setTimeout(() => {
      if (session.status === 'pending' || session.status === 'url_ready') {
        session.status   = 'error';
        session.errorMsg = 'Timeout (120s): el usuario no autorizó a tiempo o yt-dlp no respondió.';
        try { proc.kill('SIGTERM'); } catch {}
      }
    }, 120_000);

    // Retornar sessionId INMEDIATAMENTE — el URL/código llegan via polling
    return { sessionId };
  }

  // ── Poll del filesystem por el token OAuth2 ───────────────────
  // IMPORTANTE: se llama tanto con status='pending' como 'url_ready'.
  // El guard solo salta si ya se autorizó o hay un error definitivo.
  private async checkForToken(
    session:   AuthSession,
    sessionId: string,
    userId:    string,
    final      = false,
  ) {
    // Solo procesamos si todavía estamos esperando el token
    if (session.status === 'authorized' || session.status === 'error') return;

    try {
      // Escanear el cacheDir completo recursivamente buscando cualquier .json
      // (por si yt-dlp guarda el token en un subdirectorio distinto al esperado)
      const jsonFiles = await this.findJsonFilesRecursive(session.cacheDir);

      if (jsonFiles.length === 0) {
        if (final) {
          const hint = session.outputBuf.slice(-400).trim().replace(/\n+/g, ' | ');
          session.status   = 'error';
          session.errorMsg = hint
            ? `No se generó token OAuth2. yt-dlp dijo: ${hint}`
            : 'No se generó token OAuth2. Verificá que el plugin yt-dlp-oauth2 esté instalado.';
        }
        return;
      }

      // Leer todos los .json encontrados y guardar en DB
      const files: Record<string, string> = {};
      for (const fpath of jsonFiles) {
        const fname = path.relative(session.cacheDir, fpath);
        files[fname] = await fs.readFile(fpath, 'utf8');
        this.logger.log(`[YoutubeAuth] Token encontrado: ${fname}`);
      }

      if (session.pollTimer) { clearInterval(session.pollTimer); session.pollTimer = null; }

      await this.saveTokenToDb(userId, files);
      session.status = 'authorized';
      this.logger.log(`[YoutubeAuth] ✅ Token guardado en DB para usuario ${userId}`);

      // Matar yt-dlp — ya tenemos el token
      if (!session.process.killed) {
        try { session.process.kill('SIGTERM'); } catch {}
      }
    } catch (err) {
      // Directorio vacío o inexistente — normal durante el polling (no final)
      this.logger.verbose(`[YoutubeAuth] checkForToken catch: ${err}`);
      if (final) {
        const hint = session.outputBuf.slice(-400).trim().replace(/\n+/g, ' | ');
        session.status   = 'error';
        session.errorMsg = hint
          ? `Error al leer token OAuth2. yt-dlp dijo: ${hint}`
          : 'No se encontró token tras completar la autorización.';
      }
    }
  }

  // ── Buscar archivos .json recursivamente dentro de un directorio ──
  private async findJsonFilesRecursive(dir: string): Promise<string[]> {
    const result: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const nested = await this.findJsonFilesRecursive(fullPath);
          result.push(...nested);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          result.push(fullPath);
        }
      }
    } catch {
      // Directorio no existe aún — normal
    }
    return result;
  }

  // ── Guardar token en DB ────────────────────────────────────────
  private async saveTokenToDb(userId: string, files: Record<string, string>) {
    await this.prisma.youtubeCredential.upsert({
      where:  { userId },
      create: { userId, tokenJson: JSON.stringify(files) },
      update: { tokenJson: JSON.stringify(files), updatedAt: new Date() },
    });
  }

  // ── Consulta de estado de sesión (polling del frontend) ───────
  // Devuelve authUrl+userCode cuando status=url_ready para que el
  // frontend muestre el código sin haber esperado en el POST /start.
  pollStatus(sessionId: string, userId: string): AuthStatusResult {
    const s = this.sessions.get(sessionId);
    if (!s || s.userId !== userId) return { status: 'not_found' };
    return {
      status:       s.status,
      authUrl:      s.authUrl   ?? undefined,
      userCode:     s.userCode  ?? undefined,
      errorMessage: s.errorMsg,
    };
  }

  // ── Preparar cache dir con las credenciales para yt-dlp ───────
  // Devuelve la ruta al cache dir, o null si no hay credenciales.
  async prepareCredentials(userId: string): Promise<string | null> {
    const cred = await this.prisma.youtubeCredential.findUnique({ where: { userId } });
    if (!cred) return null;

    const cacheDir  = `/tmp/yt-dlp-cache-${userId}`;
    const oauth2Dir = path.join(cacheDir, 'youtube-oauth2');
    await fs.mkdir(oauth2Dir, { recursive: true });

    let files: Record<string, string>;
    try {
      files = JSON.parse(cred.tokenJson);
    } catch {
      this.logger.warn(`[YoutubeAuth] Token JSON inválido para usuario ${userId}`);
      return null;
    }

    // Los archivos pueden estar guardados con path relativo (ej: "youtube-oauth2/token.json")
    // o solo nombre (ej: "token.json"). Normalizar para garantizar que caigan en oauth2Dir.
    for (const [fname, content] of Object.entries(files)) {
      const targetPath = fname.includes('/')
        ? path.join(cacheDir, fname)
        : path.join(oauth2Dir, fname);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf8');
    }
    return cacheDir;
  }

  // ── Persistir token renovado en DB tras usar yt-dlp ──────────
  async persistRefreshedToken(userId: string): Promise<void> {
    const cacheDir = `/tmp/yt-dlp-cache-${userId}`;
    try {
      const jsonFiles = await this.findJsonFilesRecursive(cacheDir);
      if (!jsonFiles.length) return;
      const files: Record<string, string> = {};
      for (const fpath of jsonFiles) {
        const fname = path.relative(cacheDir, fpath);
        files[fname] = await fs.readFile(fpath, 'utf8');
      }
      await this.prisma.youtubeCredential.update({
        where: { userId },
        data:  { tokenJson: JSON.stringify(files) },
      });
    } catch {
      // El token no fue renovado o el directorio no existe — ignorar
    }
  }

  // ── Limpiar sesión de auth ────────────────────────────────────
  private cleanupSession(sessionId: string) {
    const sess = this.sessions.get(sessionId);
    if (!sess) return;
    if (sess.pollTimer) clearInterval(sess.pollTimer);
    if (!sess.process.killed) try { sess.process.kill('SIGTERM'); } catch {}
    fs.rm(sess.cacheDir, { recursive: true, force: true }).catch(() => {});
    this.sessions.delete(sessionId);
  }

  // ── Desconectar cuenta ────────────────────────────────────────
  async disconnect(userId: string) {
    await this.prisma.youtubeCredential.deleteMany({ where: { userId } });
    for (const [sid, sess] of this.sessions) {
      if (sess.userId === userId) this.cleanupSession(sid);
    }
    this.logger.log(`[YoutubeAuth] Cuenta desconectada para usuario ${userId}`);
    return { success: true, message: 'Cuenta de YouTube desconectada' };
  }
}
