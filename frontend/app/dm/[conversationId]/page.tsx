'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/layout/auth-guard';
import { MessageList } from '@/components/chat/message-list';
import { MessageInput } from '@/components/chat/message-input';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useSocket } from '@/hooks/use-socket';
import type { DirectConversation, DirectMessage } from '@/types';

export default function DmConversationPage() {
  const router = useRouter();
  const params = useParams<{ conversationId: string }>();
  const { user, accessToken, authRequest } = useAuth();
  const socket = useSocket(accessToken);

  const [conversationId, setConversationId] = useState('');
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [threadParent, setThreadParent] = useState<DirectMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<DirectMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.conversationId) {
      setConversationId(params.conversationId);
    }
  }, [params.conversationId]);

  useEffect(() => {
    authRequest<DirectConversation[]>('/dm/conversations')
      .then(setConversations)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed to load conversations'));
  }, [authRequest]);

  useEffect(() => {
    if (!conversationId) return;

    authRequest<DirectMessage[]>(`/dm/conversations/${conversationId}/messages?limit=50`)
      .then((loaded) => {
        setMessages(loaded);
        setThreadParent(null);
        setThreadMessages([]);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed to load DM messages'));
  }, [authRequest, conversationId]);

  useEffect(() => {
    if (!threadParent || !conversationId) return;

    authRequest<DirectMessage[]>(`/dm/conversations/${conversationId}/messages?limit=50&parentMessageId=${threadParent.id}`)
      .then(setThreadMessages)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed to load thread'));
  }, [authRequest, conversationId, threadParent]);

  useEffect(() => {
    if (!socket || !conversationId) return;

    const joinConversation = () => {
      socket.emit('dm:join', { conversationId });
    };

    if (socket.connected) {
      joinConversation();
    }

    const onMessage = (message: DirectMessage) => {
      if (message.conversationId !== conversationId) return;

      if (message.parentMessageId) {
        if (threadParent && message.parentMessageId === threadParent.id) {
          setThreadMessages((prev) => [...prev, message]);
        }
        return;
      }

      setMessages((prev) => [...prev, message]);
    };

    const onMessageUpdated = (message: DirectMessage) => {
      if (message.conversationId !== conversationId) return;

      setMessages((prev) => prev.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadMessages((prev) => prev.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadParent((prev) => (prev?.id === message.id ? message : prev));
    };

    const onError = (payload: { scope: string; message: string }) => {
      setError(`${payload.scope}: ${payload.message}`);
    };

    socket.on('dm:message:new', onMessage);
    socket.on('dm:message:updated', onMessageUpdated);
    socket.on('error:event', onError);
    socket.on('connect', joinConversation);

    return () => {
      socket.emit('dm:leave', { conversationId });
      socket.off('dm:message:new', onMessage);
      socket.off('dm:message:updated', onMessageUpdated);
      socket.off('error:event', onError);
      socket.off('connect', joinConversation);
    };
  }, [conversationId, socket, threadParent]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === conversationId) ?? null,
    [conversationId, conversations]
  );

  const conversationTitle = useMemo(() => {
    if (!activeConversation) return 'Direct Message';
    const peers = activeConversation.participants.filter((participant) => participant.id !== user?.id);
    return peers.map((peer) => peer.displayName).join(', ') || 'Direct Message';
  }, [activeConversation, user?.id]);

  const upsertMessage = (message: DirectMessage) => {
    if (message.parentMessageId) {
      setThreadMessages((prev) => {
        if (prev.some((entry) => entry.id === message.id)) {
          return prev.map((entry) => (entry.id === message.id ? message : entry));
        }
        return [...prev, message];
      });
      return;
    }

    setMessages((prev) => {
      if (prev.some((entry) => entry.id === message.id)) {
        return prev.map((entry) => (entry.id === message.id ? message : entry));
      }
      return [...prev, message];
    });
  };

  const sendMessage = async (content: string, parentMessageId?: string) => {
    if (!conversationId) return;

    if (!socket?.connected) {
      const created = await authRequest<DirectMessage>(`/dm/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, parentMessageId })
      });
      upsertMessage(created);
      return;
    }

    socket.emit('dm:message:send', { conversationId, content, parentMessageId });
  };

  const editMessage = async (messageId: string, content: string) => {
    if (!conversationId) return;

    if (!socket?.connected) {
      const updated = await authRequest<DirectMessage>(`/dm/conversations/${conversationId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content })
      });
      upsertMessage(updated);
      return;
    }

    socket.emit('dm:message:edit', { conversationId, messageId, content });
  };

  const deleteMessage = async (messageId: string) => {
    if (!conversationId) return;

    if (!socket?.connected) {
      const deleted = await authRequest<DirectMessage>(`/dm/conversations/${conversationId}/messages/${messageId}`, {
        method: 'DELETE'
      });
      upsertMessage(deleted);
      return;
    }

    socket.emit('dm:message:delete', { conversationId, messageId });
  };

  return (
    <AuthGuard>
      <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-6 md:px-8">
        <div className="grid gap-4 xl:grid-cols-[18rem_1fr]">
          <Panel className="space-y-2 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Conversations</p>
              <Button variant="soft" onClick={() => router.push('/dm')}>
                Inbox
              </Button>
            </div>

            {conversations.map((conversation) => {
              const peers = conversation.participants.filter((participant) => participant.id !== user?.id);
              const title = peers.map((peer) => peer.displayName).join(', ') || 'Direct Message';

              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`glass w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                    conversation.id === conversationId ? 'border border-burgundySoft/70' : 'hover:border hover:border-white/20'
                  }`}
                  onClick={() => router.push(`/dm/${conversation.id}`)}
                >
                  {title}
                </button>
              );
            })}
          </Panel>

          <section className="space-y-4">
            <Panel className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Direct Message</p>
                  <h1 className="text-2xl font-semibold">{conversationTitle}</h1>
                </div>
                <div className="flex gap-2">
                  <Button variant="soft" onClick={() => router.push('/app')}>
                    Dashboard
                  </Button>
                  <Button variant="soft" onClick={() => router.push('/dm')}>
                    Inbox
                  </Button>
                </div>
              </div>
              {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
            </Panel>

            <Panel className="p-5">
              <div className={`grid gap-4 ${threadParent ? 'lg:grid-cols-[1.6fr_1fr]' : ''}`}>
                <div>
                  <MessageList
                    messages={messages}
                    currentUserId={user?.id}
                    onEdit={editMessage}
                    onDelete={deleteMessage}
                    onOpenThread={(message) => setThreadParent(message as DirectMessage)}
                    activeThreadParentId={threadParent?.id ?? null}
                  />
                  <MessageInput onSend={(content) => sendMessage(content)} placeholder="Type a direct message" />
                </div>

                {threadParent ? (
                  <div className="glass rounded-xl border border-white/10 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">Thread</p>
                        <p className="text-xs text-slate-400">From {threadParent.author.displayName}</p>
                      </div>
                      <Button variant="soft" type="button" onClick={() => setThreadParent(null)}>
                        Close
                      </Button>
                    </div>

                    <MessageList
                      messages={threadMessages}
                      currentUserId={user?.id}
                      onEdit={editMessage}
                      onDelete={deleteMessage}
                    />
                    <MessageInput
                      onSend={(content) => sendMessage(content, threadParent.id)}
                      placeholder="Reply in thread"
                      submitLabel="Reply"
                    />
                  </div>
                ) : null}
              </div>
            </Panel>
          </section>
        </div>
      </main>
    </AuthGuard>
  );
}
