import type { EnvelopePoint } from './features';

// Mic capture for the breathing experiment (Notion DR-28; docs/research/breathing.md).
// Processing off (echo cancellation, noise suppression, auto gain) and verified via getSettings();
// 4th-order Butterworth band-pass 200–4000 Hz; RMS level (dBFS) every 10 ms; clipping from the unfiltered signal.
// Only the envelope leaves this module — no raw audio is stored.

export const NOISE_MS = 1000;
export const EXHALE_MS = 6000;
const HOP_MS = 10;
const BAND: [number, number] = [200, 4000];
const BUTTER4_Q = [0.5412, 1.3066];
const CLIP_LEVEL = 0.999;

export const MIC_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
} as const;

export type CapturePhase = 'noise' | 'exhale';

export interface BreathCaptureResult {
  envelope: EnvelopePoint[];
  settings: Record<string, unknown>; // track.getSettings() + context info, saved with the session
}

export interface BreathCapture {
  done: Promise<BreathCaptureResult>;
  cancel: () => void;
}

/**
 * Must be called from a tap: creates and resumes the AudioContext synchronously (iOS requirement),
 * then asks for the mic. `onProgress` gets the phase, elapsed ms within it and the latest level.
 */
export function startBreathCapture(onProgress: (phase: CapturePhase, elapsedMs: number, db: number) => void): BreathCapture {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const resumed = ctx.resume();
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;
  let rejectDone: (e: unknown) => void = () => {};

  const cleanup = () => {
    if (timer) clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void ctx.close().catch(() => {});
  };

  const done = new Promise<BreathCaptureResult>((resolve, reject) => {
    rejectDone = reject;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS }, video: false });
        await resumed;
        if (cancelled) throw new DOMException('Cancelled', 'AbortError');
        const track = stream.getAudioTracks()[0];
        const source = ctx.createMediaStreamSource(stream);

        const raw = new AnalyserNode(ctx, { fftSize: 1024 });
        source.connect(raw);
        let node: AudioNode = source;
        for (const q of BUTTER4_Q) node = node.connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: BAND[0], Q: q }));
        for (const q of BUTTER4_Q) node = node.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: BAND[1], Q: q }));
        const filtered = new AnalyserNode(ctx, { fftSize: 1024 });
        node.connect(filtered);

        // Analyse the most recent HOP_MS of audio each tick.
        const hopSamples = Math.max(64, Math.round((ctx.sampleRate * HOP_MS) / 1000));
        const fBuf = new Float32Array(filtered.fftSize);
        const rBuf = new Float32Array(raw.fftSize);
        const envelope: EnvelopePoint[] = [];
        const t0 = performance.now();

        timer = setInterval(() => {
          const t = performance.now() - t0;
          filtered.getFloatTimeDomainData(fBuf);
          raw.getFloatTimeDomainData(rBuf);
          let sum = 0;
          for (let i = fBuf.length - hopSamples; i < fBuf.length; i++) sum += fBuf[i] * fBuf[i];
          const db = 20 * Math.log10(Math.sqrt(sum / hopSamples) || 1e-9);
          let clipped = false;
          for (let i = rBuf.length - hopSamples; i < rBuf.length; i++) if (Math.abs(rBuf[i]) >= CLIP_LEVEL) clipped = true;
          envelope.push({ t: Math.round(t), db, clipped });
          onProgress(t < NOISE_MS ? 'noise' : 'exhale', t < NOISE_MS ? t : t - NOISE_MS, db);
          if (t >= NOISE_MS + EXHALE_MS) {
            const settings = {
              ...(track.getSettings() as Record<string, unknown>),
              requested: { ...MIC_CONSTRAINTS },
              contextSampleRate: ctx.sampleRate,
              baseLatency: ctx.baseLatency,
              band: BAND,
              hopMs: HOP_MS,
              label: track.label,
            };
            cleanup();
            resolve({ envelope, settings });
          }
        }, HOP_MS);
      } catch (e) {
        cleanup();
        reject(e);
      }
    })();
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      cleanup();
      rejectDone(new DOMException('Cancelled', 'AbortError'));
    },
  };
}
