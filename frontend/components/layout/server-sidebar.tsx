'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ConnzectServer } from '@/types';
import { cn } from '@/lib/utils';
import { resolveAssetUrl } from '@/lib/assets';

interface ServerSidebarProps {
  servers: ConnzectServer[];
  activeServerId?: string;
}

export const ServerSidebar = ({ servers, activeServerId }: ServerSidebarProps) => {
  return (
    <aside className="glass soft-scroll h-[calc(100vh-2rem)] w-[5.5rem] min-w-[5.5rem] max-w-[5.5rem] overflow-x-hidden overflow-y-auto rounded-2xl p-2">
      <div className="flex flex-col items-center gap-2">
        {servers.map((server) => (
          <Link
            key={server.id}
            href={`/server/${server.id}`}
            title={server.name}
            className={cn(
              'group relative flex h-14 w-14 items-center justify-center rounded-2xl border border-transparent text-xs font-semibold uppercase tracking-wide transition hover:border-white/20 hover:bg-white/5',
              activeServerId === server.id ? 'border-burgundySoft/60 bg-burgundySoft/20' : 'bg-black/15'
            )}
          >
            <ServerSidebarIcon server={server} />
          </Link>
        ))}
      </div>
    </aside>
  );
};

const ServerSidebarIcon = ({ server }: { server: ConnzectServer }) => {
  const iconUrl = resolveAssetUrl(server.iconUrl);
  const [showIcon, setShowIcon] = useState(Boolean(iconUrl));

  useEffect(() => {
    setShowIcon(Boolean(iconUrl));
  }, [iconUrl]);

  if (showIcon && iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={iconUrl} alt={server.name} className="h-10 w-10 rounded-xl object-cover" onError={() => setShowIcon(false)} />
    );
  }

  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-burgundySoft/80 text-[11px] font-bold uppercase">
      {server.name.slice(0, 2)}
    </span>
  );
};
