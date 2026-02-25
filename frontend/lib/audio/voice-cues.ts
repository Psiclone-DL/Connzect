import type { VoiceEventAction } from '@/types';

let sharedAudioContext: AudioContext | null = null;

const getAudioContextCtor = () => {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
};

export const ensureSharedAudioContext = (): AudioContext | null => {
  if (sharedAudioContext) return sharedAudioContext;
  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) return null;
  sharedAudioContext = new AudioContextCtor();
  return sharedAudioContext;
};

export const unlockSharedAudioContext = async (): Promise<AudioContext | null> => {
  const context = ensureSharedAudioContext();
  if (!context) return null;
  if (context.state === 'running') return context;
  try {
    await context.resume();
  } catch {
    // ignore resume failures; autoplay policies may still block.
  }
  return context;
};

const playTone = (context: AudioContext, frequency: number, startAt: number, duration: number, gainValue = 0.035) => {
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

export const playVoiceCue = (action: VoiceEventAction) => {
  const context = ensureSharedAudioContext();
  if (!context) return;

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
        playTone(context, 720, now, 0.09, 0.05);
        playTone(context, 940, now + 0.1, 0.11, 0.06);
        break;
      case 'leave':
      case 'disconnect':
        playTone(context, 760, now, 0.09, 0.05);
        playTone(context, 420, now + 0.1, 0.12, 0.06);
        break;
      case 'mic-muted':
      case 'sound-muted':
        playTone(context, 350, now, 0.11, 0.06);
        break;
      case 'mic-unmuted':
      case 'sound-unmuted':
        playTone(context, 620, now, 0.11, 0.055);
        break;
      default:
        break;
    }
  };

  void run();
};
