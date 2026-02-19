import Link from 'next/link';
import { RegisterForm } from '@/components/forms/register-form';

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <section className="glass w-full animate-rise rounded-3xl p-8 shadow-soft">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Connzect</p>
        <h1 className="mt-3 text-3xl font-semibold">Create account</h1>
        <p className="mt-2 text-sm text-slate-400">Build your own server architecture in seconds.</p>
        <div className="mt-6">
          <RegisterForm />
        </div>
        <p className="mt-6 text-sm text-slate-400">
          Already have an account?{' '}
          <Link href="/login" className="text-slate-200 underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
