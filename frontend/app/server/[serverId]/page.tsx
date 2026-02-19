'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import type { ServerDetails } from '@/types';

export default function ServerEntryPage() {
  const { authRequest } = useAuth();
  const params = useParams<{ serverId: string }>();
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    if (!params.serverId) return;

    authRequest<ServerDetails>(`/servers/${params.serverId}`)
      .then((details) => {
        const firstChannel = details.channels[0];
        if (mounted && firstChannel) {
          router.replace(`/server/${params.serverId}/channel/${firstChannel.id}`);
        }
      })
      .catch(() => {
        router.replace('/app');
      });

    return () => {
      mounted = false;
    };
  }, [authRequest, params.serverId, router]);

  return <div className="p-8 text-sm text-slate-400">Loading server...</div>;
}
