'use client';

import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export interface MentionSuggestion {
  id: string;
  label: string;
  insertText: string;
  type: 'user' | 'role';
  secondaryLabel?: string;
}

interface MessageInputProps {
  onSend: (content: string) => Promise<void> | void;
  placeholder?: string;
  submitLabel?: string;
  mentionSuggestions?: MentionSuggestion[];
}

export const MessageInput = ({
  onSend,
  placeholder = 'Type a message',
  submitLabel = 'Send',
  mentionSuggestions = []
}: MessageInputProps) => {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionState, setMentionState] = useState<{ start: number; cursor: number; query: string } | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredSuggestions = useMemo(() => {
    if (!mentionState) return [];
    const query = mentionState.query.toLowerCase();
    const filtered = mentionSuggestions.filter((entry) => {
      if (!query) return true;
      return entry.insertText.toLowerCase().startsWith(query) || entry.label.toLowerCase().includes(query);
    });
    return filtered.slice(0, 8);
  }, [mentionState, mentionSuggestions]);

  const updateMentionState = (value: string, cursor: number) => {
    const prefix = value.slice(0, cursor);
    const match = prefix.match(/(^|\s)@([A-Za-z0-9._-]*)$/);
    if (!match) {
      setMentionState(null);
      setActiveSuggestionIndex(0);
      return;
    }

    const query = match[2] ?? '';
    const start = cursor - query.length - 1;
    setMentionState({ start, cursor, query });
    setActiveSuggestionIndex(0);
  };

  const applySuggestion = (suggestion: MentionSuggestion) => {
    if (!mentionState) return;

    const before = content.slice(0, mentionState.start + 1);
    const after = content.slice(mentionState.cursor);
    const nextValue = `${before}${suggestion.insertText} ${after}`;
    const nextCursor = before.length + suggestion.insertText.length + 1;

    setContent(nextValue);
    setMentionState(null);
    setActiveSuggestionIndex(0);

    window.requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const trimmed = content.trim();
    if (!trimmed) return;

    setSending(true);

    try {
      await onSend(trimmed);
      setContent('');
      setMentionState(null);
      setActiveSuggestionIndex(0);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!mentionState || filteredSuggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSuggestionIndex((previous) => (previous + 1) % filteredSuggestions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSuggestionIndex((previous) => (previous - 1 + filteredSuggestions.length) % filteredSuggestions.length);
      return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      applySuggestion(filteredSuggestions[activeSuggestionIndex] ?? filteredSuggestions[0]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setMentionState(null);
      setActiveSuggestionIndex(0);
    }
  };

  return (
    <form className="mt-4 flex gap-2" onSubmit={handleSubmit}>
      <div className="relative flex-1">
        <input
          ref={inputRef}
          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-burgundySoft focus:ring-2 focus:ring-burgundySoft/40"
          placeholder={placeholder}
          value={content}
          onChange={(event) => {
            const nextValue = event.target.value;
            const cursor = event.target.selectionStart ?? nextValue.length;
            setContent(nextValue);
            updateMentionState(nextValue, cursor);
          }}
          onClick={(event) => {
            const cursor = event.currentTarget.selectionStart ?? content.length;
            updateMentionState(content, cursor);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            window.setTimeout(() => {
              setMentionState(null);
              setActiveSuggestionIndex(0);
            }, 120);
          }}
          maxLength={2000}
        />
        {mentionState && filteredSuggestions.length > 0 ? (
          <div className="absolute z-30 mt-1 w-full rounded-xl border border-white/15 bg-slate-950/95 p-1 shadow-xl backdrop-blur">
            {filteredSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(suggestion);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition ${
                  index === activeSuggestionIndex ? 'bg-white/10 text-white' : 'text-slate-200 hover:bg-white/5'
                }`}
              >
                <span className="truncate">
                  @{suggestion.insertText}
                  <span className="ml-1 text-xs text-slate-400">{suggestion.label}</span>
                </span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{suggestion.type}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Button disabled={sending}>{sending ? '...' : submitLabel}</Button>
    </form>
  );
};
