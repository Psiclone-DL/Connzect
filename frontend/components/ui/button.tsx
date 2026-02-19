import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'soft' | 'danger';
}

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-burgundy text-white hover:bg-burgundySoft shadow-glow disabled:opacity-60 disabled:cursor-not-allowed',
  soft: 'bg-frosted text-slate-100 hover:bg-white/10 border border-white/10',
  danger: 'bg-red-600/80 text-white hover:bg-red-500/90'
};

export const Button = ({ className, variant = 'primary', ...props }: ButtonProps) => (
  <button
    className={cn(
      'rounded-xl px-4 py-2 text-sm font-semibold transition duration-200 focus:outline-none focus:ring-2 focus:ring-burgundySoft',
      variants[variant],
      className
    )}
    {...props}
  />
);
