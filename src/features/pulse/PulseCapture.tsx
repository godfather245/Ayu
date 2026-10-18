import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExperimentalBadge, StatusChip } from '../../components';
import { newId, repo } from '../../data/repo';
import type { Measurement } from '../../data/schema';
import { EXPERIMENTAL_LABEL, MEASURE_LIMITATIONS } from '../../lib/copy';
import { nowIso } from '../../lib/dates';
import { browserSummary, deviceSummary } from '../../lib/device';
import { CAPTURE_SECONDS, HRV_METHOD, METHOD, THRESH, analyzeFrames, liveEstimate, type Frame, type LiveEstimate, type PulseResult } from './analyze';
import { CAL_RECORD_MS, CAL_SETTLE_MS, rankLenses, scoreLensSample, type LensScore } from './calibrate';
import { createCues, type Cues } from '../../lib/cues';
import { lensName, listBackLenses, resolveLens, saveLens, type Lens } from './lens';

// Lab experiment: 60 s fingertip-over-camera capture → experimental average pulse and HRV estimates.
// Only per-frame red/green means are kept in memory; no video or images are stored. Every attempt can be saved,
// including failures, with an optional ECG reference for the same window.

type Phase = 'idle' | 'preview' | 'calibrating' | 'starting' | 'capturing' | 'done' | 'error';

interface CalStep {
  index: number;
  total: number;
  name: string;
  stage: 'opening' | 'settling' | 'recording';
}

interface CalResult {
  lens: Lens;
  score: LensScore;
}

interface CaptureMeta {
  start: string;
  end: string;
  torch: boolean;
  lens: string;
  settings: Record<string, unknown>;
}

const SAMPLE_W = 40;
const SAMPLE_H = 30;
const CUE_EVERY_S = 15;

function parseReference(text: string): number | undefined {
  const v = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(v) && v > 20 && v < 250 ? v : undefined;
}

const isCovered = (r: number, g: number) => r >= THRESH.minRed && g > 0 && r / g >= THRESH.minRedGreen;
const LIVE_EVERY_MS = 250;

