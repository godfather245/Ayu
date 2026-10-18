// Paired-agreement statistics for bench checks (phone vs reference device). Reports error, never correlation alone.
// Bland-Altman bias and 95% limits of agreement; typical error of the estimate (TEE) from a simple linear fit.

export interface Pair {
  phone: number;
  reference: number;
}

export interface Agreement {
  n: number;
  meanSignedError: number; // phone − reference
  medianAbsError: number;
  minError: number;
  maxError: number;
  loaLow: number; // bias − 1.96·SD
  loaHigh: number; // bias + 1.96·SD
  withinTolerance: number; // count with |error| ≤ tolerance
  tolerance: number;
  tee?: number; // typical error of the estimate, needs n ≥ 3
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function sampleSd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Typical error of the estimate: SD of residuals from regressing reference on phone (n − 2 degrees of freedom). */
export function typicalErrorOfEstimate(pairs: Pair[]): number | undefined {
  if (pairs.length < 3) return undefined;
  const x = pairs.map((p) => p.phone);
  const y = pairs.map((p) => p.reference);
  const mx = avg(x);
  const my = avg(y);
  const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  if (sxx === 0) return undefined;
  const slope = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / sxx;
  const intercept = my - slope * mx;
  const sse = y.reduce((s, v, i) => s + (v - (intercept + slope * x[i])) ** 2, 0);
  return Math.sqrt(sse / (pairs.length - 2));
}

export function agreement(pairs: Pair[], tolerance: number): Agreement | undefined {
  if (!pairs.length) return undefined;
  const errors = pairs.map((p) => p.phone - p.reference);
  const bias = avg(errors);
  const sd = sampleSd(errors);
  return {
    n: pairs.length,
    meanSignedError: bias,
    medianAbsError: median(errors.map(Math.abs)),
    minError: Math.min(...errors),
    maxError: Math.max(...errors),
    loaLow: bias - 1.96 * sd,
    loaHigh: bias + 1.96 * sd,
    withinTolerance: errors.filter((e) => Math.abs(e) <= tolerance).length,
    tolerance,
    tee: typicalErrorOfEstimate(pairs),
  };
}

/** Points for a Bland-Altman plot: x = mean of the two methods, y = difference (phone − reference). */
export const blandAltmanPoints = (pairs: Pair[]) => pairs.map((p) => ({ x: (p.phone + p.reference) / 2, y: p.phone - p.reference }));
