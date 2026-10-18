import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExperimentalBadge, StatusChip } from '../../components';
import { newId, repo } from '../../data/repo';
import type { Measurement } from '../../data/schema';
import { BREATH_NO_FLOW, BREATH_RESULT, BREATH_SAFETY, BREATH_TIPS, METER_LABEL } from '../../lib/copy';
import { createCues, type Cues } from '../../lib/cues';
import { nowIso, toLocalIso } from '../../lib/dates';
import { browserSummary, deviceSummary } from '../../lib/device';
import { EXHALE_MS, NOISE_MS, startBreathCapture, type BreathCapture, type CapturePhase } from './capture';
import { ONSET_ABOVE_FLOOR_DB, extractBreathFeatures, type BreathFeatures, type EnvelopePoint } from './features';
import { assessBreathQuality, featuresRecord, type BreathAssessment } from './quality';

// Lab → Breathing audio experiment (Notion DR-28/30/31). Records 1 s of room noise then a 6 s forced exhale,
// shows the loudness envelope, assigns quality, and pairs the attempt with a typed-in peak-flow meter reading.
// No raw audio is kept and no flow value is derived from the phone.

type Phase = 'idle' | 'capturing' | 'done' | 'error';
type Order = 'meter_first' | 'phone_first';

const METHOD = 'mic-envelope-v1';
const METER_METHOD = 'walgreens-meter-manual';

function parseMeter(text: string): number | undefined {
  const v = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(v) && v >= 30 && v <= 900 ? Math.round(v) : undefined;
}

function EnvelopeChart({ envelope, features }: { envelope: EnvelopePoint[]; features: BreathFeatures }) {
  if (envelope.length < 2) return null;
  const tMax = envelope[envelope.length - 1].t || 1;
  const lo = features.noiseFloorDb - 6;
  const hi = Math.max(features.peakDb + 3, features.noiseFloorDb + 20);
  const x = (t: number) => (t / tMax) * 100;
  const y = (db: number) => 40 - ((Math.min(hi, Math.max(lo, db)) - lo) / (hi - lo)) * 38;
  const points = envelope.map((p) => `${x(p.t).toFixed(2)},${y(p.db).toFixed(2)}`).join(' ');
  const thr = y(features.noiseFloorDb + ONSET_ABOVE_FLOOR_DB);
  return (
    <figure className="breath-chart">
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" aria-label="Loudness over time">
        <rect x={0} y={0} width={x(NOISE_MS)} height={42} fill="var(--border)" opacity={0.5} />
        <line x1={0} x2={100} y1={thr} y2={thr} stroke="var(--muted)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        {features.onsetMs !== undefined && <line x1={x(features.onsetMs)} x2={x(features.onsetMs)} y1={0} y2={42} stroke="var(--accent)" strokeDasharray="1 2" vectorEffect="non-scaling-stroke" />}
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="legend">
        <span><i className="lg-baseline" /> room noise + 6 dB</span>
        <span>shaded: room-noise second</span>
      </figcaption>
    </figure>
  );
}

