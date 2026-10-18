import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExperimentalBadge, StatusChip } from '../../components';
import { newId, repo } from '../../data/repo';
import type { Measurement } from '../../data/schema';
import { EXPERIMENTAL_LABEL, MEASURE_LIMITATIONS } from '../../lib/copy';
import { nowIso } from '../../lib/dates';
import { browserSummary, deviceSummary } from '../../lib/device';
import { CAPTURE_SECONDS, HRV_METHOD, METHOD, analyzeFrames, type Frame, type PulseResult } from './analyze';

// Lab experiment: 60 s fingertip-over-camera capture → experimental average pulse and HRV estimates.
// Only per-frame red/green means are kept in memory; no video or images are stored. Every attempt can be saved,
// including failures, with an optional ECG reference for the same window.

type Phase = 'idle' | 'starting' | 'capturing' | 'done' | 'error';

interface CaptureMeta {
  start: string;
  end: string;
  torch: boolean;
  settings: Record<string, unknown>;
}

const SAMPLE_W = 40;
const SAMPLE_H = 30;

function parseReference(text: string): number | undefined {
  const v = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(v) && v > 20 && v < 250 ? v : undefined;
}

export default function PulseCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0);
  const framesRef = useRef<Frame[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<PulseResult | null>(null);
  const [meta, setMeta] = useState<CaptureMeta | null>(null);
  const [ecg, setEcg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const stopTracks = () => {
    runRef.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // Camera and torch must turn off when leaving the screen or backgrounding the app.
  useEffect(() => {
    const onVisibility = () => document.hidden && stopTracks();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stopTracks);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stopTracks);
      stopTracks();
    };
  }, []);

  const cancel = () => {
    stopTracks();
    setPhase('idle');
    setProgress(0);
  };

  const start = async () => {
    stopTracks();
    const run = runRef.current;
    framesRef.current = [];
    setError(null);
    setResult(null);
    setMeta(null);
    setSaved(false);
    setProgress(0);
    setPhase('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (runRef.current !== run) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      let torch = false;
      try {
        await track.applyConstraints({ advanced: [{ torch: true } as unknown as MediaTrackConstraintSet] });
        torch = (track.getSettings() as Record<string, unknown>).torch === true;
      } catch {
        torch = false;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      if (runRef.current !== run) return;

      const canvas = canvasRef.current!;
      canvas.width = SAMPLE_W;
      canvas.height = SAMPLE_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const startMs = performance.now();
      const startIso = nowIso();
      const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
      const schedule = (cb: (now: number) => void) => (hasRvfc ? video.requestVideoFrameCallback((now) => cb(now)) : requestAnimationFrame(cb));
      setPhase('capturing');

      const onFrame = (now: number) => {
        if (runRef.current !== run) return;
        ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        const px = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
        let r = 0;
        let g = 0;
        for (let i = 0; i < px.length; i += 4) {
          r += px[i];
          g += px[i + 1];
        }
        const n = px.length / 4;
        framesRef.current.push({ t: now, r: r / n, g: g / n });
        const elapsed = now - startMs;
        setProgress(Math.min(1, elapsed / (CAPTURE_SECONDS * 1000)));
        if (elapsed < CAPTURE_SECONDS * 1000) {
          schedule(onFrame);
          return;
        }
        const res = analyzeFrames(framesRef.current);
        setMeta({
          start: startIso,
          end: nowIso(),
          torch,
          settings: { ...(track.getSettings() as Record<string, unknown>), frameTiming: hasRvfc ? 'requestVideoFrameCallback' : 'requestAnimationFrame' },
        });
        setResult(res);
        stopTracks();
        setPhase('done');
      };
      schedule(onFrame);
    } catch (e) {
      stopTracks();
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setPhase('error');
    }
  };

  const save = async () => {
    if (!result || !meta) return;
    const device = deviceSummary();
    const browser = browserSummary();
    const sessionId = newId();
    const reference = parseReference(ecg);
    const shared = {
      timestamp: meta.start,
      device,
      browser,
      quality: result.quality,
      qualityReasons: [...result.qualityReasons],
      experimental: true,
      sessionId,
    };
    const records: Measurement[] = [
      {
        ...shared,
        id: newId(),
        type: 'pulse_ppg',
        method: METHOD,
        ...(result.bpm !== undefined && result.quality !== 'failed' ? { value: result.bpm, unit: 'bpm' as const } : {}),
        ...(reference !== undefined ? { referenceValue: reference, referenceSource: 'one-lead ECG', referenceWindow: { start: meta.start, end: meta.end } } : {}),
      },
    ];
    if (result.rmssd !== undefined && result.quality === 'usable') {
      records.push({ ...shared, id: newId(), type: 'hrv_ppg', method: HRV_METHOD, value: result.rmssd, unit: 'ms' });
    }
    try {
      await repo.addSession({
        id: sessionId,
        timestamp: meta.start,
        endedAt: meta.end,
        kind: 'pulse_ppg',
        device,
        browser,
        settings: {
          ...meta.settings,
          torch: meta.torch,
          beats: result.beats,
          frameRateHz: result.frameRateHz,
          droppedRatio: result.droppedRatio,
          cleanS: result.cleanS,
          templateCorr: result.templateCorr,
          sdnnMs: result.sdnn,
        },
      });
      for (const m of records) await repo.addMeasurement(m);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const capturing = phase === 'starting' || phase === 'capturing';

  return (
    <section className="stack">
      <Link to="/lab" className="back">‹ Lab</Link>
      <div className="row between">
        <h1>Pulse experiment</h1>
        <ExperimentalBadge />
      </div>
      <p className="muted small">{EXPERIMENTAL_LABEL}. Average resting pulse, plus a heart-rate variability estimate when the signal is very clean.</p>

      {phase === 'idle' && (
        <div className="card stack">
          <h2>Before you start</h2>
          <ul>
            <li>Sit and rest for a minute first, not right after exercise.</li>
            <li>Gently cover the rear camera <strong>and</strong> the flashlight with one fingertip. Don't press hard.</li>
            <li>Rest your hand on a table and stay still for {CAPTURE_SECONDS} seconds.</li>
          </ul>
          <p className="muted small">Only brightness numbers are kept while recording. No video or photos are saved.</p>
          <button className="big" onClick={start}>Start {CAPTURE_SECONDS} s capture</button>
        </div>
      )}

      <video ref={videoRef} className="probe-video" playsInline muted autoPlay hidden={!capturing} />
      <canvas ref={canvasRef} hidden />

      {capturing && (
        <div className="card stack">
          <p>{phase === 'starting' ? 'Starting camera…' : 'Hold still…'}</p>
          <div className="meter" aria-label="Capture progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="muted small">{Math.round(progress * CAPTURE_SECONDS)} / {CAPTURE_SECONDS} s</p>
          <button className="secondary" onClick={cancel}>Cancel</button>
        </div>
      )}

      {phase === 'error' && (
        <div className="card stack">
          <p className="error">Camera could not start: {error}</p>
          <button onClick={start}>Try again</button>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="card stack">
          <div className="row between">
            <h2>Result</h2>
            <StatusChip quality={result.quality} reasons={result.qualityReasons} />
          </div>

          <p className="report-latest">
            <strong>{result.bpm !== undefined && result.quality !== 'failed' ? `${result.bpm} bpm` : 'No pulse estimate'}</strong>{' '}
            <span className="muted small">average resting pulse estimate</span>
          </p>
          {result.rmssd !== undefined && result.quality === 'usable' ? (
            <p>
              <strong>{result.rmssd} ms</strong> <span className="muted small">heart-rate variability estimate (rMSSD) · SDNN {result.sdnn} ms</span>
            </p>
          ) : (
            <p className="muted small">Heart-rate variability not shown: it needs a very clean, still capture.</p>
          )}
          <p className="muted small">{MEASURE_LIMITATIONS.hrv_ppg}</p>

          <dl className="report-facts">
            <dt>Beats detected</dt>
            <dd>{result.beats}</dd>
            <dt>Clean signal</dt>
            <dd>{result.cleanS} s of {result.durationS} s</dd>
            <dt>Frame rate</dt>
            <dd>{result.frameRateHz} fps · {Math.round(result.droppedRatio * 100)}% dropped</dd>
            <dt>Flashlight</dt>
            <dd>{meta?.torch ? 'on' : 'off'}</dd>
          </dl>

          <label className="field">
            <span className="field-label">ECG average bpm for the same minute (optional, for the bench check)</span>
            <input className="text" type="number" inputMode="decimal" placeholder="e.g. from the one-lead ECG" value={ecg} onChange={(e) => setEcg(e.target.value)} disabled={saved} />
          </label>
          {ecg.trim() !== '' && parseReference(ecg) === undefined && <p className="error small">Enter a bpm between 20 and 250.</p>}

          {error && <p className="error">{error}</p>}
          <div className="row">
            <button onClick={save} disabled={saved}>{saved ? 'Saved to Timeline' : 'Save this attempt'}</button>
            <button className="secondary" onClick={start}>New capture</button>
          </div>
          <p className="muted small">Failed and low-quality attempts are saved too, so every attempt is counted.</p>
        </div>
      )}
    </section>
  );
}