function LiveView({ live }: { live: LiveEstimate | null }) {
  const pts = live?.wave ?? [];
  const points = pts.map((v, i) => `${((i / Math.max(1, pts.length - 1)) * 100).toFixed(2)},${(28 - v * 26).toFixed(2)}`).join(' ');
  return (
    <div className="live">
      <p className="live-bpm">
        {live?.bpm ?? '—'} <span className="small muted">bpm live</span>
      </p>
      <svg className="wave" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
        {pts.length > 1 && <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
      </svg>
      <p className="muted small">
        {!live || !live.covered
          ? 'Lens not covered: keep your fingertip over the lens and flashlight'
          : live.bpm === undefined
            ? 'Finding your pulse…'
            : 'Live number settles over time; the saved result uses the full 60 s.'}
      </p>
    </div>
  );
}

export default function PulseCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cuesRef = useRef<Cues | null>(null);
  const runRef = useRef(0);
  const framesRef = useRef<Frame[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedS, setElapsedS] = useState(0);
  const [lenses, setLenses] = useState<Lens[] | null>(null);
  const [lens, setLens] = useState<Lens | undefined>();
  const [coverage, setCoverage] = useState<{ r: number; g: number; ok: boolean } | null>(null);
  const [torchOn, setTorchOn] = useState<boolean | null>(null);
  const [live, setLive] = useState<LiveEstimate | null>(null);
  const [calStep, setCalStep] = useState<CalStep | null>(null);
  const [calResults, setCalResults] = useState<CalResult[] | null>(null);
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

  const disposeCues = () => {
    cuesRef.current?.dispose();
    cuesRef.current = null;
  };

  // Camera and torch must turn off when leaving the screen or backgrounding the app.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return;
      stopTracks();
      disposeCues();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stopTracks);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stopTracks);
      stopTracks();
      disposeCues();
    };
  }, []);

  /** Opens the chosen lens (exact device, so it can't switch mid-capture) and turns the torch on. */
  const openCamera = async (target?: Lens) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: target
        ? { deviceId: { exact: target.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    let torch = false;
    try {
      await track.applyConstraints({ advanced: [{ torch: true } as unknown as MediaTrackConstraintSet] });
      torch = (track.getSettings() as Record<string, unknown>).torch === true;
    } catch {
      torch = false;
    }
    return { stream, track, torch };
  };

  const attach = async (stream: MediaStream) => {
    streamRef.current = stream;
    const video = videoRef.current!;
    video.srcObject = stream;
    await video.play();
    const canvas = canvasRef.current!;
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    return { video, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
  };

  const sample = (ctx: CanvasRenderingContext2D, video: HTMLVideoElement) => {
    ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    const px = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    let r = 0;
    let g = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i];
      g += px[i + 1];
    }
    const n = px.length / 4;
    return { r: r / n, g: g / n };
  };

  /** Live preview of one lens with torch on and a covered / not-covered indicator. */
  const preview = async (target: Lens) => {
    stopTracks();
    const run = runRef.current;
    setError(null);
    setCoverage(null);
    setTorchOn(null);
    setPhase('preview');
    try {
      const { stream, torch } = await openCamera(target);
      if (runRef.current !== run) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setTorchOn(torch);
      const { video, ctx } = await attach(stream);
      let last = 0;
      const loop = (now: number) => {
        if (runRef.current !== run) return;
        if (now - last > 250) {
          last = now;
          const { r, g } = sample(ctx, video);
          setCoverage({ r: Math.round(r), g: Math.round(g), ok: isCovered(r, g) });
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch (e) {
      stopTracks();
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setPhase('error');
    }
  };

  /** Lens labels are hidden until camera permission is granted, so ask once, then list. */
  const openPicker = async () => {
    setError(null);
    try {
      let found = await listBackLenses();
      if (!found.length) {
        const { stream } = await openCamera();
        stream.getTracks().forEach((t) => t.stop());
        found = await listBackLenses();
      }
      setLenses(found);
      const chosen = resolveLens(found);
      setLens(chosen);
      if (chosen) await preview(chosen);
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setPhase('error');
    }
  };

  /** Stops the current stream without cancelling the run (used between lenses during auto-configuration). */
  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const recordFor = (video: HTMLVideoElement, ctx: CanvasRenderingContext2D, ms: number, run: number) =>
    new Promise<Frame[]>((resolve) => {
      const frames: Frame[] = [];
      const t0 = performance.now();
      const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
      const step = (now: number) => {
        if (runRef.current !== run) return resolve(frames);
        frames.push({ t: now, ...sample(ctx, video) });
        if (now - t0 >= ms) return resolve(frames);
        if (hasRvfc) video.requestVideoFrameCallback((n) => step(n));
        else requestAnimationFrame(step);
      };
      if (hasRvfc) video.requestVideoFrameCallback((n) => step(n));
      else requestAnimationFrame(step);
    });

  /** Tries every single (physical) lens with the finger held still, scores each, and keeps the best. */
  const autoConfigure = async () => {
    disposeCues();
    cuesRef.current = createCues();
    stopTracks();
    const run = runRef.current;
    setError(null);
    setCalResults(null);
    setPhase('calibrating');
    try {
      let found = lenses?.length ? lenses : await listBackLenses();
      if (!found.length) {
        const { stream } = await openCamera();
        stream.getTracks().forEach((t) => t.stop());
        found = await listBackLenses();
      }
      setLenses(found);
      const candidates = found.some((l) => !l.virtual) ? found.filter((l) => !l.virtual) : found;
      const results: CalResult[] = [];
      for (const [index, l] of candidates.entries()) {
        if (runRef.current !== run) return;
        const step = { index, total: candidates.length, name: lensName(l.label) };
        setCalStep({ ...step, stage: 'opening' });
        let score: LensScore;
        try {
          const { stream, torch } = await openCamera(l);
          if (runRef.current !== run) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          const { video, ctx } = await attach(stream);
          setCalStep({ ...step, stage: 'settling' });
          await wait(CAL_SETTLE_MS);
          setCalStep({ ...step, stage: 'recording' });
          const frames = await recordFor(video, ctx, CAL_RECORD_MS, run);
          releaseStream();
          score = scoreLensSample(frames, torch);
        } catch (e) {
          releaseStream();
          score = scoreLensSample([], false);
          score.reason = `could not open this lens (${e instanceof Error ? e.name : 'error'})`;
        }
        if (runRef.current !== run) return;
        results.push({ lens: l, score });
        setCalResults(rankLenses(results));
        if (index < candidates.length - 1) cuesRef.current?.tick();
      }
      const best = rankLenses(results)[0];
      if (best && best.score.score > 0) {
        setLens(best.lens);
        saveLens({ deviceId: best.lens.deviceId, label: best.lens.label });
      }
      cuesRef.current?.done();
      setTimeout(disposeCues, 1500);
      setCalStep(null);
      setPhase('idle');
    } catch (e) {
      stopTracks();
      disposeCues();
      setCalStep(null);
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setPhase('error');
    }
  };

  const pickLens = (l: Lens) => {
    setLens(l);
    saveLens({ deviceId: l.deviceId, label: l.label });
    void preview(l);
  };

  const closePreview = () => {
    stopTracks();
    setPhase('idle');
  };

  const cancel = () => {
    stopTracks();
    disposeCues();
    setCalStep(null);
    setPhase('idle');
    setElapsedS(0);
  };

  const start = async () => {
    // Cues must be created synchronously inside the tap so iOS allows audio.
    disposeCues();
    cuesRef.current = createCues();
    stopTracks();
    const run = runRef.current;
    framesRef.current = [];
    setError(null);
    setResult(null);
    setMeta(null);
    setSaved(false);
    setElapsedS(0);
    setLive(null);
    setPhase('starting');
    try {
      let target = lens;
      if (!target) {
        const found = await listBackLenses();
        target = resolveLens(found);
      }
      const { stream, track, torch } = await openCamera(target);
      if (runRef.current !== run) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const { video, ctx } = await attach(stream);
      if (runRef.current !== run) return;

      const startMs = performance.now();
      const startIso = nowIso();
      const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
      const schedule = (cb: (now: number) => void) => (hasRvfc ? video.requestVideoFrameCallback((now) => cb(now)) : requestAnimationFrame(cb));
      let nextCue = CUE_EVERY_S;
      let shownS = -1;
      let lastLive = 0;
      setPhase('capturing');

      const onFrame = (now: number) => {
        if (runRef.current !== run) return;
        framesRef.current.push({ t: now, ...sample(ctx, video) });
        if (now - lastLive >= LIVE_EVERY_MS) {
          lastLive = now;
          setLive(liveEstimate(framesRef.current));
        }
        const elapsed = (now - startMs) / 1000;
        if (Math.floor(elapsed) !== shownS) {
          shownS = Math.floor(elapsed);
          setElapsedS(shownS);
        }
        if (elapsed >= nextCue && nextCue < CAPTURE_SECONDS) {
          cuesRef.current?.tick();
          nextCue += CUE_EVERY_S;
        }
        if (elapsed < CAPTURE_SECONDS) {
          schedule(onFrame);
          return;
        }
        cuesRef.current?.done();
        setTimeout(disposeCues, 1500);
        const res = analyzeFrames(framesRef.current);
        setMeta({
          start: startIso,
          end: nowIso(),
          torch,
          lens: track.label,
          settings: { ...(track.getSettings() as Record<string, unknown>), lens: track.label, frameTiming: hasRvfc ? 'requestVideoFrameCallback' : 'requestAnimationFrame' },
        });
        setResult(res);
        stopTracks();
        setPhase('done');
      };
      schedule(onFrame);
    } catch (e) {
      stopTracks();
      disposeCues();
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
  const remaining = Math.max(0, CAPTURE_SECONDS - elapsedS);
  const nextBuzz = Math.min(CAPTURE_SECONDS, (Math.floor(elapsedS / CUE_EVERY_S) + 1) * CUE_EVERY_S);

  return (
    <section className="stack">
      <Link to="/lab" className="back">‹ Lab</Link>
      <div className="row between">
        <h1>Pulse experiment</h1>
        <ExperimentalBadge />
      </div>
      <p className="muted small">{EXPERIMENTAL_LABEL}. Average resting pulse, plus a heart-rate variability estimate when the signal is very clean.</p>

      {(phase === 'idle' || phase === 'preview') && (
        <div className="card stack">
          <div className="row between">
            <h2>Lens</h2>
            <span className="small">{lens ? lensName(lens.label) : 'Not chosen yet'}</span>
          </div>
          {phase === 'idle' && (
            <>
              <button onClick={autoConfigure}>Find best lens automatically</button>
              <p className="muted small">
                Hold your fingertip still over the flashlight and the lens next to it. The app tries each lens for about{' '}
                {Math.round((CAL_SETTLE_MS + CAL_RECORD_MS) / 1000)} s, beeps between lenses, and keeps the one that picks up your pulse best.
              </p>
              <button className="secondary" onClick={openPicker}>
                {lens ? 'Choose lens manually / check finger position' : 'Choose lens manually and check finger position'}
              </button>
            </>
          )}
          {phase === 'idle' && calResults && calResults.length > 0 && (
            <div className="stack">
              <h3>Lens test results</h3>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Lens</th>
                    <th>Score</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {calResults.map(({ lens: l, score: s }, i) => (
                    <tr key={l.deviceId}>
                      <td>
                        {i === 0 && s.score > 0 ? '★ ' : ''}
                        {lensName(l.label)}
                      </td>
                      <td>{s.score}</td>
                      <td className="small">
                        {s.reason ?? `${s.beats} beats · flashlight ${s.torch ? 'on' : 'off'} · ${s.fps} fps`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                {calResults[0].score.score > 0
                  ? `Using ${lensName(calResults[0].lens.label)}. Scores apply to this finger position; rerun if you hold the phone differently.`
                  : 'No lens picked up a pulse. Cover the flashlight and the lens beside it fully, keep still, and try again.'}
              </p>
            </div>
          )}
          {phase === 'preview' && lenses && (
            <>
              <p className="muted small">
                Cover the flashlight and one lens with your fingertip. Try each lens until the check below turns green, then start.
              </p>
              <div className="segmented lens-picker" role="group" aria-label="Lens">
                {lenses.map((l) => (
                  <button key={l.deviceId} className={lens?.deviceId === l.deviceId ? 'on' : ''} aria-pressed={lens?.deviceId === l.deviceId} onClick={() => pickLens(l)}>
                    {lensName(l.label)}
                  </button>
                ))}
              </div>
              {lens?.virtual && <p className="error small">This option switches between lenses by itself. Pick a single lens for a steady capture.</p>}
              <p className={`coverage ${coverage?.ok ? 'ok' : ''}`}>
                {coverage === null ? 'Starting camera…' : coverage.ok ? '✓ Lens covered, light coming through your finger' : '✗ Not covered yet: move your fingertip over the lens and flashlight'}
              </p>
              <p className="muted small">
                Flashlight: {torchOn === null ? '…' : torchOn ? 'on' : 'off (this lens may not support it)'}
                {coverage && ` · red ${coverage.r}, green ${coverage.g}`}
              </p>
              <button className="link" onClick={closePreview}>Close preview</button>
            </>
          )}
        </div>
      )}

      {phase === 'calibrating' && (
        <div className="card stack center">
          <h2>Finding the best lens</h2>
          <p className="countdown small-countdown">
            {calStep ? calStep.index + 1 : '…'}
            <span className="small muted"> / {calStep?.total ?? '…'}</span>
          </p>
          <p>
            {calStep?.name ?? 'Listing lenses…'}
            {calStep && ` · ${calStep.stage === 'recording' ? 'measuring' : calStep.stage === 'settling' ? 'settling' : 'opening'}`}
          </p>
          <p className="muted small">Keep your fingertip still over the flashlight and the lens next to it.</p>
          <button className="secondary" onClick={cancel}>Cancel</button>
        </div>
      )}

      <video ref={videoRef} className="probe-video" playsInline muted autoPlay hidden={!(capturing || phase === 'preview' || phase === 'calibrating')} />
      <canvas ref={canvasRef} hidden />

      {(phase === 'idle' || phase === 'preview') && (
        <div className="card stack">
          <h2>Before you start</h2>
          <ul>
            <li>Sit and rest for a minute first, not right after exercise.</li>
            <li>Gently cover the lens <strong>and</strong> the flashlight with one fingertip. Don't press hard.</li>
            <li>Rest your hand on a table and stay still for {CAPTURE_SECONDS} seconds.</li>
            <li>You'll feel a tap and hear a beep every {CUE_EVERY_S} s, and a double beep when it's done. Turn off silent mode to hear the beeps.</li>
          </ul>
          <p className="muted small">Only brightness numbers are kept while recording. No video or photos are saved.</p>
          <button className="big" onClick={start}>Start {CAPTURE_SECONDS} s capture</button>
        </div>
      )}

      {capturing && (
        <div className="card stack center">
          <p className="countdown" aria-live="polite">
            {phase === 'starting' ? '…' : remaining}
            <span className="small muted"> s left</span>
          </p>
          <p>{phase === 'starting' ? 'Starting camera…' : 'Hold still'}</p>
          {phase === 'capturing' && <LiveView live={live} />}
          <div className="meter" aria-label="Capture progress">
            <div style={{ width: `${Math.round((elapsedS / CAPTURE_SECONDS) * 100)}%` }} />
          </div>
          {phase === 'capturing' && <p className="muted small">Next tap at {nextBuzz} s{lens ? ` · ${lensName(lens.label)}` : ''}</p>}
          <button className="secondary" onClick={cancel}>Cancel</button>
        </div>
      )}

      {phase === 'error' && (
        <div className="card stack">
          <p className="error">Camera could not start: {error}</p>
          <button onClick={() => setPhase('idle')}>Back</button>
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
            <dt>Lens</dt>
            <dd>{meta ? lensName(meta.lens) : '—'}</dd>
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
