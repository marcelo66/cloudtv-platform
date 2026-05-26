'use client';

import { useEffect, useRef, useState } from 'react';
import { Tv, Loader2, AlertTriangle } from 'lucide-react';

interface Props {
  src: string;
  /** true cuando el canal está LIVE_PLAYLIST / LIVE_RTMP → carga el stream */
  active?: boolean;
  /** true cuando el canal está STARTING → muestra spinner sin intentar cargar */
  starting?: boolean;
}

export function HlsPlayer({ src, active = true, starting = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [state, setState] = useState<'loading' | 'playing' | 'error' | 'offline' | 'starting'>('offline');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (starting && !active) {
      setState('starting');
      hlsRef.current?.destroy();
      return;
    }

    if (!active) {
      setState('offline');
      hlsRef.current?.destroy();
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    setState('loading');
    setErrorMsg('');

    let destroyed = false;

    const init = async () => {
      // Safari nativo soporta HLS
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        video.addEventListener('playing', () => !destroyed && setState('playing'), { once: true });
        video.addEventListener('error', () => {
          if (!destroyed) {
            setState('error');
            setErrorMsg('No se pudo reproducir el stream');
          }
        }, { once: true });
        video.play().catch(() => {});
        return;
      }

      // Chrome / Firefox → usar hls.js
      const HlsLib = (await import('hls.js')).default;

      if (!HlsLib.isSupported()) {
        setState('error');
        setErrorMsg('Tu navegador no soporta reproducción HLS');
        return;
      }

      const hls = new HlsLib({
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        // Reintentar la carga cada 3 segundos si hay error
        manifestLoadingRetryDelay: 3000,
        manifestLoadingMaxRetry: 20,
      });
      hlsRef.current = hls;

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
        if (!destroyed) {
          video.play().catch(() => {});
        }
      });

      hls.on(HlsLib.Events.MEDIA_ATTACHED, () => {
        if (!destroyed) setState('loading');
      });

      video.addEventListener('playing', () => {
        if (!destroyed) setState('playing');
      }, { once: true });

      hls.on(HlsLib.Events.ERROR, (_: any, data: any) => {
        if (destroyed) return;
        if (data.fatal) {
          setState('error');
          setErrorMsg(data.type === 'networkError'
            ? 'Error de red: verificá que el canal esté transmitiendo'
            : `Error de stream (${data.type})`);
          hls.destroy();
        }
      });
    };

    init().catch((err) => {
      if (!destroyed) {
        setState('error');
        setErrorMsg(err.message);
      }
    });

    return () => {
      destroyed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, active, starting]);

  return (
    <div className="relative w-full h-full bg-black">
      {/* Video element — siempre en el DOM para que hls.js lo use */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        controls={state === 'playing'}
        autoPlay
        muted
        playsInline
        style={{ display: state === 'playing' ? 'block' : 'none' }}
      />

      {/* Overlay states */}
      {state === 'offline' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-surface-600 flex items-center justify-center">
            <Tv className="w-7 h-7 text-slate-600" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-slate-400">Canal offline</p>
            <p className="text-xs text-slate-600 mt-0.5">
              Iniciá la emisión para ver la señal en vivo
            </p>
          </div>
        </div>
      )}

      {state === 'starting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-yellow-500 animate-spin" />
          <p className="text-sm text-slate-300">Iniciando canal...</p>
          <p className="text-xs text-slate-600">FFmpeg está codificando los primeros segmentos HLS</p>
          <p className="text-xs text-slate-600">Puede tardar entre 15 y 40 segundos</p>
        </div>
      )}

      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
          <p className="text-sm text-slate-400">Conectando al stream...</p>
          <p className="text-xs text-slate-600">FFmpeg está generando los primeros segmentos</p>
        </div>
      )}

      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-red-400">Error de reproducción</p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
