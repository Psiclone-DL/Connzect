const browserOrigin = typeof window === 'undefined' ? '' : window.location.origin;

export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || browserOrigin;
