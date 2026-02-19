'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface MessageInputProps {
  onSend: (content: string) => Promise<void> | void;
  placeholder?: string;
  submitLabel?: string;
}

export const MessageInput = ({ onSend, placeholder = 'Type a message', submitLabel = 'Send' }: MessageInputProps) => {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const trimmed = content.trim();
    if (!trimmed) return;

    setSending(true);

    try {
      await onSend(trimmed);
      setContent('');
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="mt-4 flex gap-2" onSubmit={handleSubmit}>
      <Input placeholder={placeholder} value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} />
      <Button disabled={sending}>{sending ? '...' : submitLabel}</Button>
    </form>
  );
};
