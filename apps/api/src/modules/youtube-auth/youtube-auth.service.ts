import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ─── Tipos ────────────────────────────────────────────────────

export interface DeviceFlowResult {
  sessionId: string;
  authUrl:   string;
  userCode:  string;
}

export interface AuthStatusResult {
  status:        'pending' | 'authorized' | 'error' | 'not_found';
  errorMessage?: string;
}

interface AuthSession {
  process:   ChildProcess;
  authUrl:   string | null;
  userCode:  string | null;
  status:    'pending' | 'authorized' | 'error';
  userId:    string;
  cacheDir:  string;
  pollTimer: ReturnType<typeof setInterval> | null;
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

    return new Promise<DeviceFlowResult>((resolve, reject) => {
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
      };
      this.sessions.set(sessionId, session);

      let resolved  = false;
      let outputBuf = '';

      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        outputBuf += text;
        this.logger.verbose(`[yt-dlp oauth] ${text.trim()}`);

        // Parseo flexible de distintos formatos que emite yt-dlp:
        // "open https://... and enter ... code: XXXX-XXXX"
        // "visit: https://www.google.com/device"
        // "authorization code: XXXX-XXXX"
        if (!session.authUrl) {
          const urlMatch =
            outputBuf.match(/(?:open|visit)[^\n]*(https?:\/\/www\.google\.com\/device[^\s\n]*)/i) ??
            outputBuf.match(/(https?:\/\/www\.google\.com\/device[^\s\n]*)/i) ??
            outputBuf.match(/(?:open|visit)[^\n]*(https?:\/\/accounts\.google\.com[^\s\n]*)/i);

          const codeMatch =
            outputBuf.match(/(?:enter|code)[:\s]+([A-Z0-9]{4}-[A-Z0-9]{4})/i) ??
            outputBuf.match(/\b([A-Z]{4}-[A-Z]{4})\b/);

          if (urlMatch && codeMatch && !resolved) {
            resolved         = true;
            session.authUrl  = urlMatch[1].trim();
            session.userCode = codeMatch[1].trim();
            this.logger.log(`[YoutubeAuth] Device flow iniciado | URL: ${session.authUrl} | Código: ${session.userCode}`);

            // Poll del sistema de archivos cada 2s para detectar cuando el token aparece
            session.pollTimer = setInterval(
              () => this.checkForToken(session, sessionId, userId),
              2_000,
            );

            resolve({ sessionId, authUrl: session.authUrl, userCode: session.userCode });
          }
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('close', async (code) => {
        this.logger.log(`[YoutubeAuth] yt-dlp cerró con código ${code}`);
        if (session.pollTimer) { clearInterval(session.pollTimer); session.pollTimer = null; }

        if (session.status === 'pending') {
          // Chequeo final del filesystem por si el token apareció justo al cierre
          await this.checkForToken(session, sessionId, userId, true);
        }

        if (session.status === 'pending') {
          session.status  = 'error';
          session.errorMsg = `yt-dlp terminó con código ${code}`;
          if (!resolved) {
            reject(new InternalServerErrorException('No se pudo iniciar el flujo de autorización de YouTube'));
          }
        }

        // Limpiar en 5 min para dar tiempo al frontend de consultar el estado final
        setTimeout(() => this.cleanupSession(sessionId), 5 * 60_000);
      });

      proc.on('error', (err) => {
        if (session.pollTimer) { clearInterval(session.pollTimer); session.pollTimer = null; }
        session.status  = 'error';
        session.errorMsg = err.message.includes('ENOENT')
          ? 'yt-dlp no está instalado en el servidor'
          : err.message;
        if (!resolved) reject(new InternalServerErrorException(session.errorMsg));
      });

      // Timeout: si en 45s no aparece el código, fallar
      setTimeout(() => {
        if (!resolved) {
          try { proc.kill('SIGTERM'); } catch {}
          this.cleanupSession(sessionId);
          reject(new InternalServerErrorException('Timeout al obtener código de autorización (45s)'));
        }
      }, 45_000);
    });
  }

  // ── Poll del filesystem por el token OAuth2 ───────────────────
  private async checkForToken(
    session:   AuthSession,
    sessionId: string,
    userId:    string,
    final      = false,
  ) {
    if (session.status !== 'pending') return;
    try {
      const oauth2Dir = path.join(session.cacheDir, 'youtube-oauth2');
      const entries   = await fs.readdir(oauth2Dir);
      const jsonFiles = entries.filter(f => f.endsWith('.json'));

      if (jsonFiles.length === 0) {
        if (final) { session.status = 'error'; session.errorMsg = 'No se generó token OAuth2'; }
        return;
      }

      // Leer todos los archivos .json del directorio oauth2
      const files: Record<string, string> = {};
      for (const fname of jsonFiles) {
        files[fname] = await fs.readFile(path.join(oauth2Dir, fname), 'utf8');
      }

      if (session.pollTimer) { clearInterval(session.pollTimer); session.pollTimer = null; }

      await this.saveTokenToDb(userId, files);
      session.status = 'authorized';
      this.logger.log(`[YoutubeAuth] ✅ Token guardado en DB para usuario ${userId}`);

      // Matar yt-dlp — ya tenemos el token, no necesitamos que descargue
      if (!session.process.killed) {
        try { session.process.kill('SIGTERM'); } catch {}
      }
    } catch {
      // Dir vacío o inexistente — normal durante el polling
      if (final && session.status === 'pending') {
        session.status  = 'error';
        session.errorMsg = 'No se encontró token tras completar la autorización';
      }
    }
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
  pollStatus(sessionId: string, userId: string): AuthStatusResult {
    const s = this.sessions.get(sessionId);
    if (!s || s.userId !== userId) return { status: 'not_found' };
    return { status: s.status, errorMessage: s.errorMsg };
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

    for (const [fname, content] of Object.entries(files)) {
      await fs.writeFile(path.join(oauth2Dir, fname), content, 'utf8');
    }
    return cacheDir;
  }

  // ── Persistir token renovado en DB tras usar yt-dlp ──────────
  // yt-dlp renueva el access_token automáticamente (usa refresh_token).
  // Leemos el archivo actualizado y guardamos en DB para el próximo uso.
  async persistRefreshedToken(userId: string): Promise<void> {
    const oauth2Dir = `/tmp/yt-dlp-cache-${userId}/youtube-oauth2`;
    try {
      const entries   = await fs.readdir(oauth2Dir);
      const jsonFiles = entries.filter(f => f.endsWith('.json'));
      if (!jsonFiles.length) return;
      const files: Record<string, string> = {};
      for (const f of jsonFiles) {
        files[f] = await fs.readFile(path.join(oauth2Dir, f), 'utf8');
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
    // Borrar tmp en background
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
