'use client';

import Link from 'next/link';
import { ConnzectServer } from '@/types';
import { cn } from '@/lib/utils';

interface ServerSidebarProps {
  servers: ConnzectServer[];
  activeServerId?: string;
}

export const ServerSidebar = ({ servers, activeServerId }: ServerSidebarProps) => {
  return (
    <aside className="glass soft-scroll h-[calc(100vh-2rem)] w-[5.5rem] overflow-y-auto rounded-2xl p-2">
      <div className="flex flex-col items-center gap-2">
        {servers.map((server) => (
          <Link
            key={server.id}
            href={`/server/${server.id}`}
            title={server.name}
            className={cn(
              'group relative flex h-14 w-14 items-center justify-center rounded-2xl border border-transparent text-xs font-semibold uppercase tracking-wide transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/5',
              activeServerId === server.id ? 'border-burgundySoft/60 bg-burgundySoft/20 shadow-glow' : 'bg-black/15'
            )}
          >
            {server.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={server.iconUrl} alt={server.name} className="h-10 w-10 rounded-xl object-cover" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-burgundySoft/80 text-[11px] font-bold">
                {server.name.slice(0, 2)}
              </span>
            )}

            <span className="pointer-events-none absolute left-[calc(100%+0.7rem)] top-1/2 z-20 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-lg border border-white/15 bg-mintBlackSoft px-2 py-1 text-xs normal-case text-slate-200 opacity-0 shadow-soft transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
              {server.name}
            </span>
          </Link>
        ))}
      </div>
    </aside>
  );
};
