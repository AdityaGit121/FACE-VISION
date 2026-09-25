/**
 * Headless tracker benchmark: simulates a moving face seen through a realistic bad detector
 * (60 ms inference latency, position noise, 15% missed frames incl. bursts, duplicate partial
 * boxes, one-frame false positives) and measures what the USER SEES at 60 Hz.
 *
 *   npm run test:tracker
 */
import { MultiFaceTracker } from '../src/tracking/multiFaceTracker';
import { fileURLToPath } from 'node:url';

export interface Box { x: number; y: number; width: number; height: number }
export interface Det { box: Box; score: number }
export interface ShownBox { id: number; box: Box }

export interface Adapter {
  name: string;
  /** Called when a detection result arrives (frame captured at tCapture, result ready at tDone). */
  onDetections(dets: Det[], tCapture: number, tDone: number): void;
  /** What would be drawn at time t. */
  render(t: number): ShownBox[];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
}

type Face = (t: number) => Box;
export const faceA: Face = (t) => {
  const s = 150 + 20 * Math.sin(t / 1400);
  return { x: 320 + 210 * Math.sin(t / 480) - s / 2, y: 220 + 70 * Math.sin(t / 350) - s / 2, width: s, height: s * 1.1 };
};
export const faceB: Face = (t) => {
  const s = 120;
  return { x: 320 - 210 * Math.sin(t / 620) - s / 2, y: 400 + 20 * Math.cos(t / 500) - s / 2, width: s, height: s * 1.1 };
};

const cx = (b: Box) => b.x + b.width / 2;
const cy = (b: Box) => b.y + b.height / 2;

export function runScenario(makeAdapter: () => Adapter, faces: Face[], seed = 7, durationMs = 20000, opt: { noise?: number; miss?: number; latency?: number } = {}) {
  const NOISE = opt.noise ?? 1, MISS = opt.miss ?? 1;
  const ad = makeAdapter();
  const r = rng(seed);
  const LATENCY = opt.latency ?? 60, CYCLE = 50; // ms

  let nextDet = 0;
  const pending: Array<{ tCapture: number; tDone: number; dets: Det[] }> = [];
  let missBurst = 0;

  const errs: number[] = [];
  const jerk: number[] = [];
  let frames = 0, missed = 0, ghostFrames = 0, idSwitches = 0, maxBoxesPerFace = 0;
  const lastId = new Map<number, number>();
  const prevC = new Map<number, [number, number, number, number]>();

  for (let t = 0; t <= durationMs; t += 1000 / 60) {
    // Detector produces a result every CYCLE ms, delivered LATENCY ms after capture.
    while (nextDet <= t) {
      const tc = nextDet;
      const dets: Det[] = [];
      if (missBurst > 0) missBurst--;
      else if (r() < 0.04) missBurst = 2 + Math.floor(r() * 3);
      faces.forEach((f) => {
        if (missBurst > 0 || r() < 0.11 * MISS) return;
        const g = f(tc), s = Math.sqrt(g.width * g.height);
        const b: Box = {
          x: g.x + NOISE * (gauss(r) * 0.03 * s - gauss(r) * 0.02 * s),
          y: g.y + NOISE * gauss(r) * 0.03 * s,
          width: g.width * (1 + NOISE * gauss(r) * 0.045),
          height: g.height * (1 + NOISE * gauss(r) * 0.045),
        };
        dets.push({ box: b, score: 0.55 + r() * 0.4 });
        if (r() < 0.08) // partial duplicate proposal on the same face
          dets.push({ box: { x: b.x + 0.25 * s, y: b.y + 0.15 * s, width: b.width * 0.6, height: b.height * 0.6 }, score: 0.45 });
      });
      if (r() < 0.03) dets.push({ box: { x: r() * 500, y: r() * 300, width: 90, height: 100 }, score: 0.5 });
      pending.push({ tCapture: tc, tDone: tc + LATENCY, dets });
      nextDet += CYCLE;
    }
    while (pending.length && pending[0].tDone <= t) {
      const p = pending.shift()!;
      ad.onDetections(p.dets, p.tCapture, p.tDone);
    }

    const shown = ad.render(t);
    faces.forEach((f, fi) => {
      const g = f(t), s = Math.sqrt(g.width * g.height);
      const near = shown.filter((b) => Math.hypot(cx(b.box) - cx(g), cy(b.box) - cy(g)) < 0.6 * s);
      frames++;
      maxBoxesPerFace = Math.max(maxBoxesPerFace, near.length);
      if (near.length === 0) { missed++; return; }
      if (near.length > 1) ghostFrames++;
      const best = near.sort((a, b) =>
        Math.hypot(cx(a.box) - cx(g), cy(a.box) - cy(g)) - Math.hypot(cx(b.box) - cx(g), cy(b.box) - cy(g)))[0];
      errs.push(Math.hypot(cx(best.box) - cx(g), cy(best.box) - cy(g)) / s);
      const prev = lastId.get(fi);
      if (prev !== undefined && prev !== best.id) idSwitches++;
      lastId.set(fi, best.id);
      // Visual jitter: 2nd difference of drawn box (vs the same for the ground truth) in face-sizes.
      const cur: [number, number, number, number] = [cx(best.box), cy(best.box), best.box.width, best.box.height];
      const pc = prevC.get(fi + 100), pp = prevC.get(fi);
      if (pc && pp) jerk.push(Math.hypot(cur[0] - 2 * pc[0] + pp[0], cur[1] - 2 * pc[1] + pp[1]) / s);
      if (pc) prevC.set(fi, pc);
      prevC.set(fi + 100, cur);
    });
    // Ghost boxes not attached to any real face
    const stray = shown.filter((b) => !faces.some((f) => {
      const g = f(t), s = Math.sqrt(g.width * g.height);
      return Math.hypot(cx(b.box) - cx(g), cy(b.box) - cy(g)) < 0.6 * s;
    }));
    if (stray.length) ghostFrames++;
  }

  errs.sort((a, b) => a - b);
  jerk.sort((a, b) => a - b);
  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0;
  return {
    name: ad.name,
    meanErr: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length),
    p95Err: q(errs, 0.95),
    jitterP95: q(jerk, 0.95),
    missPct: (100 * missed) / frames,
    ghostPct: (100 * ghostFrames) / frames,
    maxBoxesPerFace,
    idSwitches,
  };
}