export default function BreathScreen() {
  const captureRef = useRef<BreathCapture | null>(null);
  const cuesRef = useRef<Cues | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<CapturePhase>('noise');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(-90);
  const [envelope, setEnvelope] = useState<EnvelopePoint[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [features, setFeatures] = useState<BreathFeatures | null>(null);
  const [assessment, setAssessment] = useState<BreathAssessment | null>(null);
  const [startedAt, setStartedAt] = useState<string>('');
  const [meter, setMeter] = useState('');
  const [order, setOrder] = useState<Order>('meter_first');
  const [attempt, setAttempt] = useState(1);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopAll = () => {
    captureRef.current?.cancel();
    captureRef.current = null;
    cuesRef.current?.dispose();
    cuesRef.current = null;
  };

  useEffect(() => {
    const onHide = () => document.hidden && stopAll();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', stopAll);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', stopAll);
      stopAll();
    };
  }, []);

  const start = () => {
    stopAll();
    setError(null);
    setSaved(false);
    setFeatures(null);
    setAssessment(null);
    setMeter('');
    setStage('noise');
    setElapsed(0);
    setPhase('capturing');
    setStartedAt(nowIso());
    // Both created synchronously inside the tap so iOS lets them start.
    cuesRef.current = createCues();
    let cued = false;
    let lastPaint = 0;
    const cap = startBreathCapture((p, ms, db) => {
      if (p === 'exhale' && !cued) {
        cued = true;
        cuesRef.current?.tick(); // "Blow now"
      }
      const now = performance.now();
      if (now - lastPaint > 50) {
        lastPaint = now;
        setStage(p);
        setElapsed(ms);
        setLevel(db);
      }
    });
    captureRef.current = cap;
    cap.done
      .then(({ envelope: env, settings: s }) => {
        cuesRef.current?.done();
        setTimeout(() => {
          cuesRef.current?.dispose();
          cuesRef.current = null;
        }, 1500);
        const f = extractBreathFeatures(env);
        setEnvelope(env);
        setSettings(s);
        setFeatures(f);
        setAssessment(assessBreathQuality(f, s));
        setPhase('done');
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        stopAll();
        setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        setPhase('error');
      });
  };

  const cancel = () => {
    stopAll();
    setPhase('idle');
  };

  const save = async () => {
    if (!features || !assessment) return;
    const device = deviceSummary();
    const browser = browserSummary();
    const sessionId = newId();
    const meterValue = parseMeter(meter);
    const endedAt = toLocalIso(new Date(new Date(startedAt).getTime() + NOISE_MS + EXHALE_MS));
    const audio: Measurement = {
      id: newId(),
      timestamp: startedAt,
      type: 'breath_audio',
      method: METHOD,
      device,
      browser,
      quality: assessment.quality,
      qualityReasons: assessment.qualityReasons,
      experimental: true,
      features: featuresRecord(features),
      sessionId,
      notes: `attempt ${attempt}; ${order === 'meter_first' ? 'meter first' : 'phone first'}`,
    };
    const records: Measurement[] = [audio];
    if (meterValue !== undefined) {
      records.push({
        id: newId(),
        timestamp: startedAt,
        type: 'peak_flow_meter',
        value: meterValue,
        unit: 'L/min',
        method: METER_METHOD,
        device: 'mechanical peak-flow meter',
        browser,
        quality: 'usable',
        qualityReasons: [],
        experimental: false,
        sessionId,
        notes: `Typed in from the peak-flow meter; attempt ${attempt}; ${order === 'meter_first' ? 'meter first' : 'phone first'}`,
      });
    }
    try {
      await repo.addSession({
        id: sessionId,
        timestamp: startedAt,
        endedAt,
        kind: 'breath_audio',
        device,
        browser,
        settings: {
          ...settings,
          processingVerified: assessment.processingVerified,
          attempt,
          order,
          envelope: envelope.map((p) => [p.t, Math.round(p.db * 10) / 10, p.clipped ? 1 : 0]),
        },
      });
      for (const m of records) await repo.addMeasurement(m);
      setSaved(true);
      setAttempt((a) => a + 1);
      setOrder((o) => (o === 'meter_first' ? 'phone_first' : 'meter_first'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const meterValue = parseMeter(meter);
  const levelPct = Math.max(0, Math.min(100, ((level + 90) / 90) * 100));
  const firstTip = assessment?.qualityReasons.map((r) => BREATH_TIPS[r]).find(Boolean);

  return (
    <section className="stack">
      <Link to="/lab" className="back">‹ Lab</Link>
      <div className="row between">
        <h1>Breathing audio experiment</h1>
        <ExperimentalBadge />
      </div>
      <p className="muted small">{BREATH_NO_FLOW}</p>

      {phase === 'idle' && (
        <div className="card stack">
          <h2>Before you start</h2>
          <ul>
            <li>Find a quiet spot: no talking, music or fans.</li>
            <li>Hold the phone at the same marked distance each time (for example a 30 cm string), mic toward your mouth.</li>
            <li>Stand or sit the same way each time. Breathe in fully.</li>
            <li>Stay quiet for 1 second, then on the beep and "Blow now", blow out as hard and fast as you can.</li>
          </ul>
          <p className="small">{BREATH_SAFETY}</p>
          <p className="muted small">Only loudness numbers are kept. No audio recording is saved. Turn off silent mode to hear the beep.</p>
          <button className="big" onClick={start}>Start</button>
        </div>
      )}

      {phase === 'capturing' && (
        <div className="card stack center">
          <p className="countdown small-countdown">{stage === 'noise' ? 'Stay quiet' : 'Blow now'}</p>
          <p className="muted">
            {stage === 'noise'
              ? `Measuring room noise… ${Math.max(0, Math.ceil((NOISE_MS - elapsed) / 1000))} s`
              : `${Math.max(0, Math.ceil((EXHALE_MS - elapsed) / 1000))} s left`}
          </p>
          <div className="meter" aria-label="Sound level">
            <div style={{ width: `${levelPct}%` }} />
          </div>
          <button className="secondary" onClick={cancel}>Cancel</button>
        </div>
      )}

      {phase === 'error' && (
        <div className="card stack">
          <p className="error">Microphone could not start: {error}</p>
          <button onClick={() => setPhase('idle')}>Back</button>
        </div>
      )}

      {phase === 'done' && features && assessment && (
        <div className="card stack">
          <div className="row between">
            <h2>{BREATH_RESULT}</h2>
            <StatusChip quality={assessment.quality} reasons={assessment.qualityReasons} />
          </div>
          <EnvelopeChart envelope={envelope} features={features} />
          {firstTip && <p className="small">Tip: {firstTip}</p>}
          <dl className="report-facts">
            <dt>Room noise</dt>
            <dd>{features.noiseFloorDb.toFixed(0)} dBFS</dd>
            <dt>Peak above room</dt>
            <dd>{features.peakAboveFloorDb.toFixed(0)} dB</dd>
            <dt>Time to peak</dt>
            <dd>{features.timeToPeakMs !== undefined ? `${features.timeToPeakMs} ms` : '—'}</dd>
            <dt>Audible exhale</dt>
            <dd>{(features.exhaleMs / 1000).toFixed(1)} s</dd>
            <dt>Mic processing off</dt>
            <dd>{assessment.processingVerified ? 'confirmed' : 'not confirmed by this phone'}</dd>
          </dl>

          <label className="field">
            <span className="field-label">{METER_LABEL}, L/min</span>
            <input className="text" type="number" inputMode="numeric" placeholder="e.g. 450" value={meter} onChange={(e) => setMeter(e.target.value)} disabled={saved} />
          </label>
          {meter.trim() !== '' && meterValue === undefined && <p className="error small">Enter the number shown on the meter (30–900).</p>}

          <div className="field">
            <span className="field-label">Order this attempt</span>
            <div className="segmented" role="group" aria-label="Order">
              {(['meter_first', 'phone_first'] as const).map((o) => (
                <button key={o} className={order === o ? 'on' : ''} aria-pressed={order === o} onClick={() => setOrder(o)} disabled={saved}>
                  {o === 'meter_first' ? 'Meter first' : 'Phone first'}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">Attempt number</span>
            <input className="text" type="number" inputMode="numeric" min={1} value={attempt} onChange={(e) => setAttempt(Math.max(1, Number(e.target.value) || 1))} disabled={saved} />
          </label>

          {error && <p className="error">{error}</p>}
          <div className="row">
            <button onClick={save} disabled={saved}>{saved ? 'Saved' : meterValue !== undefined ? 'Save attempt + meter reading' : 'Save attempt'}</button>
            <button className="secondary" onClick={start}>New attempt</button>
          </div>
          <p className="muted small">Failed attempts are saved too, so every attempt is counted. The order alternates automatically after each save.</p>
        </div>
      )}
    </section>
  );
}
