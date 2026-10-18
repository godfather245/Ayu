import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserSummary, deviceSummary, isStandalone } from '../../lib/device';
import { nowIso } from '../../lib/dates';

// Hidden route /lab/probe — reports exactly what this browser allows for camera, torch,
// frame timing and mic constraints. A human runs it on the demo iPhone and pastes the JSON into Gate A.

const FPS_WINDOW_MS = 5000;

type Facing = 'environment' | 'user';

interface FpsResult {
  method: 'requestVideoFrameCallback' | 'requestAnimationFrame+currentTime';
  fps: number;
  frames: number;
  windowMs: number;
}

interface CameraResult {
  requestedFacing: Facing;
  ok: boolean;
  error?: string;
  label?: string;
  settings?: Record<string, unknown>;
  capabilities?: Record<string, unknown> | null;
  torchInCapabilities?: boolean;
  torchEnable?: { attempted: boolean; ok: boolean; settingsTorch?: unknown; error?: string };
  fps?: FpsResult;
}

interface MicResult {
  ok: boolean;
  error?: string;
  label?: string;
  requested: Record<string, unknown>;
  settings?: Record<string, unknown>;
  constraintsHonored?: Record<string, boolean | 'not reported'>;
  audioContext?: { sampleRate: number; state: string; baseLatency?: number };
  observedDbfs?: { min: number; max: number };
}

const MIC_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
} as const;

const describeError = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const asRecord = (o: unknown) => (o ? (JSON.parse(JSON.stringify(o)) as Record<string, unknown>) : undefined);

