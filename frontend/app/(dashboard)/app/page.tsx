'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/layout/auth-guard';
import { CreateServerForm } from '@/components/forms/create-server-form';
import { ServerSidebar } from '@/components/layout/server-sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { useAuth } from '@/lib/auth-context';
import type { ConnzectServer, DirectConversation, ServerDetails } from '@/types';

export default function AppDashboardPage() {
  const router = useRouter();
  const { user, logout, authRequest } = useAuth();
  const [servers, setServers] = useState<ConnzectServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [dmEmail, setDmEmail] = useState('');

  useEffect(() => {
    authRequest<ConnzectServer[]>('/servers')
      .then(setServers)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed to load servers'));
  }, [authRequest]);

  const openServer = async (serverId: string) => {
    try {
      const server = await authRequest<ServerDetails>(`/servers/${serverId}`);
      const firstChannel = server.channels[0];
      if (!firstChannel) return;
      router.push(`/server/${serverId}/channel/${firstChannel.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to open server');
    }
  };

  const joinInvite = async (event: FormEvent) => {
    event.preventDefault();
    const code = inviteCode.trim();
    if (!code) return;

    try {
      const joined = await authRequest<{ server: { id: string } }>(`/invites/${code}/join`, {
        method: 'POST'
      });

      setInviteCode('');
      await openServer(joined.server.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to join invite');
    }
  };

  const startDm = async (event: FormEvent) => {
    event.preventDefault();
    if (!dmEmail.trim()) return;

    try {
      const conversation = await authRequest<DirectConversation>('/dm/conversations', {
        method: 'POST',
        body: JSON.stringify({ email: dmEmail })
      });

      setDmEmail('');
      router.push(`/dm/${conversation.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to start DM');
    }
  };

  return (
    <AuthGuard>
      <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-6 md:px-8">
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <ServerSidebar servers={servers} />

          <section className="space-y-4">
            <Panel className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Workspace</p>
                <h1 className="mt-1 text-2xl font-semibold">Hello, {user?.displayName}</h1>
              </div>
              <div className="flex gap-2">
                <Button variant="soft" onClick={() => router.push('/dm')}>
                  Direct Messages
                </Button>
                <Button
                  variant="soft"
                  onClick={() => {
                    logout().then(() => router.replace('/login'));
                  }}
                >
                  Logout
                </Button>
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Panel className="p-5">
                <h2 className="text-lg font-semibold">Your servers</h2>
                <p className="text-sm text-slate-400">Select a server to open channels and real-time communication.</p>
                {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {servers.map((server) => (
                    <button
                      key={server.id}
                      className="glass rounded-xl border border-white/10 px-4 py-3 text-left transition hover:border-white/30"
                      onClick={() => openServer(server.id)}
                    >
                      <p className="text-sm font-semibold">{server.name}</p>
                      <p className="mt-1 text-xs text-slate-400">Open workspace</p>
                    </button>
                  ))}
                </div>
                {servers.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed border-white/20 p-4 text-sm text-slate-400">
                    No servers yet. Create your first server.
                  </div>
                ) : null}
              </Panel>

              <div className="space-y-4">
                <Panel className="p-5">
                  <h2 className="text-lg font-semibold">Create server</h2>
                  <p className="mb-4 text-sm text-slate-400">Add icon upload and instantly provision channels.</p>
                  <CreateServerForm onCreated={(server) => setServers((prev) => [server, ...prev])} />
                  {servers[0] ? (
                    <Link href={`/server/${servers[0].id}`} className="mt-4 block text-xs text-slate-300 underline underline-offset-4">
                      Go to latest server
                    </Link>
                  ) : null}
                </Panel>

                <Panel className="space-y-3 p-5">
                  <h2 className="text-lg font-semibold">Join by invite code</h2>
                  <form className="space-y-2" onSubmit={joinInvite}>
                    <Input
                      required
                      placeholder="Paste invite code"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value)}
                    />
                    <Button className="w-full" variant="soft">
                      Join server
                    </Button>
                  </form>
                </Panel>

                <Panel className="space-y-3 p-5">
                  <h2 className="text-lg font-semibold">Start a direct message</h2>
                  <form className="space-y-2" onSubmit={startDm}>
                    <Input
                      required
                      type="email"
                      placeholder="User email"
                      value={dmEmail}
                      onChange={(event) => setDmEmail(event.target.value)}
                    />
                    <Button className="w-full" variant="soft">
                      Open DM
                    </Button>
                  </form>
                </Panel>
              </div>
            </div>
          </section>
        </div>
      </main>
    </AuthGuard>
  );
}
