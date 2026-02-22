import { DragEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import type { ConnzectServer } from '@/types';
import { cn } from '@/lib/utils';
import { resolveAssetUrl } from '@/lib/assets';
import styles from './landing-page.module.css';

interface ServerCardProps {
  server: ConnzectServer;
  collapsed?: boolean;
  isActive?: boolean;
  onOpen: (serverId: string) => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>, server: ConnzectServer) => void;
  draggable?: boolean;
  isDragging?: boolean;
  dropIndicator?: 'before' | 'after' | null;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
}

const getInitials = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return 'SV';

  const initials = trimmed
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return initials || trimmed.slice(0, 2).toUpperCase();
};

export const ServerCard = ({
  server,
  collapsed = false,
  isActive = false,
  onOpen,
  onContextMenu,
  draggable = false,
  isDragging = false,
  dropIndicator = null,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop
}: ServerCardProps) => {
  const initials = getInitials(server.name);
  const iconUrl = resolveAssetUrl(server.iconUrl);
  const [showIcon, setShowIcon] = useState(Boolean(iconUrl));
  const [isClickAnimating, setIsClickAnimating] = useState(false);
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setShowIcon(Boolean(iconUrl));
  }, [iconUrl]);

  useEffect(
    () => () => {
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
      }
    },
    []
  );

  const handleOpen = () => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
    }

    setIsClickAnimating(true);
    clickTimerRef.current = window.setTimeout(() => {
      setIsClickAnimating(false);
      clickTimerRef.current = null;
    }, 280);

    onOpen(server.id);
  };

  return (
    <button
      type="button"
      title={server.name}
      onClick={handleOpen}
      onContextMenu={(event) => onContextMenu?.(event, server)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        styles.surface,
        styles.cardLift,
        isActive ? styles.serverActive : '',
        isClickAnimating ? styles.serverClickPulse : '',
        draggable ? 'cursor-grab active:cursor-grabbing' : '',
        isDragging ? 'opacity-65' : '',
        dropIndicator ? 'border-emerald-200/70 bg-emerald-300/20' : '',
        dropIndicator === 'before' ? 'border-t-4 border-t-emerald-200' : '',
        dropIndicator === 'after' ? 'border-b-4 border-b-emerald-200' : '',
        'group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition',
        collapsed ? 'justify-center px-2' : ''
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100/20 bg-emerald-300/10 text-xs font-semibold tracking-[0.14em] text-emerald-100">
        {showIcon && iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={iconUrl}
            alt={server.name}
            className="h-10 w-10 rounded-xl object-cover"
            onError={() => setShowIcon(false)}
          />
        ) : (
          initials
        )}
      </div>
      <div className={cn('min-w-0', collapsed ? 'hidden' : 'block')}>
        <p className="truncate text-sm font-medium text-slate-100">{server.name}</p>
      </div>
    </button>
  );
};
