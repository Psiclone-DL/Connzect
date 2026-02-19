import Link from 'next/link';
import { LoginForm } from '@/components/forms/login-form';

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <section className="glass w-full animate-rise rounded-3xl p-8 shadow-soft">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Connzect</p>
        <h1 className="mt-3 text-3xl font-semibold">Welcome back</h1>
        <p className="mt-2 text-sm text-slate-400">Log in to continue to your communication space.</p>
        <div className="mt-6">
          <LoginForm />
        </div>
        <p className="mt-6 text-sm text-slate-400">
          New here?{' '}
          <Link href="/register" className="text-slate-200 underline underline-offset-4">
            Create account
          </Link>
        </p>
      </section>
    </main>
  );
}
