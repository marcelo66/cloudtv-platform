'use client';

import { Radio, Play, Square, ExternalLink, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Channel {
  id: string;
  name: string;
  slug: string;
  status: string;
  streamKey: string;
  hlsUrl?: string;
}

interface ChannelStatusCardProps {
  channel: Channel;
  onStart?: () => void;
  onStop?: () => void;
}

const statusConfig = {
  OFFLINE: {
    label: 'Offline',
    dot: 'offline-dot',
    badge: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  },
  LIVE_PLAYLIST: {
    label: 'En vivo — Playlist',
    dot: 'live-dot',
    badge: 'bg-green-500/10 text-green-400 border-green-500/20',
  },
  LIVE_RTMP: {
    label: 'En vivo — RTMP',
    dot: 'live-dot',
    badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  STARTING: {
    label: 'Iniciando...',
    dot: 'live-dot',
    badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  },
  ERROR: {
    label: 'Error',
    dot: 'offline-dot',
    badge: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(`${label} copiado`);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function ChannelStatusCard({ channel, onStart, onStop }: ChannelStatusCardProps) {
  const status = statusConfig[channel.status as keyof typeof statusConfig] ?? statusConfig.OFFLINE;
  const isLive = channel.status === 'LIVE_PLAYLIST' || channel.status === 'LIVE_RTMP';
  const isStarting = channel.status === 'STARTING';

  const maskedKey = channel.streamKey
    ? channel.streamKey.slice(0, 8) + '••••••••••••'
    : '••••••••••••••••••••';

  return (
    <div className="glass-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center border',
              isLive
                ? 'bg-green-500/10 border-green-500/20'
                : 'bg-slate-500/10 border-slate-500/20',
            )}
          >
            <Radio
              className={cn('w-5 h-5', isLive ? 'text-green-400' : 'text-slate-500')}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{channel.name}</h3>
            <p className="text-xs text-slate-500">/{channel.slug}</p>
          </div>
        </div>

        {/* Status badge */}
        <div
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
            status.badge,
          )}
        >
          <span className={status.dot} />
          {status.label}
        </div>
      </div>

      {/* Stream info */}
      <div className="space-y-2 mb-5">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-700/50">
          <span className="text-xs text-slate-500 w-20 flex-shrink-0">RTMP URL</span>
          <span className="text-xs text-slate-300 font-mono flex-1 truncate">
            rtmp://tuservidor.com/live
          </span>
          <CopyButton text="rtmp://tuservidor.com/live" label="URL RTMP" />
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-700/50">
          <span className="text-xs text-slate-500 w-20 flex-shrink-0">Stream Key</span>
          <span className="text-xs text-slate-300 font-mono flex-1 truncate">
            {maskedKey}
          </span>
          <CopyButton text={channel.streamKey} label="Stream key" />
        </div>
        {channel.hlsUrl && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-700/50">
            <span className="text-xs text-slate-500 w-20 flex-shrink-0">HLS URL</span>
            <span className="text-xs text-slate-300 font-mono flex-1 truncate">
              {channel.hlsUrl}
            </span>
            <a
              href={channel.hlsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {!isLive && !isStarting ? (
          <button
            onClick={onStart}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium
                       bg-green-600 hover:bg-green-500 text-white transition-colors"
          >
            <Play className="w-4 h-4" />
            Iniciar canal
          </button>
        ) : (
          <button
            onClick={onStop}
            disabled={isStarting}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium
                       bg-red-600/80 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
          >
            <Square className="w-3.5 h-3.5" />
            {isStarting ? 'Iniciando...' : 'Detener canal'}
          </button>
        )}
      </div>
    </div>
  );
}
