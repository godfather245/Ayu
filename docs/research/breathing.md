# Breathing audio experiment — research grounding

Every design choice in `src/features/breathing/*` traces to a source below. Where a number is ours (no paper gives it), it is marked **TUNE** in code and must be checked on the bench.

## What the product does — and does not

The phone records a forced exhale and stores **audio features + quality**. It never outputs a flow value (L/min). The only L/min in the app is the reading typed in from the mechanical peak-flow meter. (Notion: Phase 4, Claims, Evidence & Safety.)

**Why no phone L/min (grounded):** sound amplitude vs airflow follows a power law `A = k·F^α`, but the exponent varies widely between people. On an iPhone, expiration α = 2.632 ± 0.711 (N = 9), with Galaxy S4 α = 1.939 ± 0.900; the authors note means lie between α = 1 and 3 and normalised amplitude per subject [2]. A single phone-wide conversion is therefore not defensible; SpiroSmart needed regression over many features and per-user calibration helped [1]. SpiroCall reports agreement with clinical spirometers but used purpose-built processing, a vortex whistle option and a 50-participant evaluation [3] — not something a simple loudness feature replicates.

## Sources and what we took

| # | Source | Used for |
|---|---|---|
| 1 | Larson EC, Goel M, Borriello G, Heltshe S, Rosenfeld M, Patel SN. **SpiroSmart: Using a Microphone to Measure Lung Function on a Mobile Phone.** UbiComp 2012. doi:10.1145/2370216.2370261 | Envelope as flow proxy ("measure of overall signal power at low frequency"); envelope smoothing with a **Savitzky–Golay filter, order 3, size 11**; 30 ms framing; recording at arm's length with on-screen coaching; **only ~the first 3 s of a blow is audible** and the first 2 s carry 90–100% of the flow-volume loop incl. PEF (so features focus on onset/peak, and `exhaleMs` is the audible part, not FVC); **the setting must remain relatively quiet** (→ `noisy_room`). |
| 2 | Reljin N, Reyes BA, Chon KH. **Tracheal Sounds Acquisition Using Smartphones.** Sensors 2014;14(8):13830. PMC4179049 | Power-law amplitude–flow relation and its between-subject spread (see above); 4th-order Butterworth band-pass applied zero-phase (100–3000 Hz in their setup); background (apnea) spectrum subtracted (→ we measure 1 s of room noise first and express features **above the noise floor**). Limitations: larger discrepancies at low flow at start/end of breaths. |
| 3 | Goel M, Saba E, Stiber M, Whitmire E, Fromm J, Larson EC, Borriello G, Patel SN. **SpiroCall: Measuring Lung Function over a Phone Call.** CHI 2016 | Context only: audio spirometry can agree with clinical devices under a purpose-built pipeline (≈6.2% from clinical spirometers per UW coverage). Not replicated here. |
| 4 | Viswanath V, Garrison J, Patel S. **SpiroConfidence: Determining the Validity of Smartphone Based Spirometry Using Machine Learning.** EMBC 2018 | Invalid-effort causes to gate on: **background sounds (e.g. voice), coughs, short breaths** (→ `noisy_room`, `second_burst`, `too_quiet`). We use simple rules, not their ML models. |
| 5 | ATS/ERS spirometry acceptability (2019 update), via secondary summaries; Ramos et al. on rise time | **Explosive start**: time to PEF < 0.12 s; rise time 10–90% of PEF ≤ 0.150 s as an objective check; **no cough in the first second**. We record `riseTime10to90Ms` and gate `late_start` at 0.3 s after *audio* onset (more lenient, TUNE: audio onset includes pre-flow noise). |
| 6 | Quanjer PH et al. **Peak expiratory flow: conclusions and recommendations of a Working Party of the ERS.** Eur Respir J 1997;10(Suppl 24):2s–8s; ERS SpiroXpert PEF page (secondary) | PEF definition (maximal forced expiration from full inflation); **report the largest of 3 correct efforts; top two within 40 L/min, else up to 2 more** (secondary source). The app follows the meter's own instructions and never asks for extra blows. |
| 7 | MDN: `MediaTrackConstraints.autoGainControl` / `getSettings()`; our Gate A probe on the demo iPhone | Request `echoCancellation`, `noiseSuppression`, `autoGainControl` = false and **verify via `getSettings()`**. Probe result: iOS reported `echoCancellation: false`; `noiseSuppression`, `autoGainControl`, `channelCount` **not reported** → stored as "unverified" with each session. |

## Pipeline (and where each step comes from)

1. **Capture** (Notion DR-28, [7]): mic with processing off → `AudioContext` → 4th-order Butterworth band-pass **200–4000 Hz** (Notion Technical Reference band; filter order/type as in [2]) → RMS level in dBFS every **10 ms**, plus clipping flag from the unfiltered signal. **1 s room noise, then 6 s exhale.** No raw audio kept.
2. **Smooth** ([1]): Savitzky–Golay order 3, window 11 on the dB envelope.
3. **Features** (Notion DR-29, [1][2][5]): `noiseFloorDb` (median of first 1 s), onset at floor + 6 dB, `peakAboveFloorDb`, `timeToPeakMs`, `riseTime10to90Ms` (linear amplitude above floor), `riseSlopeDbPerMs`, `exhaleMs`, `areaDbS`, `clipped`, `secondBurst`.
4. **Quality** (Notion DR-30, [1][4][5]): `too_quiet` (failed), `noisy_room`, `late_start`, `clipped`, `second_burst`, `processing_not_disabled` → usable / low / failed with a retry tip.
5. **Pairing** (Notion DR-31, [6]): `breath_audio` (features, no value) + `peak_flow_meter` (typed-in L/min) share a `sessionId`; order (meter first / phone first) alternates.

## Known limits

- Distance and lip posture change the sound; SpiroSmart found a mouthpiece/sling did not significantly improve most measures but participants varied distance [1]. We ask for a fixed, marked distance.
- iOS does not report whether noise suppression / AGC were honored; sessions record this as unverified.
- Thresholds marked TUNE come from reasoning about dBFS levels, not from a paper.
