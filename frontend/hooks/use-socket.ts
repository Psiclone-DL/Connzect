'use client';

import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from '@/lib/config';

let sharedSocket: Socket | null = null;
let sharedToken: string | null = null;

export const useSocket = (token: string | null) => {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      if (sharedSocket) {
        sharedSocket.disconnect();
      }
      sharedSocket = null;
      sharedToken = null;
      setSocket(null);
      return;
    }

    if (sharedSocket && sharedToken === token) {
      setSocket(sharedSocket);
      return;
    }

    if (sharedSocket) {
      sharedSocket.disconnect();
      sharedSocket = null;
      sharedToken = null;
    }

    const nextSocket = io(SOCKET_URL, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      upgrade: true,
      withCredentials: true,
      timeout: 20_000,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
      auth: {
        token
      }
    });

    sharedSocket = nextSocket;
    sharedToken = token;
    setSocket(nextSocket);

    // Keep the shared socket alive across route changes.
    return;
  }, [token]);

  return useMemo(() => socket, [socket]);
};
