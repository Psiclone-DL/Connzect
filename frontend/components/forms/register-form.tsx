'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const RegisterForm = () => {
  const router = useRouter();
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await register(displayName, email, password);
      router.replace('/app');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to register');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <Input
        required
        placeholder="Display Name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <Input
        required
        type="email"
        placeholder="Email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Input
        required
        type="password"
        placeholder="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <p className="text-xs text-slate-400">Password must include uppercase, lowercase, and number.</p>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <Button disabled={submitting} className="w-full">
        {submitting ? 'Creating...' : 'Create Account'}
      </Button>
    </form>
  );
};
