'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/layout/auth-guard';
import { Panel } from '@/components/ui/panel';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import type { DirectConversation } from '@/types';

export default function DmInboxPage() {
  const router = useRouter();
  const { user, authRequest } = useAuth();
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authRequest<DirectConversation[]>('/dm/conversations')
      .then(setConversations)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed to load DMs'));
  }, [authRequest]);

  const createConversation = async (event: FormEvent) => {
    event.preventDefault();

    try {
      const created = await authRequest<DirectConversation>('/dm/conversations', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      router.push(`/dm/${created.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to start conversation');
    }
  };

  const conversationRows = useMemo(
    () =>
      conversations.map((conversation) => {
        const otherUsers = conversation.participants.filter((participant) => participant.id !== user?.id);
        const title = otherUsers.map((entry) => entry.displayName).join(', ') || 'Direct Message';

        return {
          id: conversation.id,
          title,
          preview: conversation.lastMessage?.content ?? 'No messages yet'
        };
      }),
    [conversations, user?.id]
  );

  return (
    <AuthGuard>
      <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 md:px-8">
        <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
          <Panel className="p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Connzect</p>
                <h1 className="text-2xl font-semibold">Direct Messages</h1>
              </div>
              <Button variant="soft" onClick={() => router.push('/app')}>
                Back to Dashboard
              </Button>
            </div>

            {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

            <div className="space-y-2">
              {conversationRows.map((conversation) => (
                <Link key={conversation.id} href={`/dm/${conversation.id}`} className="glass block rounded-xl p-3 transition hover:border hover:border-white/20">
                  <p className="text-sm font-semibold text-slate-100">{conversation.title}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{conversation.preview}</p>
                </Link>
              ))}
              {conversationRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/20 p-4 text-sm text-slate-400">
                  No DM conversations yet.
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel className="space-y-3 p-5">
            <h2 className="text-lg font-semibold">Start New DM</h2>
            <form className="space-y-2" onSubmit={createConversation}>
              <Input
                required
                type="email"
                placeholder="User email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button className="w-full" variant="soft">
                Start conversation
              </Button>
            </form>
          </Panel>
        </div>
      </main>
    </AuthGuard>
  );
}
