'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth-context';
import type { ConnzectServer } from '@/types';

interface CreateServerFormProps {
  onCreated: (server: ConnzectServer) => void;
}

export const CreateServerForm = ({ onCreated }: CreateServerFormProps) => {
  const { authRequest } = useAuth();
  const [name, setName] = useState('');
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.set('name', name);
      if (iconFile) {
        formData.set('icon', iconFile);
      }

      const created = await authRequest<ConnzectServer>('/servers', {
        method: 'POST',
        body: formData
      });

      onCreated(created);
      setName('');
      setIconFile(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create server');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <Input
        required
        placeholder="New server name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => setIconFile(event.target.files?.[0] ?? null)}
      />
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <Button className="w-full" variant="soft" disabled={submitting}>
        {submitting ? 'Creating server...' : 'Create Server'}
      </Button>
    </form>
  );
};
