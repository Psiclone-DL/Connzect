'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { VoiceEventPayload, VoiceParticipant } from '@/types';
import { resolveAssetUrl } from '@/lib/assets';
import { playVoiceCue, unlockSharedAudioContext } from '@/lib/audio/voice-cues';

type SignalType = 'offer' | 'answer' | 'ice-candidate';

type SignalPayload = {
  fromSocketId: string;
  type: SignalType;
  data: unknown;
};

type RemoteScreenShare = {
  socketId: string;
  stream: MediaStream;
};

interface VoiceRoomProps {
  channelId: string;
  socket: Socket;
  isMicMuted?: boolean;
  isOutputMuted?: boolean;
  preferredInputDeviceId?: string;
  preferredOutputDeviceId?: string;
  onParticipantsChange?: (participants: VoiceParticipant[]) => void;
  sharedScreenStream?: MediaStream | null;
  onRemoteScreenShareChange?: (shares: RemoteScreenShare[]) => void;
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
  onParticipantsChange,
  sharedScreenStream,
  onRemoteScreenShareChange
}: VoiceRoomProps) => {
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const micMutedRef = useRef(isMicMuted);
  const outputMutedRef = useRef(isOutputMuted);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Array<{ socketId: string; stream: MediaStream }>>([]);
  const screenSenderRefs = useRef<Map<string, RTCRtpSender[]>>(new Map());
  const remoteShareStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  const sortedParticipants = useMemo(
    () => [...participants].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [participants]
  );

  const broadcastRemoteShareStreams = useCallback(() => {
    if (!onRemoteScreenShareChange) return;
    const entries: RemoteScreenShare[] = Array.from(remoteShareStreamsRef.current.entries()).map(
      ([socketId, stream]) => ({ socketId, stream })
    );
    onRemoteScreenShareChange(entries);
  }, [onRemoteScreenShareChange]);

  const applySharedScreen = useCallback(
    (peer: RTCPeerConnection, targetSocketId: string) => {
      const previousSenders = screenSenderRefs.current.get(targetSocketId);
      previousSenders?.forEach((sender) => {
        try {
          peer.removeTrack(sender);
        } catch {
          // ignore removal errors
        }
      });
      screenSenderRefs.current.delete(targetSocketId);

      if (!sharedScreenStream) {
        return;
      }

      const videoTracks = sharedScreenStream.getVideoTracks();
      if (videoTracks.length === 0) {
        return;
      }

      const nextSenders = videoTracks.map((track) => peer.addTrack(track, sharedScreenStream));
      screenSenderRefs.current.set(targetSocketId, nextSenders);
    },
    [sharedScreenStream]
  );

  useEffect(() => {
    for (const [socketId, peer] of peersRef.current) {
      applySharedScreen(peer, socketId);
    }
  }, [applySharedScreen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const unlockAudio = () => {
      void unlockSharedAudioContext();
    };

    // Browser autoplay policies require a user gesture before audio playback.
    unlockAudio();
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

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

        if (stream.getVideoTracks().length > 0) {
          remoteShareStreamsRef.current.set(targetSocketId, stream);
        } else {
          remoteShareStreamsRef.current.delete(targetSocketId);
        }
        broadcastRemoteShareStreams();

        if (event.track.kind === 'video') {
          const handleEnded = () => {
            if (remoteShareStreamsRef.current.get(targetSocketId) === stream) {
              remoteShareStreamsRef.current.delete(targetSocketId);
              broadcastRemoteShareStreams();
            }
            event.track.removeEventListener('ended', handleEnded);
          };
          event.track.addEventListener('ended', handleEnded);
        }
      };

      applySharedScreen(peer, targetSocketId);

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
          screenSenderRefs.current.delete(socketId);
          if (remoteShareStreamsRef.current.delete(socketId)) {
            broadcastRemoteShareStreams();
          }
        }
      }

      setRemoteStreams(Array.from(remoteStreamsRef.current.entries()).map(([socketId, stream]) => ({ socketId, stream })));
    };

    const handleVoiceEvent = (payload: VoiceEventPayload) => {
      if (!payload || payload.channelId !== channelId) return;
      const isLocal = payload.participant?.socketId === socket.id;
      const localMuteActions: VoiceEventPayload['action'][] = ['mic-muted', 'mic-unmuted', 'sound-muted', 'sound-unmuted'];
      if (isLocal && localMuteActions.includes(payload.action)) {
        return;
      }
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
      screenSenderRefs.current.clear();
      remoteShareStreamsRef.current.clear();
      broadcastRemoteShareStreams();
      onParticipantsChange?.([]);

      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
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
