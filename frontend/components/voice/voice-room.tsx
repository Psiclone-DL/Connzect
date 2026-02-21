'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { VoiceParticipant } from '@/types';
import { resolveAssetUrl } from '@/lib/assets';

type SignalType = 'offer' | 'answer' | 'ice-candidate';

type SignalPayload = {
  fromSocketId: string;
  type: SignalType;
  data: unknown;
};

interface VoiceRoomProps {
  channelId: string;
  socket: Socket;
  onParticipantsChange?: (participants: VoiceParticipant[]) => void;
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export const VoiceRoom = ({ channelId, socket, onParticipantsChange }: VoiceRoomProps) => {
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Array<{ socketId: string; stream: MediaStream }>>([]);

  const sortedParticipants = useMemo(
    () => [...participants].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [participants]
  );

  useEffect(() => {
    const ensurePeer = async (targetSocketId: string): Promise<RTCPeerConnection> => {
      const existing = peersRef.current.get(targetSocketId);
      if (existing) {
        return existing;
      }

      const peer = new RTCPeerConnection(rtcConfig);
      peersRef.current.set(targetSocketId, peer);

      localStreamRef.current?.getTracks().forEach((track) => {
        peer.addTrack(track, localStreamRef.current!);
      });

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc:signal', {
            toSocketId: targetSocketId,
            type: 'ice-candidate',
            data: event.candidate
          });
        }
      };

      peer.ontrack = (event) => {
        const [stream] = event.streams;
        remoteStreamsRef.current.set(targetSocketId, stream);
        setRemoteStreams(Array.from(remoteStreamsRef.current.entries()).map(([socketId, streamValue]) => ({ socketId, stream: streamValue })));
      };

      return peer;
    };

    const handleSignal = async (payload: SignalPayload) => {
      try {
        const peer = await ensurePeer(payload.fromSocketId);

        if (payload.type === 'offer') {
          await peer.setRemoteDescription(new RTCSessionDescription(payload.data as RTCSessionDescriptionInit));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit('webrtc:signal', {
            toSocketId: payload.fromSocketId,
            type: 'answer',
            data: answer
          });
          return;
        }

        if (payload.type === 'answer') {
          await peer.setRemoteDescription(new RTCSessionDescription(payload.data as RTCSessionDescriptionInit));
          return;
        }

        if (payload.type === 'ice-candidate') {
          await peer.addIceCandidate(payload.data as RTCIceCandidateInit);
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Voice signaling error');
      }
    };

    const handleParticipants = async (nextParticipants: VoiceParticipant[]) => {
      setParticipants(nextParticipants);
      onParticipantsChange?.(nextParticipants);
      const me = socket.id;

      for (const participant of nextParticipants) {
        if (!me || participant.socketId === me) continue;

        const peer = await ensurePeer(participant.socketId);

        // Deterministic initiator avoids offer collisions.
        if (me < participant.socketId && peer.signalingState === 'stable') {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          socket.emit('webrtc:signal', {
            toSocketId: participant.socketId,
            type: 'offer',
            data: offer
          });
        }
      }

      const validSocketIds = new Set(nextParticipants.map((participant) => participant.socketId));
      for (const [socketId, peer] of peersRef.current) {
        if (!validSocketIds.has(socketId)) {
          peer.close();
          peersRef.current.delete(socketId);
          remoteStreamsRef.current.delete(socketId);
        }
      }

      setRemoteStreams(Array.from(remoteStreamsRef.current.entries()).map(([socketId, stream]) => ({ socketId, stream })));
    };

    const initialize = async () => {
      try {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        socket.emit('voice:join', { channelId });
      } catch {
        setError('Microphone access is required for voice channels.');
      }
    };

    socket.on('voice:participants', handleParticipants);
    socket.on('webrtc:signal', handleSignal);

    initialize().catch(() => undefined);

    return () => {
      socket.emit('voice:leave');
      socket.off('voice:participants', handleParticipants);
      socket.off('webrtc:signal', handleSignal);

      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      remoteStreamsRef.current.clear();
      setRemoteStreams([]);
      onParticipantsChange?.([]);

      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    };
  }, [channelId, onParticipantsChange, socket]);

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-100">Live Voice Channel</h3>
        <p className="mt-1 text-xs text-slate-400">Participants currently connected to voice</p>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {sortedParticipants.map((participant) => {
          const avatarUrl = resolveAssetUrl(participant.avatarUrl ?? null);
          return (
            <div key={participant.socketId} className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={participant.displayName} className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[10px] font-semibold">
                  {participant.displayName.trim().charAt(0).toUpperCase() || '?'}
                </span>
              )}
              <span className="truncate">{participant.displayName}</span>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        {remoteStreams.map((entry) => (
          <RemoteAudio key={entry.socketId} stream={entry.stream} />
        ))}
      </div>
    </div>
  );
};

const RemoteAudio = ({ stream }: { stream: MediaStream }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline />;
};
