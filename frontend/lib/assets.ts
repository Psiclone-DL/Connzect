import { API_URL } from './config';

const browserOrigin = typeof window === 'undefined' ? '' : window.location.origin;

const getApiOrigin = (): string => {
  try {
    return new URL(API_URL, browserOrigin || 'http://localhost').origin;
  } catch {
    return browserOrigin;
  }
};

export const resolveAssetUrl = (value?: string | null): string | null => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) {
    return `${typeof window !== 'undefined' ? window.location.protocol : 'https:'}${value}`;
  }
  if (value.startsWith('/')) {
    const origin = getApiOrigin();
    return origin ? `${origin}${value}` : value;
  }

  return value;
};
