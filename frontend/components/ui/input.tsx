import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      'w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-burgundySoft focus:ring-2 focus:ring-burgundySoft/40',
      className
    )}
    {...props}
  />
);
