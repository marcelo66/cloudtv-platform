import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

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

  // ─── Verificar si el video necesita transcodificación ────────

  needsTranscode(codec: string, audioCodec: string): boolean {
    const BROADCAST_COMPATIBLE_VIDEO = ['h264', 'avc1'];
    const BROADCAST_COMPATIBLE_AUDIO = ['aac', 'mp4a'];
    return (
      !BROADCAST_COMPATIBLE_VIDEO.includes(codec.toLowerCase()) ||
      !BROADCAST_COMPATIBLE_AUDIO.includes(audioCodec.toLowerCase())
    );
  }

  // ─── Helper: correr proceso y loguear stderr ──────────────────

  private runProcess(
    command: string,
    args: string[],
    label: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`[${label}] ${command} ${args.join(' ')}`);

      const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stderrLines: string[] = [];

      proc.stderr.on('data', (d: Buffer) => {
        const line = d.toString().trim();
        if (line) stderrLines.push(line);
        // Loguear progreso solo si tiene "time="
        if (line.includes('time=')) {
          this.logger.verbose(`[${label}] ${line}`);
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const detail = stderrLines.slice(-5).join(' | ');
          reject(new Error(`FFmpeg [${label}] exit ${code}: ${detail}`));
        }
      });

      proc.on('error', (err) => {
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
