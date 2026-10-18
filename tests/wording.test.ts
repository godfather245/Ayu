import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../scripts/check-wording.mjs');
const COPY = readFileSync(resolve(__dirname, '../src/lib/copy.ts'), 'utf8');

function run(root: string): { code: number; output: string } {
  try {
    const out = execFileSync('node', [SCRIPT, '--root', root], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, output: out };
  } catch (e) {
    const err = e as { status: number; stderr: string };
    return { code: err.status, output: err.stderr };
  }
}

describe('check-wording', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ayu-wording-'));
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(join(root, 'src', 'lib', 'copy.ts'), COPY);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('fails on a file containing "abnormal" and passes once removed', () => {
    const file = join(root, 'src', 'Bad.tsx');
    writeFileSync(file, 'export const label = "Your result is abnormal";\n');
    const bad = run(root);
    expect(bad.code).toBe(1);
    expect(bad.output).toContain('src/Bad.tsx:1');

    writeFileSync(file, 'export const label = "Your logged measurement differs from your prior entries";\n');
    expect(run(root).code).toBe(0);
  });

  it('allowlists the verbatim disclaimer, including when repeated in README', () => {
    const disclaimer = COPY.match(/export const DISCLAIMER = '([^']*)'/)![1];
    expect(disclaimer).toContain('does not diagnose');
    writeFileSync(join(root, 'README.md'), `# App\n\n> ${disclaimer}\n`);
    expect(run(root).code).toBe(0);
  });

  it('still flags banned words next to the disclaimer', () => {
    writeFileSync(join(root, 'README.md'), 'This is hospital-grade.\n');
    const r = run(root);
    expect(r.code).toBe(1);
    expect(r.output).toContain('README.md:1');
  });

  it('uses word boundaries (normalize is fine, normal is not)', () => {
    writeFileSync(join(root, 'src', 'a.ts'), 'export const normalizeSignal = 1;\n');
    expect(run(root).code).toBe(0);
    writeFileSync(join(root, 'src', 'a.ts'), 'export const s = "Normal range";\n');
    expect(run(root).code).toBe(1);
  });

  it('passes on the real repo', () => {
    expect(run(resolve(__dirname, '..')).code).toBe(0);
  });
});
