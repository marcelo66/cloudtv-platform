import apiClient from './api-client';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB por chunk (mínimo de S3 multipart)

export type UploadStatus =
  | 'idle'
  | 'initiating'
  | 'uploading'
  | 'completing'
  | 'done'
  | 'error'
  | 'aborted';

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  currentPart: number;
  totalParts: number;
}

export interface UploadResult {
  videoId: string;
}

export interface UploadCallbacks {
  onProgress?: (progress: UploadProgress) => void;
  onStatusChange?: (status: UploadStatus) => void;
  signal?: AbortSignal;
}

const ACCEPTED_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/x-msvideo',
  'video/webm',
  'video/avi',
];

export function validateVideoFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return `Formato no soportado: ${file.type}. Usar MP4, MOV, MKV, AVI o WebM.`;
  }
  const GB = 1024 ** 3;
  if (file.size > 10 * GB) {
    return 'El archivo supera el límite de 10 GB.';
  }
  if (file.size < 1024) {
    return 'El archivo parece estar vacío.';
  }
  return null;
}

export async function uploadVideo(
  file: File,
  channelId: string,
  callbacks: UploadCallbacks = {},
  folder?: string,
): Promise<UploadResult> {
  const { onProgress, onStatusChange, signal } = callbacks;

  const emit = (status: UploadStatus) => onStatusChange?.(status);

  // ─── 1. Iniciar upload ─────────────────────────────────────
  emit('initiating');

  const initiateRes = await apiClient.post('/videos/upload/initiate', {
    filename: file.name,
    fileSize: file.size,
    mimeType: file.type || 'video/mp4',
    channelId,
    ...(folder ? { folder } : {}),
  });

  const { videoId } = initiateRes.data as { videoId: string };

  // ─── 2. Subir chunks ───────────────────────────────────────
  emit('uploading');

  const totalParts = Math.ceil(file.size / CHUNK_SIZE);
  const parts: { partNumber: number; etag: string }[] = [];
  let totalUploaded = 0;

  for (let i = 0; i < totalParts; i++) {
    if (signal?.aborted) {
      await abortUpload(videoId);
      emit('aborted');
      throw new DOMException('Upload abortado por el usuario', 'AbortError');
    }

    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append('chunk', chunk, file.name);
    formData.append('videoId', videoId);
    formData.append('partNumber', String(i + 1));

    const partRes = await apiClient.post('/videos/upload/part', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
      onUploadProgress: (e) => {
        const partLoaded = e.loaded ?? 0;
        onProgress?.({
          loaded: totalUploaded + partLoaded,
          total: file.size,
          percent: Math.round(((totalUploaded + partLoaded) / file.size) * 100),
          currentPart: i + 1,
          totalParts,
        });
      },
    });

    parts.push({
      partNumber: i + 1,
      etag: partRes.data.etag,
    });

    totalUploaded += end - start;

    onProgress?.({
      loaded: totalUploaded,
      total: file.size,
      percent: Math.round((totalUploaded / file.size) * 100),
      currentPart: i + 1,
      totalParts,
    });
  }

  // ─── 3. Completar upload ───────────────────────────────────
  emit('completing');

  await apiClient.post('/videos/upload/complete', { videoId, parts });

  emit('done');
  return { videoId };
}

async function abortUpload(videoId: string) {
  try {
    await apiClient.post('/videos/upload/abort', { videoId });
  } catch {
    // No crítico
  }
}
