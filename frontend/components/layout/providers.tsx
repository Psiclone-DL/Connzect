'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-context';
import { RouteAccessGate } from './route-access-gate';

export const Providers = ({ children }: { children: ReactNode }) => {
  return (
    <AuthProvider>
      <RouteAccessGate>{children}</RouteAccessGate>
    </AuthProvider>
  );
};
