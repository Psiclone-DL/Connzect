'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/layout/auth-guard';
import { ServerSidebar } from '@/components/layout/server-sidebar';
import { ChannelList } from '@/components/layout/channel-list';
import { MessageList } from '@/components/chat/message-list';
import { MessageInput } from '@/components/chat/message-input';
import { VoiceRoom } from '@/components/voice/voice-room';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { useAuth } from '@/lib/auth-context';
import { useSocket } from '@/hooks/use-socket';
import type { Channel, ConnzectServer, Message, ServerDetails } from '@/types';

export default function ChannelPage() {
  const router = useRouter();
  const params = useParams<{ serverId: string; channelId: string }>();
  const { user, accessToken, logout, authRequest } = useAuth();
  const socket = useSocket(accessToken);

  const [serverId, setServerId] = useState('');
  const [channelId, setChannelId] = useState('');

  const [servers, setServers] = useState<ConnzectServer[]>([]);
  const [serverDetails, setServerDetails] = useState<ServerDetails | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === channelId) ?? serverDetails?.channels.find((channel) => channel.id === channelId),
    [channelId, channels, serverDetails?.channels]
  );

  useEffect(() => {
    if (params.serverId) setServerId(params.serverId);
    if (params.channelId) setChannelId(params.channelId);
  }, [params.channelId, params.serverId]);

  useEffect(() => {
    if (!serverId) return;

    authRequest<ConnzectServer[]>('/servers')
      .then(setServers)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading servers'));
  }, [authRequest, serverId]);

  useEffect(() => {
    if (!serverId) return;

    Promise.all([
      authRequest<ServerDetails>(`/servers/${serverId}`),
      authRequest<Channel[]>(`/servers/${serverId}/channels`)
    ])
      .then(([details, visibleChannels]) => {
        setServerDetails(details);
        setChannels(visibleChannels);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading server'));
  }, [authRequest, serverId]);

  useEffect(() => {
    if (!channelId || !activeChannel || activeChannel.type !== 'TEXT') {
      setMessages([]);
      setThreadParent(null);
      setThreadMessages([]);
      return;
    }

    authRequest<Message[]>(`/channels/${channelId}/messages?limit=50`)
      .then((loaded) => {
        setMessages(loaded);
        setThreadParent(null);
        setThreadMessages([]);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading messages'));
  }, [activeChannel, authRequest, channelId]);

  useEffect(() => {
    if (!threadParent || !channelId || !activeChannel || activeChannel.type !== 'TEXT') return;

    authRequest<Message[]>(`/channels/${channelId}/messages?limit=50&parentMessageId=${threadParent.id}`)
      .then(setThreadMessages)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading thread'));
  }, [activeChannel, authRequest, channelId, threadParent]);

  useEffect(() => {
    if (!socket || !channelId || !activeChannel || activeChannel.type !== 'TEXT') return;

    const joinChannel = () => {
      socket.emit('channel:join', { channelId });
    };

    if (socket.connected) {
      joinChannel();
    }

    const onMessage = (message: Message) => {
      if (message.channelId !== channelId) return;

      if (message.parentMessageId) {
        if (threadParent && message.parentMessageId === threadParent.id) {
          setThreadMessages((prev) => [...prev, message]);
        }
        return;
      }

      setMessages((prev) => [...prev, message]);
    };

    const onMessageUpdated = (message: Message) => {
      if (message.channelId !== channelId) return;

      setMessages((prev) => prev.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadMessages((prev) => prev.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadParent((prev) => (prev?.id === message.id ? message : prev));
    };

    const onMessageDeleted = (payload: { id: string; channelId: string }) => {
      if (payload.channelId !== channelId) return;
      setMessages((prev) => prev.filter((entry) => entry.id !== payload.id));
      setThreadMessages((prev) => prev.filter((entry) => entry.id !== payload.id));
      setThreadParent((prev) => (prev?.id === payload.id ? null : prev));
    };

    const onError = (payload: { scope: string; message: string }) => {
      setError(`${payload.scope}: ${payload.message}`);
    };

    socket.on('message:new', onMessage);
    socket.on('message:updated', onMessageUpdated);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('error:event', onError);
    socket.on('connect', joinChannel);

    return () => {
      socket.emit('channel:leave', { channelId });
      socket.off('message:new', onMessage);
      socket.off('message:updated', onMessageUpdated);
      socket.off('message:deleted', onMessageDeleted);
      socket.off('error:event', onError);
      socket.off('connect', joinChannel);
    };
  }, [activeChannel, channelId, socket, threadParent]);

  const upsertMessageLocal = (message: Message) => {
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

  const removeMessageLocal = (messageId: string) => {
    setMessages((prev) => prev.filter((entry) => entry.id !== messageId));
    setThreadMessages((prev) => prev.filter((entry) => entry.id !== messageId));
    setThreadParent((prev) => (prev?.id === messageId ? null : prev));
  };

  const sendMessage = async (content: string, parentMessageId?: string) => {
    if (!channelId) return;
    if (!activeChannel || activeChannel.type !== 'TEXT') {
      setError('Only text channels support text chat');
      return;
    }

    if (!socket?.connected) {
      const created = await authRequest<Message>(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, parentMessageId })
      });
      upsertMessageLocal(created);
      return;
    }

    socket.emit('message:send', { channelId, content, parentMessageId });
  };

  const editMessage = async (messageId: string, content: string) => {
    if (!channelId) return;
    if (!activeChannel || activeChannel.type !== 'TEXT') {
      setError('Only text channels support text chat');
      return;
    }

    if (!socket?.connected) {
      const updated = await authRequest<Message>(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content })
      });
      upsertMessageLocal(updated);
      return;
    }

    socket.emit('message:edit', { channelId, messageId, content });
  };

  const deleteMessage = async (messageId: string) => {
    if (!channelId) return;
    if (!activeChannel || activeChannel.type !== 'TEXT') {
      setError('Only text channels support text chat');
      return;
    }

    if (!socket?.connected) {
      const deleted = await authRequest<{ id: string }>(`/channels/${channelId}/messages/${messageId}`, {
        method: 'DELETE'
      });
      removeMessageLocal(deleted.id);
      return;
    }

    socket.emit('message:delete', { channelId, messageId });
  };

  return (
    <AuthGuard>
      <main className="min-h-screen w-full overflow-x-clip px-2 py-4 md:px-4 md:py-5">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[5.5rem_17rem_minmax(0,1fr)]">
          <ServerSidebar servers={servers} activeServerId={serverId} />

          <ChannelList serverId={serverId} channels={channels} activeChannelId={channelId} />

          <section className="min-w-0 space-y-4">
            <Panel className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Server</p>
                  <h1 className="text-2xl font-semibold">{serverDetails?.name ?? 'Loading...'}</h1>
                  <p className="text-sm text-slate-400">Channel: {activeChannel ? `#${activeChannel.name}` : 'Unknown'}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="soft" onClick={() => router.push('/dm')}>
                    DMs
                  </Button>
                  <Button variant="soft" onClick={() => router.push('/app')}>
                    Dashboard
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
              </div>
              {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
            </Panel>

            <Panel className="p-5">
              {activeChannel?.type === 'VOICE' ? (
                socket ? (
                  <VoiceRoom channelId={channelId} socket={socket} />
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/20 p-6 text-sm text-slate-300">
                    Voice channel selected. Realtime connection is required to join voice.
                  </div>
                )
              ) : activeChannel?.type === 'CATEGORY' ? (
                <div className="rounded-2xl border border-dashed border-white/20 p-6 text-sm text-slate-300">
                  Category selected. Pick a text or voice channel.
                </div>
              ) : (
                <div className={`grid gap-4 ${threadParent ? 'lg:grid-cols-[1.6fr_1fr]' : ''}`}>
                  <div>
                    <MessageList
                      messages={messages}
                      currentUserId={user?.id}
                      onEdit={editMessage}
                      onDelete={deleteMessage}
                      allowDeleteOthers={serverDetails?.ownerId === user?.id}
                      onOpenThread={(message) => setThreadParent(message as Message)}
                      activeThreadParentId={threadParent?.id ?? null}
                    />
                    <MessageInput onSend={(content) => sendMessage(content)} placeholder="Type in channel" />
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
                        allowDeleteOthers={serverDetails?.ownerId === user?.id}
                      />
                      <MessageInput
                        onSend={(content) => sendMessage(content, threadParent.id)}
                        placeholder="Reply in thread"
                        submitLabel="Reply"
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </Panel>
          </section>
        </div>
      </main>
    </AuthGuard>
  );
}