export function newAdapter(): Adapter {
  const tr = new MultiFaceTracker(1800);
  return {
    name: 'NEW  (Kalman + extrapolation)',
    onDetections: (dets, tc, td) => { tr.updateDetections(dets, tc, td); },
    render: (t) => tr.getRenderTracks(t).map((x) => ({ id: x.trackId, box: { ...x.box } })),
  };
}

export function printResults(title: string, rows: ReturnType<typeof runScenario>[]) {
  console.log(`\n${title}`);
  console.log('system'.padEnd(34), 'meanErr  p95Err  jitter95  missed%  ghost%  maxBoxes/face  idSwitch');
  for (const x of rows)
    console.log(
      x.name.padEnd(34),
      x.meanErr.toFixed(3).padStart(7), x.p95Err.toFixed(3).padStart(7), x.jitterP95.toFixed(4).padStart(9),
      x.missPct.toFixed(1).padStart(8), x.ghostPct.toFixed(1).padStart(7), String(x.maxBoxesPerFace).padStart(9), String(x.idSwitches).padStart(11)
    );
  console.log('(errors are in units of face size; lower is better everywhere)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const one = runScenario(newAdapter, [faceA]);
  const two = runScenario(newAdapter, [faceA, faceB], 11);
  printResults('Scenario 1: one face', [one]);
  printResults('Scenario 2: two faces crossing', [two]);
  const ok = one.maxBoxesPerFace === 1 && one.idSwitches === 0 && one.missPct < 2 && one.meanErr < 0.2 && two.idSwitches <= 3 && two.maxBoxesPerFace === 1;
  console.log(ok ? '\nPASS' : '\nFAIL');
  process.exit(ok ? 0 : 1);
}
