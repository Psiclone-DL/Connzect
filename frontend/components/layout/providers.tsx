'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-context';

export const Providers = ({ children }: { children: ReactNode }) => {
  return <AuthProvider>{children}</AuthProvider>;
};
