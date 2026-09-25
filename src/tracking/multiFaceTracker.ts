import { BoundingBox, FaceQuality } from '../types';
import type { TrackedFace } from '../types';
import { RawDetection } from '../vision/faceDetector';
import { evaluateFaceQuality } from '../vision/faceQuality';
import { KalmanBoxTracker } from './kalmanFilter';
import { hungarianMatch } from './hungarianMatcher';

export type TrackLifecycleState = 'TENTATIVE' | 'CONFIRMED' | 'LOST' | 'REMOVED';

export interface ExtendedTrackState extends TrackedFace {
  lifecycle: TrackLifecycleState; // CONFIRMED = matched recently, LOST = coasting / hidden
  detectionHits: number;
  lastDetectionTime: number; // performance.now() timeline
  smoothedBox: BoundingBox;
  kalmanTracker?: KalmanBoxTracker;
  descriptorHistory?: number[][];
  occlusionDurationMs?: number;
  /** 0..1, fades while coasting without detections (renderer uses it for alpha). */
  opacity: number;
  lastScore: number;
  lastQualityTime: number;
  lastDescriptorTime: number;
  lastAnalysisTime: number;
}

export interface TrackerConfig {
  /** Tracks not matched for this long stop being drawn (they keep coasting silently before that). */
  coastMs: number;
  /** Tracks not matched for this long are deleted (kept hidden until then, for re-acquisition). */
  maxAgeMs: number;
  /** A tentative track that is not confirmed within this time is discarded (kills 1-frame ghosts). */
  tentativeMs: number;
  /** A brand-new detection at/above this score is shown immediately (no 2-hit wait). */
  instantConfirmScore: number;
  minHitsToConfirm: number;
}

const DEFAULT_CONFIG: TrackerConfig = {
  coastMs: 450,
  maxAgeMs: 1800,
  tentativeMs: 350,
  instantConfirmScore: 0.72,
  minHitsToConfirm: 2,
};

type Fb = { x: number; y: number; width: number; height: number };

function iou(a: Fb, b: Fb): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.width * a.height + b.width * b.height - inter;
  return uni > 0 ? inter / uni : 0;
}

const cxOf = (b: Fb) => b.x + b.width / 2;
const cyOf = (b: Fb) => b.y + b.height / 2;
const sizeOf = (b: Fb) => Math.sqrt(Math.max(1, b.width * b.height));

/** Lower = better. >= 10 means "impossible match". */
function matchCost(pred: Fb, det: Fb, unseenMs = 0): number {
  const sT = sizeOf(pred), sD = sizeOf(det);
  const areaRatio = (det.width * det.height) / Math.max(1, pred.width * pred.height);
  if (areaRatio > 4 || areaRatio < 0.25) return 10;
  // The longer a track has gone unseen, the less we trust its prediction: widen the gate.
  const s = Math.max(sT, sD) * (1 + Math.min(unseenMs, 700) / 250);
  const d = Math.hypot(cxOf(pred) - cxOf(det), cyOf(pred) - cyOf(det));
  const i = iou(pred, det);
  if (i < 0.02 && d > 0.75 * s) return 10;
  const centerScore = Math.max(0, 1 - d / s);
  return 1 - (0.55 * i + 0.45 * centerScore);
}

/** True if a detection is just another proposal for a face we already own. */
function isDuplicateOf(existing: Fb, det: Fb): boolean {
  if (iou(existing, det) > 0.3) return true;
  const inside =
    cxOf(det) > existing.x && cxOf(det) < existing.x + existing.width &&
    cyOf(det) > existing.y && cyOf(det) < existing.y + existing.height;
  const ratio = (det.width * det.height) / Math.max(1, existing.width * existing.height);
  return inside && ratio > 0.12 && ratio < 3.5;
}

const NEUTRAL_QUALITY: FaceQuality = {
  overall: 80, resolutionScore: 80, brightnessScore: 80, contrastScore: 80, sharpnessScore: 80,
  poseScore: 80, yaw: 0, pitch: 0, roll: 0, isAcceptable: true, reasons: [],
};

export class MultiFaceTracker {
  private tracks: ExtendedTrackState[] = [];
  private nextId = 1;
  private cfg: TrackerConfig;

