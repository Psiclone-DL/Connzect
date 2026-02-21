'use client';

import { useMemo, useState } from 'react';
import type { DirectMessage, Message } from '@/types';
import { cn, formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ChatMessage = Message | DirectMessage;
type GroupedChatMessage = {
  grouped: boolean;
  message: ChatMessage;
};

const GROUP_WINDOW_MS = 30 * 60 * 1000;
const compactTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit'
});

const getFallbackInitial = (displayName: string): string =>
  displayName.trim().charAt(0).toUpperCase() || '?';

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId?: string;
  onEdit?: (messageId: string, content: string) => Promise<void> | void;
  onDelete?: (messageId: string) => Promise<void> | void;
  allowDeleteOthers?: boolean;
  onOpenThread?: (message: ChatMessage) => void;
  activeThreadParentId?: string | null;
}

export const MessageList = ({
  messages,
  currentUserId,
  onEdit,
  onDelete,
  allowDeleteOthers = false,
  onOpenThread,
  activeThreadParentId
}: MessageListProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [busy, setBusy] = useState(false);
  const groupedMessages = useMemo<GroupedChatMessage[]>(() => {
    return messages.map((message, index) => {
      const previousMessage = index > 0 ? messages[index - 1] : null;

      if (!previousMessage || previousMessage.authorId !== message.authorId) {
        return { message, grouped: false };
      }

      const previousCreatedAt = new Date(previousMessage.createdAt).getTime();
      const currentCreatedAt = new Date(message.createdAt).getTime();
      const delta = currentCreatedAt - previousCreatedAt;
      const grouped = Number.isFinite(delta) && delta >= 0 && delta < GROUP_WINDOW_MS;

      return { message, grouped };
    });
  }, [messages]);

  const beginEditing = (message: ChatMessage) => {
    setEditingId(message.id);
    setEditingContent(message.content);
  };

  const saveEditing = async (messageId: string) => {
    if (!onEdit) return;

    const trimmed = editingContent.trim();
    if (!trimmed) return;

    setBusy(true);
    try {
      await onEdit(messageId, trimmed);
      setEditingId(null);
      setEditingContent('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="soft-scroll h-[52vh] overflow-x-hidden overflow-y-auto pr-1">
      {groupedMessages.map(({ message, grouped }) => {
        const isOwnMessage = Boolean(currentUserId && currentUserId === message.authorId);
        const canEdit = Boolean(onEdit && isOwnMessage);
        const canDelete = Boolean(onDelete && currentUserId && (isOwnMessage || allowDeleteOthers));
        const isActiveThread = activeThreadParentId === message.id;
        const hasActions = Boolean(onOpenThread || canEdit || canDelete);

        return (
          <article
            key={message.id}
            className={cn(
              'group/message relative grid grid-cols-[3.2rem_minmax(0,1fr)] gap-3 px-2 transition-colors hover:bg-white/[0.04]',
              grouped ? 'mt-0 py-0' : 'mt-px py-0.5',
              isActiveThread ? 'bg-emerald-200/[0.08]' : ''
            )}
          >
            {grouped ? (
              <div className="select-none pr-1 pt-0.5 text-right text-[10px] text-slate-500 opacity-0 transition-opacity group-hover/message:opacity-100">
                {compactTimeFormatter.format(new Date(message.createdAt))}
              </div>
            ) : (
              <div className="pt-0">
                {message.author.avatarUrl ? (
                  <img
                    src={message.author.avatarUrl}
                    alt={`${message.author.displayName} avatar`}
                    className="h-9 w-9 rounded-full border border-white/10 object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/10 text-sm font-semibold text-slate-200">
                    {getFallbackInitial(message.author.displayName)}
                  </div>
                )}
              </div>
            )}

            <div className="min-w-0">
              {!grouped ? (
                <header className="mb-0 flex items-baseline gap-2 pr-40 text-xs">
                  <span className="font-semibold text-slate-200">{message.author.displayName}</span>
                  <span className="text-slate-400">{formatDateTime(message.createdAt)}</span>
                </header>
              ) : null}

              {hasActions ? (
                <div className="pointer-events-none absolute right-2 top-0.5 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100">
                  {onOpenThread ? (
                    <button
                      type="button"
                      aria-label="Open thread"
                      title="Thread"
                      className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded text-sm text-slate-400 transition hover:bg-white/10 hover:text-white"
                      onClick={() => onOpenThread(message)}
                    >
                      🧵
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label="Edit message"
                      title="Edit"
                      className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded text-sm text-slate-400 transition hover:bg-white/10 hover:text-white"
                      onClick={() => beginEditing(message)}
                    >
                      ✏️
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      aria-label="Delete message"
                      title="Delete"
                      className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded text-sm text-slate-400 transition hover:bg-red-500/20 hover:text-red-200"
                      onClick={() => onDelete?.(message.id)}
                    >
                      🗑️
                    </button>
                  ) : null}
                </div>
              ) : null}

              {editingId === message.id ? (
                <div className="flex items-center gap-2 py-1">
                  <Input value={editingContent} onChange={(event) => setEditingContent(event.target.value)} maxLength={2000} />
                  <Button type="button" disabled={busy} onClick={() => saveEditing(message.id)}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="soft"
                    onClick={() => {
                      setEditingId(null);
                      setEditingContent('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.3] text-slate-100">
                  {message.content}
                  {message.editedAt ? <span className="ml-2 text-[11px] text-slate-500">(edited)</span> : null}
                </p>
              )}
            </div>
          </article>
        );
      })}
      {messages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/20 p-6 text-sm text-slate-400">
          No messages yet. Start the conversation.
        </div>
      ) : null}
    </div>
  );
};
