'use client';

import { useState } from 'react';
import type { DirectMessage, Message } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ChatMessage = Message | DirectMessage;

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId?: string;
  onEdit?: (messageId: string, content: string) => Promise<void> | void;
  onDelete?: (messageId: string) => Promise<void> | void;
  onOpenThread?: (message: ChatMessage) => void;
  activeThreadParentId?: string | null;
}

export const MessageList = ({
  messages,
  currentUserId,
  onEdit,
  onDelete,
  onOpenThread,
  activeThreadParentId
}: MessageListProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [busy, setBusy] = useState(false);

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
    <div className="soft-scroll h-[52vh] space-y-3 overflow-y-auto pr-2">
      {messages.map((message) => {
        const canEdit = Boolean(onEdit && currentUserId && currentUserId === message.authorId && !message.deletedAt);
        const canDelete = Boolean(onDelete && currentUserId && currentUserId === message.authorId && !message.deletedAt);
        const isActiveThread = activeThreadParentId === message.id;

        return (
          <article
            key={message.id}
            className={`glass animate-rise rounded-xl px-4 py-3 ${isActiveThread ? 'border border-burgundySoft/70' : ''}`}
          >
            <header className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200">{message.author.displayName}</span>
                <span>{formatDateTime(message.createdAt)}</span>
                {message.editedAt ? <span className="text-[10px] uppercase tracking-wide">edited</span> : null}
              </div>
              <div className="flex items-center gap-2">
                {onOpenThread ? (
                  <Button
                    type="button"
                    variant="soft"
                    className="px-2 py-1 text-xs"
                    onClick={() => onOpenThread(message)}
                  >
                    Thread
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button type="button" variant="soft" className="px-2 py-1 text-xs" onClick={() => beginEditing(message)}>
                    Edit
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button type="button" variant="danger" className="px-2 py-1 text-xs" onClick={() => onDelete?.(message.id)}>
                    Delete
                  </Button>
                ) : null}
              </div>
            </header>

            {editingId === message.id ? (
              <div className="flex gap-2">
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
              <p className={`text-sm ${message.deletedAt ? 'italic text-slate-400' : 'text-slate-100'}`}>{message.content}</p>
            )}
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