  constructor(maxAgeMs: number = 1800, cfg: Partial<TrackerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, maxAgeMs, ...cfg };
  }

  reset(): void {
    this.tracks = [];
  }

  private predictedBox(t: ExtendedTrackState, at: number): Fb {
    return t.kalmanTracker!.boxAt(at);
  }

  /**
   * @param detections boxes in source-frame pixels
   * @param tCapture   performance.now() when the analysed frame was grabbed
   * @param tNow       performance.now() when the detector returned
   */
  updateDetections(
    detections: RawDetection[],
    tCapture: number,
    tNow: number,
    sourceElement?: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement
  ): ExtendedTrackState[] {
    const usedTracks = new Set<number>();
    const usedDets = new Set<number>();

    // Priority order matters: established tracks pick their detections FIRST. Tentative tracks only
    // get what is left, so a stray duplicate proposal can never steal a real face from its track.
    const passes: Array<{ filter: (t: ExtendedTrackState) => boolean; maxCost: number }> = [
      { filter: (t) => t.lifecycle !== 'TENTATIVE' && tCapture - t.lastDetectionTime < this.cfg.coastMs, maxCost: 0.88 },
      { filter: (t) => t.lifecycle === 'TENTATIVE', maxCost: 0.8 },
      { filter: (t) => t.lifecycle !== 'TENTATIVE' && tCapture - t.lastDetectionTime >= this.cfg.coastMs, maxCost: 0.78 },
    ];

    for (const pass of passes) {
      const rows = this.tracks.map((t, i) => i).filter((i) => !usedTracks.has(i) && pass.filter(this.tracks[i]));
      const cols = detections.map((_, j) => j).filter((j) => !usedDets.has(j));
      if (!rows.length || !cols.length) continue;

      const cost = rows.map((ti) => {
        const pb = this.predictedBox(this.tracks[ti], tCapture);
        const unseen = Math.max(0, tCapture - this.tracks[ti].lastDetectionTime);
        return cols.map((dj) => matchCost(pb, detections[dj].box, unseen));
      });
      const { matches } = hungarianMatch(cost, pass.maxCost);
      for (const [r, c] of matches) {
        const ti = rows[r], dj = cols[c];
        usedTracks.add(ti);
        usedDets.add(dj);
        this.applyDetection(this.tracks[ti], detections[dj], tCapture, tNow, sourceElement);
      }
    }

    // Unmatched tracks: coast / expire.
    for (let i = 0; i < this.tracks.length; i++) {
      if (usedTracks.has(i)) continue;
      const t = this.tracks[i];
      t.missedFrames += 1;
      const since = tNow - t.lastDetectionTime;
      t.occlusionDurationMs = since;
      if (t.lifecycle === 'TENTATIVE') {
        if (since > this.cfg.tentativeMs) t.lifecycle = 'REMOVED';
      } else if (since > this.cfg.maxAgeMs) {
        t.lifecycle = 'REMOVED';
      } else {
        t.lifecycle = 'LOST';
      }
    }

    // New tracks — but never for a detection that is just a second box on a face we already own.
    for (let j = 0; j < detections.length; j++) {
      if (usedDets.has(j)) continue;
      const det = detections[j];
      const dup = this.tracks.some(
        (t) => t.lifecycle !== 'REMOVED' && isDuplicateOf(this.predictedBox(t, tCapture), det.box)
      );
      if (dup) continue;
      this.tracks.push(this.createTrack(det, tCapture, tNow, sourceElement));
    }

    // Safety net: two live tracks converged onto the same face -> keep the better one.
    for (let i = 0; i < this.tracks.length; i++) {
      for (let k = i + 1; k < this.tracks.length; k++) {
        const a = this.tracks[i], b = this.tracks[k];
        if (a.lifecycle === 'REMOVED' || b.lifecycle === 'REMOVED') continue;
        const ba = this.predictedBox(a, tNow), bb = this.predictedBox(b, tNow);
        // Same face if the boxes overlap a lot OR one is a smaller box sitting inside the other.
        if (iou(ba, bb) > 0.45 || isDuplicateOf(ba, bb) || isDuplicateOf(bb, ba)) {
          const keepA =
            (a.lifecycle === 'CONFIRMED') !== (b.lifecycle === 'CONFIRMED')
              ? a.lifecycle === 'CONFIRMED'
              : a.detectionHits >= b.detectionHits;
          const [keep, drop] = keepA ? [a, b] : [b, a];
          if (!keep.descriptor && drop.descriptor) {
            keep.descriptor = drop.descriptor;
            keep.identity = drop.identity;
          }
          drop.lifecycle = 'REMOVED';
        }
      }
    }

    this.tracks = this.tracks.filter((t) => t.lifecycle !== 'REMOVED');
    this.refreshBoxes(tNow);
    return this.tracks;
  }

  private applyDetection(
    t: ExtendedTrackState,
    det: RawDetection,
    tCapture: number,
    tNow: number,
    source?: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement
  ): void {
    t.kalmanTracker!.update(det.box, tCapture, det.score, tNow);
    t.detectionHits += 1;
    t.lastDetectionTime = tNow;
    t.lastSeen = tNow;
    t.lastScore = det.score;
    t.missedFrames = 0;
    t.occlusionDurationMs = 0;
    if (t.lifecycle !== 'CONFIRMED') {
      if (t.lifecycle === 'LOST' || t.detectionHits >= this.cfg.minHitsToConfirm) t.lifecycle = 'CONFIRMED';
    }
    // Quality needs canvas pixel reads: do it a few times per second, not on every detection.
    if (source && tNow - t.lastQualityTime > 500) {
      t.lastQualityTime = tNow;
      try {
        t.quality = evaluateFaceQuality(source, det.box, t.landmarks, det.score);
      } catch { /* keep previous quality */ }
    }
  }

  private createTrack(
    det: RawDetection,
    tCapture: number,
    tNow: number,
    source?: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement
  ): ExtendedTrackState {
    let quality = NEUTRAL_QUALITY;
    if (source) {
      try { quality = evaluateFaceQuality(source, det.box, undefined, det.score); } catch { /* neutral */ }
    }
    const instant = det.score >= this.cfg.instantConfirmScore;
    return {
      trackId: this.nextId++, // monotonic: an ID is never reused for a different face
      box: { ...det.box },
      smoothedBox: { ...det.box },
      predictedBox: { ...det.box },
      velocity: { vx: 0, vy: 0 },
      missedFrames: 0,
      detectionHits: 1,
      firstSeen: tNow,
      lastSeen: tNow,
      lastDetectionTime: tNow,
      lifecycle: instant ? 'CONFIRMED' : 'TENTATIVE',
      quality,
      kalmanTracker: new KalmanBoxTracker(det.box, tCapture),
      descriptorHistory: [],
      occlusionDurationMs: 0,
      opacity: 1,
      lastScore: det.score,
      lastQualityTime: tNow,
      lastDescriptorTime: 0,
      lastAnalysisTime: 0,
      age: { rawAge: 25, smoothedAge: 25, minAge: 20, maxAge: 30, confidence: 50, isLowQuality: true, history: [25] },
      expression: { dominant: 'neutral', confidence: 80, stability: 75, distribution: { neutral: 1 }, history: ['neutral'] },
      identity: { status: 'UNKNOWN', confidence: 0, distance: 1.0, sampleCount: 0, matchScore: 0 },
    };
  }

  /** Update every track's public `box` to what should be on screen at time `now`. */
  private refreshBoxes(now: number): void {
    for (const t of this.tracks) {
      const k = t.kalmanTracker!;
      const b = k.boxAt(now);
      t.box = b;
      t.smoothedBox = b;
      t.predictedBox = k.boxAt(now + 50);
      t.velocity = k.getVelocity();
      const since = now - t.lastDetectionTime;
      const fadeStart = this.cfg.coastMs * 0.4;
      t.opacity =
        since <= fadeStart ? 1 : Math.max(0, 1 - (since - fadeStart) / (this.cfg.coastMs - fadeStart));
    }
  }

  private isVisible(t: ExtendedTrackState, now: number): boolean {
    if (t.lifecycle === 'TENTATIVE' || t.lifecycle === 'REMOVED') return false;
    return now - t.lastDetectionTime < this.cfg.coastMs;
  }

  /**
   * Tracks to DRAW at time `now` (extrapolated, latency compensated). Call every animation frame.
   * Coasting tracks stay visible (fading) for coastMs, so a single missed detection no longer
   * makes the box flicker off and on.
   */
  getRenderTracks(now: number = performance.now()): ExtendedTrackState[] {
    this.refreshBoxes(now);
    return this.tracks.filter((t) => this.isVisible(t, now));
  }

  /** Visible tracks (same set as getRenderTracks). */
  getActiveTracks(): ExtendedTrackState[] {
    return this.getRenderTracks(performance.now());
  }

  getAllTracks(): ExtendedTrackState[] {
    return this.tracks;
  }

  getTrackById(id: number): ExtendedTrackState | undefined {
    return this.tracks.find((t) => t.trackId === id);
  }
}
