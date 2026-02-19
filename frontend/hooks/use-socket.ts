'use client';

import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from '@/lib/config';

export const useSocket = (token: string | null) => {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      setSocket((current) => {
        current?.disconnect();
        return null;
      });
      return;
    }

    const nextSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: {
        token
      }
    });

    setSocket(nextSocket);

    return () => {
      nextSocket.disconnect();
    };
  }, [token]);

  return useMemo(() => socket, [socket]);
};
