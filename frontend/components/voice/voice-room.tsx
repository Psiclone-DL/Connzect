'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { VoiceEventPayload, VoiceParticipant } from '@/types';
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
  isMicMuted?: boolean;
  isOutputMuted?: boolean;
  preferredInputDeviceId?: string;
  preferredOutputDeviceId?: string;
  onParticipantsChange?: (participants: VoiceParticipant[]) => void;
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export const VoiceRoom = ({
  channelId,
  socket,
  isMicMuted = false,
  isOutputMuted = false,
  preferredInputDeviceId,
  preferredOutputDeviceId,
  onParticipantsChange
}: VoiceRoomProps) => {
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const micMutedRef = useRef(isMicMuted);
  const outputMutedRef = useRef(isOutputMuted);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Array<{ socketId: string; stream: MediaStream }>>([]);

  const sortedParticipants = useMemo(
    () => [...participants].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [participants]
  );

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }
    return audioContextRef.current;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const unlockAudio = () => {
      const context = ensureAudioContext();
      if (!context || context.state === 'running') return;
      context.resume().catch(() => undefined);
    };

    // Browser autoplay policies require a user gesture before audio playback.
    unlockAudio();
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, [ensureAudioContext]);

  const playVoiceCue = useCallback((action: VoiceEventPayload['action']) => {
    const context = ensureAudioContext();
    if (!context) return;

    const playTone = (frequency: number, startAt: number, duration: number, gainValue = 0.035) => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.008);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.01);
    };

    const run = async () => {
      if (context.state !== 'running') {
        try {
          await context.resume();
        } catch {
          return;
        }
      }

      const now = context.currentTime + 0.01;
      switch (action) {
        case 'join':
          playTone(720, now, 0.09, 0.05);
          playTone(940, now + 0.1, 0.11, 0.06);
          break;
        case 'leave':
        case 'disconnect':
          playTone(760, now, 0.09, 0.05);
          playTone(420, now + 0.1, 0.12, 0.06);
          break;
        case 'mic-muted':
        case 'sound-muted':
          playTone(350, now, 0.11, 0.06);
          break;
        case 'mic-unmuted':
        case 'sound-unmuted':
          playTone(620, now, 0.11, 0.055);
          break;
        default:
          break;
      }
    };

    run().catch(() => undefined);
  }, [ensureAudioContext]);

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

    const handleVoiceEvent = (payload: VoiceEventPayload) => {
      if (!payload || payload.channelId !== channelId) return;
      playVoiceCue(payload.action);
    };

    const initialize = async () => {
      try {
        const audioConstraints = preferredInputDeviceId ? { deviceId: { exact: preferredInputDeviceId } } : true;
        try {
          localStreamRef.current = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false
          });
        } catch (preferredDeviceError) {
          if (!preferredInputDeviceId) {
            throw preferredDeviceError;
          }

          localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !micMutedRef.current;
        });
        socket.emit('voice:join', {
          channelId,
          isMicMuted: micMutedRef.current,
          isOutputMuted: outputMutedRef.current
        });
      } catch {
        setError('Microphone access is required for voice channels.');
      }
    };

    socket.on('voice:participants', handleParticipants);
    socket.on('voice:event', handleVoiceEvent);
    socket.on('webrtc:signal', handleSignal);

    initialize().catch(() => undefined);

    return () => {
      socket.emit('voice:leave');
      socket.off('voice:participants', handleParticipants);
      socket.off('voice:event', handleVoiceEvent);
      socket.off('webrtc:signal', handleSignal);

      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      remoteStreamsRef.current.clear();
      setRemoteStreams([]);
      onParticipantsChange?.([]);

      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [channelId, onParticipantsChange, playVoiceCue, preferredInputDeviceId, socket]);

  useEffect(() => {
    micMutedRef.current = isMicMuted;
    outputMutedRef.current = isOutputMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !isMicMuted;
    });
    if (socket.connected) {
      socket.emit('voice:state', { isMicMuted, isOutputMuted });
    }
  }, [isMicMuted, isOutputMuted, socket]);

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
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-slate-300/80">
                {participant.isMicMuted ? <span className="rounded border border-red-300/30 bg-red-500/15 px-1">MIC</span> : null}
                {participant.isOutputMuted ? <span className="rounded border border-amber-200/30 bg-amber-400/15 px-1">SOUND</span> : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        {remoteStreams.map((entry) => (
          <RemoteAudio
            key={entry.socketId}
            stream={entry.stream}
            preferredOutputDeviceId={preferredOutputDeviceId}
            isOutputMuted={isOutputMuted}
          />
        ))}
      </div>
    </div>
  );
};

const RemoteAudio = ({
  stream,
  preferredOutputDeviceId,
  isOutputMuted
}: {
  stream: MediaStream;
  preferredOutputDeviceId?: string;
  isOutputMuted?: boolean;
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const element = audioRef.current as (HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }) | null;
    if (!element || !preferredOutputDeviceId) return;
    if (typeof element.setSinkId !== 'function') return;

    element.setSinkId(preferredOutputDeviceId).catch(() => undefined);
  }, [preferredOutputDeviceId]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = Boolean(isOutputMuted);
  }, [isOutputMuted]);

  return <audio ref={audioRef} autoPlay playsInline />;
};
