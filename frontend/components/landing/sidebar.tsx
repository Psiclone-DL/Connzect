import { DragEvent, MouseEvent, useState } from 'react';
import type { ConnzectServer } from '@/types';
import { cn } from '@/lib/utils';
import { ServerCard } from './server-card';
import styles from './landing-page.module.css';

interface SidebarProps {
  servers: ConnzectServer[];
  activeServerId?: string | null;
  collapsed?: boolean;
  className?: string;
  onOpenServer: (serverId: string) => void;
  onJoinServer?: () => void;
  onServerPicked?: () => void;
  onServerContextMenu?: (event: MouseEvent<HTMLButtonElement>, server: ConnzectServer) => void;
  onReorderServers?: (orderedServerIds: string[]) => void;
}

export const Sidebar = ({
  servers,
  activeServerId,
  collapsed = false,
  className,
  onOpenServer,
  onJoinServer,
  onServerPicked,
  onServerContextMenu,
  onReorderServers
}: SidebarProps) => {
  const [draggedServerId, setDraggedServerId] = useState<string | null>(null);
  const [dragOverServer, setDragOverServer] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

  const handleOpen = (serverId: string) => {
    onOpenServer(serverId);
    onServerPicked?.();
  };

  const resolveDropPosition = (event: DragEvent<HTMLButtonElement>): 'before' | 'after' => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY <= bounds.top + bounds.height / 2 ? 'before' : 'after';
  };

  const canReorder = servers.length > 1 && Boolean(onReorderServers);

  return (
    <aside className={cn(styles.surface, 'flex h-full min-h-0 flex-col rounded-3xl border p-3', className)}>
      <div className={cn('mb-3 flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
        <p className={cn('text-xs uppercase tracking-[0.24em] text-slate-400', collapsed ? 'hidden' : 'block')}>Servers</p>
        <div className="flex items-center gap-2">
          {onJoinServer ? (
            <button
              type="button"
              onClick={onJoinServer}
              className={cn(
                styles.joinButton,
                'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-base leading-none text-emerald-100'
              )}
              title="Join or create server"
              aria-label="Join or create server"
            >
              +
            </button>
          ) : null}
          <span
            className={cn(
              'inline-flex min-w-6 items-center justify-center rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-200',
              collapsed ? 'hidden' : 'inline-flex'
            )}
            title={`${servers.length} servers`}
            aria-label={`Server count: ${servers.length}`}
          >
            {servers.length}
          </span>
          <div className={cn('h-2 w-2 rounded-full bg-emerald-300/70', collapsed ? 'hidden' : 'block')} />
        </div>
      </div>

      <div className={cn(styles.scrollArea, 'min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto pr-1')}>
        {servers.map((server) => (
          <div
            key={server.id}
            className={cn(
              'rounded-xl transition',
              dragOverServer?.id === server.id ? 'ring-1 ring-emerald-200/55 bg-emerald-300/10' : ''
            )}
          >
            <ServerCard
              server={server}
              collapsed={collapsed}
              isActive={activeServerId === server.id}
              onOpen={handleOpen}
              onContextMenu={onServerContextMenu}
              draggable={canReorder}
              isDragging={draggedServerId === server.id}
              dropIndicator={dragOverServer?.id === server.id ? dragOverServer.position : null}
              onDragStart={(event) => {
                if (!canReorder) return;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', server.id);
                setDraggedServerId(server.id);
                setDragOverServer(null);
              }}
              onDragEnd={() => {
                setDraggedServerId(null);
                setDragOverServer(null);
              }}
              onDragOver={(event) => {
                if (!canReorder || !draggedServerId) return;
                event.preventDefault();
                event.stopPropagation();
                setDragOverServer({
                  id: server.id,
                  position: resolveDropPosition(event)
                });
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget as Node | null;
                if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                setDragOverServer((previous) => (previous?.id === server.id ? null : previous));
              }}
              onDrop={(event) => {
                if (!canReorder || !draggedServerId || !onReorderServers) return;
                event.preventDefault();
                event.stopPropagation();
                const position =
                  dragOverServer?.id === server.id
                    ? dragOverServer.position
                    : resolveDropPosition(event);
                const nextIds = servers.map((entry) => entry.id).filter((id) => id !== draggedServerId);
                const targetIndex = nextIds.indexOf(server.id);
                if (targetIndex < 0) {
                  setDraggedServerId(null);
                  setDragOverServer(null);
                  return;
                }

                const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
                nextIds.splice(insertIndex, 0, draggedServerId);

                const currentIds = servers.map((entry) => entry.id);
                const changed = nextIds.some((id, index) => id !== currentIds[index]);
                if (changed) {
                  onReorderServers(nextIds);
                }

                setDraggedServerId(null);
                setDragOverServer(null);
              }}
            />
          </div>
        ))}

        {servers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/20 p-4 text-xs text-slate-400">
            No servers available yet.
          </div>
        ) : null}
      </div>
    </aside>
  );
};
