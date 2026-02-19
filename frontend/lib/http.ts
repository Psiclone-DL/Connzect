import { API_URL } from './config';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
    }
  });

  const payload = await response
    .json()
    .catch(() => ({ message: response.ok ? 'Unexpected success response' : 'Unexpected error response' }));

  if (!response.ok) {
    throw new ApiError(response.status, payload.message ?? 'Request failed');
  }

  return payload as T;
};
