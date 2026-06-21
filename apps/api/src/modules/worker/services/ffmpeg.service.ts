import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Presets de calidad broadcast canónica — deben coincidir con VIDEO_QUALITY en playout.service.ts */
export const BROADCAST_QUALITIES = {
  '480p':  { scale: '854:480',   vBitrate: '1000k', maxrate: '1200k', bufsize: '2000k', aBitrate: '96k'  },
  '720p':  { scale: '1280:720',  vBitrate: '2500k', maxrate: '3000k', bufsize: '5000k', aBitrate: '128k' },
  '1080p': { scale: '1920:1080', vBitrate: '4500k', maxrate: '5400k', bufsize: '9000k', aBitrate: '192k' },
} as const;

export type BroadcastQuality = keyof typeof BROADCAST_QUALITIES;

@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly preset: string;
  private readonly threads: number;

  constructor(config: ConfigService) {
    this.preset = config.get('FFMPEG_PRESET', 'veryfast');
    this.threads = config.get<number>('FFMPEG_THREADS', 2);
  }

  // ─── Generar thumbnail ───────────────────────────────────────

  async generateThumbnail(
    inputPath: string,
    outputPath: string,
    atSeconds = 5,
  ): Promise<void> {
    // Si el video es muy corto, sacar thumbnail al 10% de su duración
    const seekTime = Math.max(0, atSeconds);

    const args = [
      '-ss', String(seekTime),
      '-i', inputPath,
      '-vframes', '1',
      '-q:v', '2',
      '-vf', 'scale=640:-2',   // Ancho 640px, alto proporcional y par
      '-y',                     // Sobreescribir si existe
      outputPath,
    ];

    await this.runProcess('ffmpeg', args, 'thumbnail');
    this.logger.log(`Thumbnail generado: ${path.basename(outputPath)}`);
  }

  // ─── Normalizar audio ─────────────────────────────────────────
  // Útil para unificar volumen entre distintos videos

  async normalizeAudio(inputPath: string, outputPath: string): Promise<void> {
    const args = [
      '-i', inputPath,
      '-af', 'loudnorm=I=-14:TP=-1:LRA=11',
      '-c:v', 'copy',           // Video sin recodificar
      '-c:a', 'aac',
      '-b:a', '128k',
      '-threads', String(this.threads),
      '-y',
      outputPath,
    ];

    await this.runProcess('ffmpeg', args, 'audio-normalize');
  }

  // ─── Transcodificar a H264/AAC ────────────────────────────────
  // Para videos que no son H264 (HEVC, VP9, etc.)

  async transcodeToH264(
    inputPath: string,
    outputPath: string,
    videoBitrate = '2500k',
    audioBitrate = '128k',
  ): Promise<void> {
    const args = [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', this.preset,
      '-crf', '23',
      '-b:v', videoBitrate,
      '-maxrate', this.scaleBitrate(videoBitrate, 1.5),
      '-bufsize', this.scaleBitrate(videoBitrate, 3),
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ar', '48000',
      '-ac', '2',
      '-threads', String(this.threads),
      '-movflags', '+faststart',   // Optimizar para streaming
      '-y',
      outputPath,
    ];

    await this.runProcess('ffmpeg', args, 'transcode');
  }

  // ─── Normalizar al formato broadcast canónico (Option B) ─────
  //
  // Produce un MP4 con:
  //   Video : H.264 High 4.0 · resolución del preset · 25 fps · yuv420p
  //           GOP fijo 50 frames (keyframe cada 2 s) · sc_threshold=0
  //   Audio : AAC 44100 Hz estéreo · bitrate del preset
  //   Tiempo: timestamps desde 0 (avoid_negative_ts make_zero) · moov al inicio (faststart)
  //
  // Se ejecuta en background durante el procesamiento del upload (BullMQ).
  // El resultado se almacena en S3 y el playout lo usa directamente (stream-copy),
  // eliminando toda normalización en tiempo de emisión y los stalls en transiciones.

  async normalizeToBroadcast(
    inputPath: string,
    outputPath: string,
    quality: BroadcastQuality,
    durationSecs?: number,
    onProgress?: (pct: number) => void,
  ): Promise<void> {
    const q = BROADCAST_QUALITIES[quality];
    const args = [
      '-y',
      '-i', inputPath,
      // ─── Video ────────────────────────────────────────────────
      '-vf', [
        `scale=${q.scale}:force_original_aspect_ratio=decrease`,
        `pad=${q.scale}:(ow-iw)/2:(oh-ih)/2:black`,
        'fps=25',
        'format=yuv420p',
      ].join(','),
      '-c:v',          'libx264',
      '-preset',       'ultrafast',  // Máxima velocidad: 4-5x más rápido que veryfast.
                                     // CRF 18 garantiza calidad visual independientemente del preset.
      '-crf',          '18',
      '-b:v',          q.vBitrate,
      '-maxrate',      q.maxrate,
      '-bufsize',      q.bufsize,
      '-g',            '50',
      '-keyint_min',   '50',
      '-sc_threshold', '0',
      '-profile:v',    'high',
      '-level:v',      '4.0',
      // ─── Audio ────────────────────────────────────────────────
      // aformat fuerza cualquier layout (mono, 5.1, 7.1, HE-AACv2…) a estéreo
      // antes del encoder; sin esto, fuentes con channel elements complejos
      // pueden producir AAC con headers inválidos pese al -ac 2.
      '-af', 'aformat=channel_layouts=stereo',
      '-c:a', 'aac',
      '-ar',  '44100',
      '-ac',  '2',
      '-b:a', q.aBitrate,
      // ─── Timestamps / container ───────────────────────────────
      '-avoid_negative_ts', 'make_zero',
      '-movflags',          '+faststart',
      '-threads',           String(this.threads),
      outputPath,
    ];

    await this.runProcess('ffmpeg', args, `norm-${quality}`, { durationSecs, onProgress });
    this.logger.log(`✓ Normalized to ${quality}: ${path.basename(outputPath)}`);
  }

  // ─── Verificar si el video necesita transcodificación ────────
  // Fuerza transcode si:
  //   · codec de video no es H264
  //   · codec de audio no es AAC
  //   · audio tiene más de 2 canales (ej: 5.1) — AAC 5.1 rompe el playout

  needsTranscode(codec: string, audioCodec: string, audioChannels = 2): boolean {
    const BROADCAST_COMPATIBLE_VIDEO = ['h264', 'avc1'];
    const BROADCAST_COMPATIBLE_AUDIO = ['aac', 'mp4a'];
    const isVideoOk = BROADCAST_COMPATIBLE_VIDEO.includes(codec.toLowerCase());
    const isAudioOk = BROADCAST_COMPATIBLE_AUDIO.includes(audioCodec.toLowerCase());
    const isStereoOrMono = audioChannels <= 2;
    return !isVideoOk || !isAudioOk || !isStereoOrMono;
  }

  // ─── Helper: correr proceso y loguear stderr ──────────────────

  private runProcess(
    command: string,
    args: string[],
    label: string,
    opts?: {
      durationSecs?: number;
      onProgress?: (pct: number) => void;
      timeoutMs?: number;
    },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`[${label}] ${command} ${args.join(' ')}`);

      const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stderrLines: string[] = [];

      // Timeout de seguridad — mata FFmpeg si se cuelga sin producir salida
      const timeoutMs = opts?.timeoutMs ?? 4 * 3600 * 1000; // 4h por defecto
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ya terminó */ }
        reject(new Error(`FFmpeg [${label}] timeout después de ${timeoutMs / 60000} min`));
      }, timeoutMs);

      proc.stderr.on('data', (d: Buffer) => {
        const line = d.toString().trim();
        if (line) stderrLines.push(line);

        if (line.includes('time=')) {
          this.logger.verbose(`[${label}] ${line}`);

          // Parsear progreso desde "time=HH:MM:SS.xx" para reportar avance real
          if (opts?.onProgress && opts?.durationSecs) {
            const m = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (m) {
              const elapsed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
              const pct = Math.min(99, (elapsed / opts.durationSecs) * 100);
              opts.onProgress(pct);
            }
          }
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          const detail = stderrLines.slice(-5).join(' | ');
          reject(new Error(`FFmpeg [${label}] exit ${code}: ${detail}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new Error(
            `FFmpeg not found: ${err.message}. Asegurate de que FFmpeg esté instalado.`,
          ),
        );
      });
    });
  }

  private scaleBitrate(bitrateStr: string, factor: number): string {
    const n = parseInt(bitrateStr.replace(/[^0-9]/g, ''));
    const unit = bitrateStr.replace(/[0-9]/g, '') || 'k';
    return `${Math.round(n * factor)}${unit}`;
  }
}
