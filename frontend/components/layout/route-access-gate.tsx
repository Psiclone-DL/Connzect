'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const publicPaths = new Set(['/login', '/register']);

export const RouteAccessGate = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublicPath = pathname ? publicPaths.has(pathname) : false;

  useEffect(() => {
    if (loading) return;

    if (!user && !isPublicPath) {
      router.replace('/login');
      return;
    }

    if (user && isPublicPath) {
      router.replace('/app');
    }
  }, [isPublicPath, loading, router, user]);

  if (loading && !isPublicPath) {
    return <div className="p-10 text-sm text-slate-400">Loading session...</div>;
  }

  if (!user && !isPublicPath) {
    return null;
  }

  if (user && isPublicPath) {
    return null;
  }

  return <>{children}</>;
};
