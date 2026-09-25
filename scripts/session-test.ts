/**
 * Session memory test with synthetic 128-d "descriptors":
 * 3 people, noisy observations, leave-and-return, two people in frame at once, then refresh.
 *   npx tsx scripts/session-test.ts
 */
import { SessionMemory } from '../src/identity/sessionMemory';

let seed = 5;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
const unit = () => { const v = Array.from({ length: 128 }, gauss); const n = Math.hypot(...v); return v.map((x) => x / n); };
// people are ~ 0.9 apart (real face-api: different people are typically 0.7-1.1 apart)
const identity = [unit(), unit(), unit()].map((v) => v.map((x) => x * 0.65));
// per-observation noise: ~0.28 distance (real same-person distances are 0.2-0.4)
const observe = (i: number, noise = 0.28) => identity[i].map((x) => x + (gauss() * noise) / Math.sqrt(128));

const s = new SessionMemory();
const check = (name: string, ok: boolean) => { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) process.exitCode = 1; };

check('inactive session memorises nothing', s.resolve(observe(0), { trackKey: 1 }) === null && s.count === 0);
s.start();

const owner = new Map<number, number>(); // person index -> session id
for (let round = 0; round < 40; round++) {           // each person leaves and returns many times
  const i = round % 3;
  let r = s.resolve(observe(i), { trackKey: 100 + round });
  r = r ?? s.resolve(observe(i), { trackKey: 100 + round })!; // 2nd observation confirms
  if (!owner.has(i)) owner.set(i, r.id);
  if (owner.get(i) !== r.id) check(`person ${i} re-identified on return (round ${round})`, false);
}
check('3 people -> exactly 3 session persons after 40 leave/return events', s.count === 3);
check('labels are Person 1..3', s.snapshot().people.map((p) => p.label).join() === 'Person 1,Person 2,Person 3');

// two different people in the same frame at once must stay different
const a = s.resolve(observe(0), { takenIds: new Set(), trackKey: 1 })!;
const b = s.resolve(observe(1), { takenIds: new Set([a.id]), trackKey: 2 })!;
check('two people in one frame keep separate ids', a.id !== b.id && s.count === 3);

// hysteresis: a bad frame (heavy noise) must not spawn a new person
const bad = s.resolve(observe(2, 0.9), { currentId: owner.get(2), trackKey: 3 });
check('one very noisy frame does not create a 4th person', (bad === null || !bad.created) && s.count === 3);
const k = 'a brand-new face confirmed by two agreeing frames becomes Person 4';
const fresh = unit().map((x) => x * 0.65);
const f1 = s.resolve(fresh.map((x) => x + gauss() * 0.02), { trackKey: 9 });
const f2 = s.resolve(fresh.map((x) => x + gauss() * 0.02), { trackKey: 9 });
check(k, f1 === null && !!f2 && f2.created && f2.label === 'Person 4');
s.refresh(); s.start(); // reset to 3 for the stop/refresh checks below
for (let i = 0; i < 3; i++) { s.resolve(identity[i], { trackKey: 50 + i }); s.resolve(identity[i], { trackKey: 50 + i }); }

// stop keeps memory; refresh wipes it
s.stop();
check('stop keeps memory', s.count === 3 && !s.active);
s.refresh();
check('refresh wipes memory and starts new session', s.count === 0 && s.active && s.sessionId >= 2);
s.resolve(observe(2), { trackKey: 77 });
const first = s.resolve(observe(2), { trackKey: 77 })!;
check('after refresh numbering restarts at Person 1', first.label === 'Person 1');
