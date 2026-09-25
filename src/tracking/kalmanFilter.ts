import { BoundingBox } from '../types';

/**
 * Time-based constant-velocity Kalman filter for a face bounding box.
 *
 * Replaces the old filter, which stepped once per detection cycle with dt = 1 (so "velocity" had
 * no fixed unit when the detector speed changed) and stacked three extra smoothers on top
 * (EMA + integer rounding + renderer lerp) => lag and quantised, late boxes.
 *
 * This version:
 *  - uses real timestamps (ms) so dt is always right;
 *  - keeps a proper 2x2 covariance per axis [position, velocity] for cx, cy, w, h;
 *  - scales noise by face size (resolution independent) and by detection score;
 *  - can be queried at ANY time (extrapolate) so the renderer draws the box where the face is
 *    NOW, compensating inference latency;
 *  - hides the snap of each measurement correction with a decaying display offset
 *    (zero lag in steady state, no visible jumps).
 */

export interface KalmanTuning {
  posAccel: number;   // unmodelled accel std for cx/cy, face-sizes / s^2
  sizeAccel: number;  // same for w/h
  measPos: number;    // measurement std for cx/cy as fraction of face size (score = 1)
  measSize: number;   // same for w/h
  extrapolationTau: number; // s, velocity damping used only when extrapolating ahead
  maxHorizonS: number;      // never extrapolate further than this past the last measurement
  offsetDecayMs: number;    // fade time-constant of the correction offset
}

export const DEFAULT_KALMAN_TUNING: KalmanTuning = {
  posAccel: 9,
  sizeAccel: 2.5,
  measPos: 0.035,
  measSize: 0.06,
  extrapolationTau: 0.35,
  maxHorizonS: 0.4,
  offsetDecayMs: 80,
};

const MIN_SIZE = 8;

class AxisFilter {
  p: number;
  v = 0;
  P00: number;
  P01 = 0;
  P11: number;

  constructor(p0: number, posStd: number, velStd: number) {
    this.p = p0;
    this.P00 = posStd * posStd;
    this.P11 = velStd * velStd;
  }

  predict(dt: number, accelStd: number): void {
    if (dt <= 0) return;
    const q = accelStd * accelStd;
    this.p += this.v * dt;
    const P00 = this.P00 + dt * (2 * this.P01 + dt * this.P11) + (q * dt * dt * dt) / 3;
    const P01 = this.P01 + dt * this.P11 + (q * dt * dt) / 2;
    const P11 = this.P11 + q * dt;
    this.P00 = P00; this.P01 = P01; this.P11 = P11;
  }

  update(z: number, measStd: number): void {
    const S = this.P00 + measStd * measStd;
    const K0 = this.P00 / S;
    const K1 = this.P01 / S;
    const y = z - this.p;
    this.p += K0 * y;
    this.v += K1 * y;
    const P00 = (1 - K0) * this.P00;
    const P01 = (1 - K0) * this.P01;
    const P11 = this.P11 - K1 * this.P01;
    this.P00 = P00; this.P01 = P01; this.P11 = Math.max(1e-6, P11);
  }
}

export interface FloatBox { cx: number; cy: number; w: number; h: number }

export class KalmanBoxTracker {
  private axes: AxisFilter[]; // cx, cy, w, h
  private t: number;
  private off: [number, number, number, number] = [0, 0, 0, 0];
  private offT: number;
  private tuning: KalmanTuning;
  public hits = 1;

  constructor(box: BoundingBox, t: number, tuning: KalmanTuning = DEFAULT_KALMAN_TUNING) {
    this.tuning = tuning;
    this.t = t;
    this.offT = t;
    const w = Math.max(MIN_SIZE, box.width);
    const h = Math.max(MIN_SIZE, box.height);
    const s = Math.sqrt(w * h);
    this.axes = [
      new AxisFilter(box.x + box.width / 2, 0.05 * s, 3 * s),
      new AxisFilter(box.y + box.height / 2, 0.05 * s, 3 * s),
      new AxisFilter(w, 0.08 * s, 1 * s),
      new AxisFilter(h, 0.08 * s, 1 * s),
    ];
  }

  size(): number {
    return Math.sqrt(Math.max(MIN_SIZE, this.axes[2].p) * Math.max(MIN_SIZE, this.axes[3].p));
  }

  get stateTime(): number { return this.t; }

  private predictTo(t: number): void {
    const dt = (t - this.t) / 1000;
    if (dt <= 0) return;
    const s = this.size();
    const { posAccel, sizeAccel } = this.tuning;
    this.axes[0].predict(dt, posAccel * s);
    this.axes[1].predict(dt, posAccel * s);
    this.axes[2].predict(dt, sizeAccel * s);
    this.axes[3].predict(dt, sizeAccel * s);
    this.t = t;
  }

  /**
   * @param tCapture when the frame was captured (the measurement's true time)
   * @param tNow     current display time (used to hide the correction snap)
   */
  update(box: BoundingBox, tCapture: number, score: number, tNow: number): void {
    const before = this.displayAt(tNow);
    this.predictTo(tCapture);

    const s = this.size();
    const conf = Math.min(1, Math.max(0.3, score));
    const posStd = (this.tuning.measPos * s) / conf;
    const sizeStd = (this.tuning.measSize * s) / conf;

    this.axes[0].update(box.x + box.width / 2, posStd);
    this.axes[1].update(box.y + box.height / 2, posStd);
    this.axes[2].update(Math.max(MIN_SIZE, box.width), sizeStd);
    this.axes[3].update(Math.max(MIN_SIZE, box.height), sizeStd);
    this.axes[2].p = Math.max(MIN_SIZE, this.axes[2].p);
    this.axes[3].p = Math.max(MIN_SIZE, this.axes[3].p);
    this.hits += 1;

    const after = this.extrapolate(tNow);
    const o: [number, number, number, number] = [
      before.cx - after.cx, before.cy - after.cy, before.w - after.w, before.h - after.h,
    ];
    // Big jump = real motion / re-acquisition: follow it, don't fake smoothness.
    this.off = Math.hypot(o[0], o[1]) > 0.75 * s ? [0, 0, 0, 0] : o;
    this.offT = tNow;
  }

  extrapolate(t: number): FloatBox {
    const horizon = Math.min(this.tuning.maxHorizonS, Math.max(0, (t - this.t) / 1000));
    const tau = this.tuning.extrapolationTau;
    const f = tau * (1 - Math.exp(-horizon / tau));
    return {
      cx: this.axes[0].p + this.axes[0].v * f,
      cy: this.axes[1].p + this.axes[1].v * f,
      w: Math.max(MIN_SIZE, this.axes[2].p + this.axes[2].v * f),
      h: Math.max(MIN_SIZE, this.axes[3].p + this.axes[3].v * f),
    };
  }

  displayAt(t: number): FloatBox {
    const e = this.extrapolate(t);
    const k = t > this.offT ? Math.exp(-(t - this.offT) / this.tuning.offsetDecayMs) : 1;
    return {
      cx: e.cx + this.off[0] * k,
      cy: e.cy + this.off[1] * k,
      w: Math.max(MIN_SIZE, e.w + this.off[2] * k),
      h: Math.max(MIN_SIZE, e.h + this.off[3] * k),
    };
  }

  boxAt(t: number): BoundingBox {
    const d = this.displayAt(t);
    return { x: d.cx - d.w / 2, y: d.cy - d.h / 2, width: d.w, height: d.h };
  }

  getVelocity(): { vx: number; vy: number } {
    return { vx: this.axes[0].v, vy: this.axes[1].v };
  }
}
