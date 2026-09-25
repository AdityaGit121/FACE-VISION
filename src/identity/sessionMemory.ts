import { euclideanDistance } from './identityEngine';

/**
 * SESSION MEMORY — temporary, in-RAM face memory.
 *
 * Completely separate from enrolled identities (IndexedDB, permanent, named, used for target lock):
 *   - Session memory remembers every distinct face seen since "Start" as Person 1, Person 2, ...
 *   - A face that leaves the frame and comes back is recognised as the SAME person (by its
 *     128-d descriptor), not counted as a new one.
 *   - Nothing is written to disk. "Refresh" wipes it and starts a new session at Person 1.
 */

export interface SessionPerson {
  id: number;
  label: string;
  samples: number[][]; // diverse descriptors of this person (max MAX_SAMPLES)
  mean: number[];
  firstSeen: number;
  lastSeen: number;
  sightings: number;
  thumbnail?: string;
}

export interface SessionSnapshotPerson {
  id: number;
  label: string;
  thumbnail?: string;
  firstSeen: number;
  lastSeen: number;
  sightings: number;
}

export interface SessionSnapshot {
  active: boolean;
  sessionId: number;
  startedAt: number | null;
  people: SessionSnapshotPerson[];
}

export interface ResolveResult {
  id: number;
  label: string;
  created: boolean;
  distance: number;
}

// Distances are in the same units as the enrolled-identity thresholds (KNOWN <= 0.48).
export const SESSION_SAME = 0.5; // <= this: same person
export const SESSION_GRAY = 0.58; // between SAME and GRAY: keep nearest, but never create a new person
const SAMPLE_DIVERSITY = 0.12; // only store a sample if it adds something new
const MAX_SAMPLES = 10;

function personDistance(d: Float32Array | number[], p: SessionPerson): number {
  let min = Infinity;
  for (const s of p.samples) {
    const x = euclideanDistance(d, s);
    if (x < min) min = x;
  }
  const m = euclideanDistance(d, p.mean);
  return 0.7 * min + 0.3 * m; // same blend the enrolled matcher uses
}

export class SessionMemory {
  active = false;
  sessionId = 0;
  startedAt: number | null = null;
  private people: SessionPerson[] = [];
  private nextId = 1;
  /** Unmatched faces waiting for a second agreeing observation before becoming a new person. */
  private pending = new Map<number, { d: number[]; count: number }>();
  /** Bumped whenever people are added/removed or the session state changes (cheap change detection). */
  version = 0;

  /** Begin (or resume) memorising. Existing memory is kept when resuming a stopped session. */
  start(now = Date.now()): void {
    if (this.active) return;
    if (this.sessionId === 0) this.sessionId = 1;
    this.active = true;
    if (this.startedAt === null) this.startedAt = now;
    this.version++;
  }

  /** Pause memorising (memory is kept until refresh). */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.version++;
  }

  /** Wipe everything and start a brand-new session. */
  refresh(now = Date.now()): void {
    this.people = [];
    this.pending.clear();
    this.nextId = 1;
    this.sessionId += 1;
    this.startedAt = now;
    this.active = true;
    this.version++;
  }

  /** True while this face is waiting for confirmation (UI can show 'Identifying...'). */
  isPending(trackKey: number): boolean {
    return this.pending.has(trackKey);
  }

  get count(): number {
    return this.people.length;
  }

  getPerson(id: number): SessionPerson | undefined {
    return this.people.find((p) => p.id === id);
  }

  /**
   * Decide which session person a face belongs to.
   * @param descriptor   averaged 128-d descriptor of the tracked face
   * @param currentId    person this track was already assigned to (gives hysteresis, no flip-flopping)
   * @param takenIds     persons currently owned by OTHER visible tracks (two different bodies in the
   *                     same frame are different people unless the descriptors are near-identical)
   */
  resolve(
    descriptor: Float32Array | number[],
    opts: { currentId?: number; takenIds?: Set<number>; thumbnail?: () => string | undefined; now?: number; trackKey?: number } = {}
  ): ResolveResult | null {
    if (!this.active || !descriptor || descriptor.length === 0) return null;
    const now = opts.now ?? Date.now();
    const taken = opts.takenIds ?? new Set<number>();

    const ranked = this.people
      .map((p) => ({ p, d: personDistance(descriptor, p) }))
      .sort((a, b) => a.d - b.d);

    let chosen: { p: SessionPerson; d: number } | null = null;

    // 1) Hysteresis: keep the current person unless another is clearly, confidently better.
    if (opts.currentId !== undefined) {
      const cur = ranked.find((r) => r.p.id === opts.currentId);
      if (cur && cur.d <= SESSION_GRAY) {
        const better = ranked.find((r) => r.p.id !== cur.p.id && r.d <= 0.45 && r.d < cur.d - 0.12 && !taken.has(r.p.id));
        chosen = better ?? cur;
      }
    }

    // 2) Otherwise nearest person that isn't already someone else's face in this frame.
    if (!chosen) {
      for (const r of ranked) {
        const limit = taken.has(r.p.id) ? 0.35 : SESSION_GRAY;
        if (r.d <= limit) { chosen = r; break; }
      }
    }

    if (chosen) {
      if (opts.trackKey !== undefined) this.pending.delete(opts.trackKey);
      this.absorb(chosen.p, descriptor, chosen.d, now);
      return { id: chosen.p.id, label: chosen.p.label, created: false, distance: chosen.d };
    }

    // 3) Nobody close enough. A single blurry / odd-angle frame must not create a phantom person:
    //    require a second observation from the same track that agrees with the first.
    if (opts.trackKey !== undefined) {
      const pend = this.pending.get(opts.trackKey);
      if (!pend || euclideanDistance(descriptor, pend.d) > SESSION_SAME) {
        this.pending.set(opts.trackKey, { d: Array.from(descriptor), count: 1 });
        return null; // still "identifying"
      }
      this.pending.delete(opts.trackKey);
    }

    // 4) A genuinely new person.
    const person: SessionPerson = {
      id: this.nextId++,
      label: '',
      samples: [Array.from(descriptor)],
      mean: Array.from(descriptor),
      firstSeen: now,
      lastSeen: now,
      sightings: 1,
      thumbnail: opts.thumbnail?.(),
    };
    person.label = `Person ${person.id}`;
    this.people.push(person);
    this.version++;
    return { id: person.id, label: person.label, created: true, distance: ranked[0]?.d ?? 1 };
  }

  private absorb(p: SessionPerson, d: Float32Array | number[], dist: number, now: number): void {
    p.lastSeen = now;
    p.sightings++;
    // Learn only from confident matches, and only when the sample adds diversity.
    if (dist <= SESSION_SAME) {
      const minToSamples = Math.min(...p.samples.map((s) => euclideanDistance(d, s)));
      if (minToSamples > SAMPLE_DIVERSITY) {
        p.samples.push(Array.from(d));
        if (p.samples.length > MAX_SAMPLES) p.samples.splice(1, 1); // keep the first (reference) sample
        const n = p.samples.length;
        p.mean = p.samples[0].map((_, i) => p.samples.reduce((a, s) => a + s[i], 0) / n);
      }
    }
  }

  touch(id: number, now = Date.now()): void {
    const p = this.getPerson(id);
    if (p) p.lastSeen = now; // deliberately does not bump `version`
  }

  snapshot(): SessionSnapshot {
    return {
      active: this.active,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      people: this.people.map((p) => ({
        id: p.id,
        label: p.label,
        thumbnail: p.thumbnail,
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
        sightings: p.sightings,
      })),
    };
  }
}

export const sessionMemory = new SessionMemory();
