import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Panel = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('glass rounded-2xl shadow-soft', className)} {...props} />
);