function measureFps(video: HTMLVideoElement, isCancelled: () => boolean): Promise<FpsResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    // Checked on the prototype (not `in video`) so TS doesn't narrow the fallback branch to never.
    const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    if (hasRvfc) {
      let firstPresented: number | undefined;
      let lastPresented = 0;
      let callbacks = 0;
      const onFrame = (now: number, meta: VideoFrameCallbackMetadata) => {
        callbacks++;
        firstPresented ??= meta.presentedFrames;
        lastPresented = meta.presentedFrames;
        const elapsed = now - start;
        if (elapsed >= FPS_WINDOW_MS || isCancelled()) {
          const frames = Math.max(lastPresented - (firstPresented ?? lastPresented), callbacks - 1);
          resolve({ method: 'requestVideoFrameCallback', fps: round(frames / (elapsed / 1000)), frames, windowMs: Math.round(elapsed) });
          return;
        }
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    } else {
      // Fallback: count distinct currentTime values per animation frame. Flagged in the result.
      let frames = 0;
      let lastTime = -1;
      const tick = (now: number) => {
        if (video.currentTime !== lastTime) {
          frames++;
          lastTime = video.currentTime;
        }
        const elapsed = now - start;
        if (elapsed >= FPS_WINDOW_MS || isCancelled()) {
          resolve({ method: 'requestAnimationFrame+currentTime', fps: round(frames / (elapsed / 1000)), frames, windowMs: Math.round(elapsed) });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  });
}

export default function Probe() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamsRef = useRef(new Set<MediaStream>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const runRef = useRef(0); // bumps on every stop; in-flight loops compare against it
  const [busy, setBusy] = useState<string | null>(null);
  const [rear, setRear] = useState<CameraResult | null>(null);
  const [front, setFront] = useState<CameraResult | null>(null);
  const [mic, setMic] = useState<MicResult | null>(null);
  const [liveDb, setLiveDb] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const stopAll = useCallback(() => {
    runRef.current++;
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current.clear();
    if (videoRef.current) videoRef.current.srcObject = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLiveDb(null);
    setBusy(null);
  }, []);

  // Stop every track when leaving the route or backgrounding the page (camera light must turn off).
  useEffect(() => {
    const onHide = () => stopAll();
    const onVisibility = () => document.hidden && stopAll();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      stopAll();
    };
  }, [stopAll]);

  const probeCamera = async (facing: Facing) => {
    stopAll();
    const run = runRef.current;
    const setResult = facing === 'environment' ? setRear : setFront;
    setBusy(facing === 'environment' ? 'Rear camera: measuring fps for 5 s…' : 'Front camera: measuring fps for 5 s…');
    const result: CameraResult = { requestedFacing: facing, ok: false };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamsRef.current.add(stream);
      const track = stream.getVideoTracks()[0];
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      result.ok = true;
      result.label = track.label;
      result.capabilities = typeof track.getCapabilities === 'function' ? asRecord(track.getCapabilities()) ?? null : null;
      result.torchInCapabilities = !!result.capabilities && 'torch' in result.capabilities;

      if (facing === 'environment') {
        const torch: NonNullable<CameraResult['torchEnable']> = { attempted: true, ok: false };
        try {
          await track.applyConstraints({ advanced: [{ torch: true } as unknown as MediaTrackConstraintSet] });
          torch.settingsTorch = (track.getSettings() as Record<string, unknown>).torch;
          torch.ok = torch.settingsTorch === true;
        } catch (e) {
          torch.error = describeError(e);
        }
        result.torchEnable = torch;
      }

      result.settings = asRecord(track.getSettings());
      result.fps = await measureFps(video, () => runRef.current !== run);
    } catch (e) {
      result.error = describeError(e);
    }
    if (runRef.current === run) {
      setResult(result);
      setBusy(null);
    }
  };

  const probeMic = async () => {
    stopAll();
    const run = runRef.current;
    // Create + resume the AudioContext synchronously inside the tap — iOS requires a user gesture.
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const resumed = ctx.resume();
    setBusy('Microphone: live level below. Tap Stop when done.');
    const result: MicResult = { ok: false, requested: { ...MIC_CONSTRAINTS } };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS }, video: false });
      streamsRef.current.add(stream);
      await resumed;
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings() as Record<string, unknown>;
      result.ok = true;
      result.label = track.label;
      result.settings = asRecord(settings);
      result.constraintsHonored = Object.fromEntries(
        (['echoCancellation', 'noiseSuppression', 'autoGainControl', 'channelCount'] as const).map((k) => [
          k,
          settings[k] === undefined ? 'not reported' : settings[k] === MIC_CONSTRAINTS[k],
        ]),
      );
      result.audioContext = { sampleRate: ctx.sampleRate, state: ctx.state, baseLatency: ctx.baseLatency };

      const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let min = Infinity;
      let max = -Infinity;
      let lastPaint = 0;
      const loop = (now: number) => {
        if (runRef.current !== run) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const dbfs = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9);
        min = Math.min(min, dbfs);
        max = Math.max(max, dbfs);
        if (now - lastPaint > 100) {
          lastPaint = now;
          setLiveDb(dbfs);
          setMic({ ...result, observedDbfs: { min: round(min), max: round(max) } });
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      setMic(result);
    } catch (e) {
      result.error = describeError(e);
      setMic(result);
      setBusy(null);
    }
  };

  const summary = useMemo(
    () =>
      JSON.stringify(
        {
          probeVersion: 1,
          generatedAt: nowIso(),
          origin: window.location.origin,
          isSecureContext: window.isSecureContext,
          standalone: isStandalone(),
          device: deviceSummary(),
          browser: browserSummary(),
          userAgent: navigator.userAgent,
          getUserMediaAvailable: !!navigator.mediaDevices?.getUserMedia,
          requestVideoFrameCallbackAvailable: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
          rearCamera: rear,
          frontCamera: front,
          microphone: mic,
        },
        null,
        2,
      ),
    [rear, front, mic],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      const ta = document.getElementById('probe-json') as HTMLTextAreaElement | null;
      ta?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const meterPct = liveDb === null ? 0 : Math.max(0, Math.min(100, ((liveDb + 90) / 90) * 100));

  return (
    <section className="stack">
      <h1>Media probe</h1>
      <p className="muted">Research tool. Nothing here is saved; tracks stop when you leave this page.</p>
      {!window.isSecureContext && <p className="error">Not a secure context — camera and mic need HTTPS or localhost.</p>}

      <div className="row">
        <button onClick={() => probeCamera('environment')} disabled={!!busy}>Rear camera + torch</button>
        <button onClick={() => probeCamera('user')} disabled={!!busy}>Front camera</button>
        <button onClick={probeMic} disabled={!!busy}>Microphone</button>
        <button className="secondary" onClick={stopAll}>Stop</button>
      </div>
      {busy && <p className="muted">{busy}</p>}

      <video ref={videoRef} className="probe-video" playsInline muted autoPlay />

      {liveDb !== null && (
        <div className="stack">
          <div className="meter" aria-label="Mic level">
            <div style={{ width: `${meterPct}%` }} />
          </div>
          <p className="muted">{round(liveDb)} dBFS</p>
        </div>
      )}

      <div className="row">
        <button className="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy JSON'}</button>
      </div>
      <textarea id="probe-json" className="json" readOnly value={summary} />
    </section>
  );
}
