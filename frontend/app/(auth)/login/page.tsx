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
        <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Download App</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <a
              href="/download/apk"
              className="rounded-xl border border-white/10 bg-frosted px-4 py-2 text-center text-sm font-semibold text-slate-100 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-burgundySoft"
            >
              Download APK
            </a>
            <a
              href="/download/installer"
              className="rounded-xl border border-white/10 bg-frosted px-4 py-2 text-center text-sm font-semibold text-slate-100 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-burgundySoft"
            >
              Download Installer (.exe)
            </a>
          </div>
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
