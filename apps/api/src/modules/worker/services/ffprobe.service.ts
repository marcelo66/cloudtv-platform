import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

export interface VideoMetadata {
  duration: number;        // segundos
  width: number;
  height: number;
  fps: number;
  codec: string;           // 'h264', 'hevc', etc.
  audioCodec: string;      // 'aac', 'mp3', etc.
  audioChannels: number;   // 1=mono, 2=stereo, 6=5.1, etc.
  bitrate: number;         // kbps
  hasAudio: boolean;
}

@Injectable()
export class FfprobeService {
  private readonly logger = new Logger(FfprobeService.name);

  async getMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        filePath,
      ];

      const proc = spawn('ffprobe', args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => (stdout += d.toString()));
      proc.stderr.on('data', (d) => (stderr += d.toString()));

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(
            new Error(`ffprobe exit ${code}: ${stderr.slice(0, 200)}`),
          );
        }

        try {
          const data = JSON.parse(stdout);
          resolve(this.parseMetadata(data));
        } catch (err) {
          reject(new Error(`ffprobe parse error: ${err.message}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`ffprobe not found: ${err.message}. Instalar FFmpeg.`));
      });
    });
  }

  private parseMetadata(data: any): VideoMetadata {
    const streams = data.streams ?? [];
    const format = data.format ?? {};

    const videoStream = streams.find((s: any) => s.codec_type === 'video');
    const audioStream = streams.find((s: any) => s.codec_type === 'audio');

    if (!videoStream) {
      throw new Error('No se encontró stream de video en el archivo');
    }

    // Calcular FPS desde avg_frame_rate (ej: "30/1" o "25/1")
    const fpsStr: string = videoStream.avg_frame_rate || videoStream.r_frame_rate || '0/1';
    const fpsParts = fpsStr.split('/');
    const fps =
      fpsParts.length === 2
        ? parseFloat(fpsParts[0]) / parseFloat(fpsParts[1])
        : parseFloat(fpsStr);

    // Duración: del format si está disponible, sino del stream
    const duration =
      parseFloat(format.duration) ||
      parseFloat(videoStream.duration) ||
      0;

    // Bitrate total en kbps
    const bitrate = format.bit_rate
      ? Math.round(parseInt(format.bit_rate) / 1000)
      : 0;

    return {
      duration: Math.round(duration * 100) / 100,
      width: videoStream.width ?? 0,
      height: videoStream.height ?? 0,
      fps: Math.round(fps * 100) / 100,
      codec: videoStream.codec_name ?? 'unknown',
      audioCodec: audioStream?.codec_name ?? 'none',
      audioChannels: audioStream?.channels ?? 0,
      bitrate,
      hasAudio: !!audioStream,
    };
  }
}
