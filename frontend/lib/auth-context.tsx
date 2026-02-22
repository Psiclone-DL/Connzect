'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, request } from './http';
import type { User } from '@/types';

type AuthPayload = {
  accessToken: string;
  user: User;
};

type AuthContextValue = {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (nextUser: User) => void;
  authRequest: <T>(path: string, init?: RequestInit) => Promise<T>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshPromiseRef = useRef<Promise<string> | null>(null);

  const applyAuth = useCallback((payload: AuthPayload) => {
    setUser(payload.user);
    setAccessToken(payload.accessToken);
  }, []);

  const refresh = useCallback(async (): Promise<string> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    refreshPromiseRef.current = (async () => {
      const payload = await request<AuthPayload>('/auth/refresh', {
        method: 'POST'
      });
      applyAuth(payload);
      return payload.accessToken;
    })()
      .catch((error) => {
        setUser(null);
        setAccessToken(null);
        throw error;
      })
      .finally(() => {
        refreshPromiseRef.current = null;
      });

    return refreshPromiseRef.current;
  }, [applyAuth]);

  const login = useCallback(
    async (email: string, password: string) => {
      const payload = await request<AuthPayload>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      applyAuth(payload);
    },
    [applyAuth]
  );

  const register = useCallback(
    async (displayName: string, email: string, password: string) => {
      await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ displayName, email, password })
      });

      await login(email, password);
    },
    [login]
  );

  const logout = useCallback(async () => {
    await request('/auth/logout', {
      method: 'POST'
    }).catch(() => undefined);

    setAccessToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((nextUser: User) => {
    setUser(nextUser);
  }, []);

  const authRequest = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const makeRequest = async (tokenOverride?: string): Promise<T> => {
        const token = tokenOverride ?? accessToken;
        const headers = {
          ...(init?.headers ?? {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        return request<T>(path, {
          ...init,
          headers
        });
      };

      try {
        return await makeRequest();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const refreshedAccessToken = await refresh();
          return makeRequest(refreshedAccessToken);
        }

        throw error;
      }
    },
    [accessToken, refresh]
  );

  useEffect(() => {
    refresh()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      accessToken,
      loading,
      login,
      register,
      logout,
      updateUser,
      authRequest
    }),
    [accessToken, authRequest, loading, login, logout, register, updateUser, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
};
