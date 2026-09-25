import { BoundingBox, Point2D, TargetState, IdentityProfile, DiagnosticsTelemetry } from '../types';
import {
  FaceDetectorBackend,
  TinyFaceBackend,
  RawDetection,
  analyzeFaceCrop,
  cropFaceRegion,
  mapDetectionToDisplayCoordinates,
  DetectorConfig,
} from './faceDetector';
import { YoloFaceBackend } from './yoloFaceDetector';
import { MultiFaceTracker, ExtendedTrackState } from '../tracking/multiFaceTracker';
import { targetTracker } from '../tracking/targetTracker';
import { euclideanDistance, matchEmbeddingAgainstProfiles } from '../identity/identityEngine';
import { sessionMemory, SessionSnapshot } from '../identity/sessionMemory';
import { updateAgeEstimation, updateExpressionAnalysis } from './temporalSmoothing';
import { getModelStageStatus } from './modelLoader';

export interface VisionEngineConfig {
  detectorConfig: DetectorConfig; // kept for API compatibility (backends pick their own settings)
  showLandmarks: boolean;
  maxProcessingWidth: number;
  /** 'auto' = YOLO if available, else Tiny. */
  detector: 'auto' | 'yolo' | 'tiny';
}

export interface SessionView extends SessionSnapshot {
  /** Session persons currently visible in the frame. */
  visibleIds: number[];
}

/** One live measurement streamed to the auto-enrollment wizard. */
export interface EnrollSample {
  faceCount: number;
  trackId?: number;
  descriptor?: Float32Array;
  landmarks?: Point2D[];
  box?: BoundingBox;
  t: number;
}

export type VisionStateCallback = (data: {
  tracks: ExtendedTrackState[];
  targetState: TargetState;
  telemetry: DiagnosticsTelemetry;
  session: SessionView;
}) => void;

type MediaSource = HTMLVideoElement | HTMLImageElement;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolves when the video shows a NEW frame (so we never analyse the same frame twice). */
function nextFrame(source: MediaSource): Promise<void> {
  if (source instanceof HTMLVideoElement && 'requestVideoFrameCallback' in source) {
    return new Promise((resolve) => {
      let done = false;
      const id = source.requestVideoFrameCallback(() => { done = true; resolve(); });
      // Safety net: background tabs / paused video never fire the callback.
      setTimeout(() => {
        if (!done) { try { source.cancelVideoFrameCallback(id); } catch { /* ignore */ } resolve(); }
      }, 120);
    });
  }
  if (source instanceof HTMLImageElement) return sleep(200); // still image: 5 Hz is plenty
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export class VisionEngine {
  private isRunning = false;
  private runToken = 0;

  private offscreen: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;

  public tracker: MultiFaceTracker;
  private enrolledProfiles: IdentityProfile[] = [];

  private config: VisionEngineConfig = {
    detectorConfig: { inputSize: 320, scoreThreshold: 0.38 },
    showLandmarks: false,
    maxProcessingWidth: 512,
    detector: 'auto',
  };

  private backend: FaceDetectorBackend = new TinyFaceBackend();
  private yoloInit: Promise<void> | null = null;

  private lastAnalysisTime = 0;
  private analysisCursor = 0;

  // Telemetry
  private camFrames = 0;
  private lastCamCalc = performance.now();
  private cameraFps = 0;
  private detCycles = 0;
  private lastDetCalc = performance.now();
  private detectionFps = 0;
  private detLatency = 0;
  private trackLatency = 0;
  private embedLatency = 0;
  private totalLatency = 0;

  private onStateUpdate?: VisionStateCallback;
  private emitTimer: ReturnType<typeof setInterval> | null = null;
  private lastEmittedIds = '';
  private enrollSink: ((s: EnrollSample) => void) | null = null;

  constructor() {
    this.offscreen = document.createElement('canvas');
    this.offscreenCtx = this.offscreen.getContext('2d', { willReadFrequently: true });
    this.tracker = new MultiFaceTracker(1800);
  }

  get detectorName(): string {
    const b = this.backend as any;
    return b.executionProvider ? `${this.backend.name} (${b.executionProvider})` : this.backend.name;
  }

  setEnrolledProfiles(profiles: IdentityProfile[]): void {
    this.enrolledProfiles = profiles;
    for (const t of this.tracker.getAllTracks()) {
      if (t.descriptor) t.identity = matchEmbeddingAgainstProfiles(t.descriptor, profiles);
    }
  }

  setConfig(partial: Partial<VisionEngineConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  setLandmarksEnabled(enabled: boolean): void {
    this.config.showLandmarks = enabled;
  }

  // --- Session memory (temporary, separate from enrolled identities) -------------------------
  startSession(): void {
    sessionMemory.start();
    this.emitState(false);
  }
  stopSession(): void {
    sessionMemory.stop();
    this.emitState(false);
  }
  /** Wipe the session memory and start over; visible faces are re-identified as Person 1, 2, ... */
  refreshSession(): void {
    sessionMemory.refresh();
    for (const t of this.tracker.getAllTracks()) {
      t.sessionPersonId = undefined;
      t.sessionLabel = undefined;
    }
    this.emitState(false);
  }

  /** While set, the engine streams fresh descriptor + landmark samples of the largest face. */
  setEnrollmentSink(sink: ((s: EnrollSample) => void) | null): void {
    this.enrollSink = sink;
  }

  /** Tracks to draw at time `now`, extrapolated to compensate inference latency. Call from rAF. */
  getRenderTracks(now: number = performance.now()): ExtendedTrackState[] {
    return this.tracker.getRenderTracks(now);
  }

  private ensureYolo(): void {
    if (this.config.detector === 'tiny' || this.yoloInit) return;
    this.yoloInit = YoloFaceBackend.create()
      .then((be) => {
        this.backend = be; // hot-swap: Tiny keeps running until YOLO is compiled and warmed up
        console.info(`[vision] detector: ${this.detectorName}`);
      })
      .catch((err) => {
        console.warn('[vision] YOLO unavailable, staying on TinyFaceDetector:', err);
      });
  }

  start(getMediaSource: () => MediaSource | null, onUpdate: VisionStateCallback): void {
    if (this.isRunning) return;
    this.isRunning = true;
    const token = ++this.runToken;
    this.onStateUpdate = onUpdate;
    this.ensureYolo();

    this.detectionLoop(getMediaSource, token);

    // UI state at ~7 Hz (or instantly when faces appear/disappear). The canvas does NOT depend on
    // this: it reads getRenderTracks() every animation frame.
    this.emitTimer = setInterval(() => this.emitState(false), 140);
  }

  stop(): void {
    this.isRunning = false;
    this.runToken++;
    if (this.emitTimer) clearInterval(this.emitTimer);
    this.emitTimer = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Single-flight, frame-synchronised pipeline:
  //   wait for new frame -> snapshot -> detect -> track -> (optional) one analysis job -> repeat
  // Everything is serialised, so detector and recognition nets never fight for the GPU, and a slow
  // cycle can never pile up work (the old code started overlapping async jobs).
  // ---------------------------------------------------------------------------------------------
  private async detectionLoop(getSource: () => MediaSource | null, token: number): Promise<void> {
    // Persistent camera-FPS counter (independent of how fast we manage to analyse).
    const counted = getSource();
    if (counted instanceof HTMLVideoElement && 'requestVideoFrameCallback' in counted) {
      const tick = () => {
        if (token !== this.runToken) return;
        this.camFrames++;
        counted.requestVideoFrameCallback(tick);
      };
      counted.requestVideoFrameCallback(tick);
    }

    while (this.isRunning && token === this.runToken) {
      const source = getSource();
      if (!source) { await sleep(60); continue; }

      const isVideo = source instanceof HTMLVideoElement;
      if (isVideo && (source.readyState < 2 || source.paused || source.videoWidth === 0)) {
        await sleep(40);
        continue;
      }
      const srcW = isVideo ? source.videoWidth : (source as HTMLImageElement).naturalWidth;
      const srcH = isVideo ? source.videoHeight : (source as HTMLImageElement).naturalHeight;
      if (!srcW || !srcH || !this.offscreenCtx) { await sleep(60); continue; }
      if (!getModelStageStatus().isDetectorReady) { await sleep(60); continue; }

      await nextFrame(source);
      if (!this.isRunning || token !== this.runToken) break;

      try {
        // 1. Snapshot (drawImage is synchronous => tCapture is the true time of this frame)
        const scale = Math.min(1, this.config.maxProcessingWidth / srcW);
        const pw = Math.round(srcW * scale), ph = Math.round(srcH * scale);
        if (this.offscreen.width !== pw || this.offscreen.height !== ph) {
          this.offscreen.width = pw;
          this.offscreen.height = ph;
        }
        this.offscreenCtx.drawImage(source, 0, 0, pw, ph);
        const tCapture = performance.now();

        // 2. Detect. High-recall mode while nothing is tracked, fast mode otherwise.
        const recall = this.tracker.getRenderTracks(tCapture).length === 0;
        const raw: RawDetection[] = await this.backend.detect(this.offscreen, recall);
        const tDone = performance.now();
        this.detLatency = Math.round(tDone - tCapture);

        const dets = raw.map((d) => ({
          box: mapDetectionToDisplayCoordinates(d.box, pw, ph, srcW, srcH),
          score: d.score,
        }));

        // 3. Track (filters are stepped to tCapture; drawing extrapolates to "now")
        const tk0 = performance.now();
        this.tracker.updateDetections(dets, tCapture, tDone, source);
        this.trackLatency = Math.round(performance.now() - tk0);

        const visible = this.tracker.getRenderTracks(performance.now());
        targetTracker.update(visible, this.enrolledProfiles);

        // 4. At most one analysis job per cycle, rate limited.
        await this.runOneAnalysisJob(source);

        this.totalLatency = Math.round(performance.now() - tCapture);
        this.detCycles++;
        const now = performance.now();
        if (now - this.lastDetCalc >= 1000) {
          this.detectionFps = Math.round((this.detCycles * 1000) / (now - this.lastDetCalc));
          this.detCycles = 0;
          this.lastDetCalc = now;
        }
        if (now - this.lastCamCalc >= 1000) {
          this.cameraFps = isVideo ? Math.round((this.camFrames * 1000) / (now - this.lastCamCalc)) : 0;
          this.camFrames = 0;
          this.lastCamCalc = now;
        }
        this.emitState(true); // push immediately only if the set of faces changed
      } catch (err) {
        console.warn('[vision] cycle error:', err);
        await sleep(50);
      }
    }
  }

  private async runOneAnalysisJob(source: MediaSource): Promise<void> {
    const stage = getModelStageStatus();
    if (!stage.isRecognitionReady && !stage.isAnalysisReady) return;

    const now = performance.now();
    const tracks = this.tracker.getRenderTracks(now).filter((t) => t.lifecycle === 'CONFIRMED' && t.missedFrames === 0);
    const sink = this.enrollSink;
    if (sink) {
      // Enrollment mode: measure the largest face as often as the pipeline allows (>= 70 ms apart).
      if (!tracks.length) { sink({ faceCount: 0, t: now }); return; }
      if (now - this.lastAnalysisTime < 70 || !stage.isRecognitionReady) return;
      const big = [...tracks].sort((a, b) => b.box.width - a.box.width)[0];
      const ref: BoundingBox = { ...big.box };
      this.lastAnalysisTime = now;
      const r = await analyzeFaceCrop(source, ref, { descriptor: true, landmarks: true });
      sink({ faceCount: tracks.length, trackId: big.trackId, descriptor: r?.descriptor, landmarks: r?.landmarks, box: ref, t: performance.now() });
      return;
    }
    if (!tracks.length) return;

    // Brand-new faces get identified with priority (no waiting for the rate limit); everything
    // else is limited to ~7 jobs / second so the detector keeps its frame rate.
    const target = targetTracker.getState();
    const bigEnough = (t: ExtendedTrackState) => Math.min(t.box.width, t.box.height) >= 36;
    // A face that has a descriptor but no session identity yet (needs a 2nd agreeing sample) is urgent too.
    const needsSession = (t: ExtendedTrackState) =>
      sessionMemory.active && stage.isRecognitionReady && t.sessionPersonId === undefined && !!t.descriptor &&
      now - t.lastDescriptorTime > 150 && bigEnough(t);
    const needsId = (t: ExtendedTrackState) =>
      stage.isRecognitionReady && bigEnough(t) && (!t.descriptor || now - t.lastDescriptorTime > 2500 || needsSession(t));
    const urgent = tracks.filter((t) => (!t.descriptor && needsId(t)) || needsSession(t));
    if (!urgent.length && now - this.lastAnalysisTime < 140) return;

    let track: ExtendedTrackState | undefined;
    if (urgent.length) {
      track = urgent.sort((a, b) => b.box.width - a.box.width)[0];
    } else {
      // Locked target first, then round-robin over everyone else.
      track = tracks.find((t) => target.locked && t.trackId === target.trackId && now - t.lastAnalysisTime > 250);
      if (!track) {
        const start = this.analysisCursor++ % tracks.length;
        for (let i = 0; i < tracks.length && !track; i++) {
          const t = tracks[(start + i) % tracks.length];
          if (now - t.lastAnalysisTime > 700) track = t;
        }
      }
    }
    if (!track) return;

    this.lastAnalysisTime = now;
    track.lastAnalysisTime = now;
    const wantsId = needsId(track);
    const t0 = performance.now();
    const refBox: BoundingBox = { ...track.box };
    const res = await analyzeFaceCrop(source, refBox, {
      descriptor: wantsId,
      landmarks: this.config.showLandmarks && stage.isRecognitionReady,
      ageGender: stage.isAnalysisReady && track.age.confidence < 75,
      expression: stage.isAnalysisReady,
    });
    this.embedLatency = Math.round(performance.now() - t0);
    if (!res || track.lifecycle === 'REMOVED') return;

    if (res.descriptor) {
      const hist = (track.descriptorHistory ??= []);
      // A descriptor far from this track's history means the track jumped to another person:
      // drop the old evidence instead of averaging two people into one identity.
      if (hist.length >= 2) {
        const mean = this.meanDescriptor(hist);
        if (euclideanDistance(mean, res.descriptor) > 0.8) hist.length = 0;
      }
      hist.push(Array.from(res.descriptor));
      if (hist.length > 5) hist.shift();
      const mean = this.meanDescriptor(hist);
      track.descriptor = Float32Array.from(mean);
      track.lastDescriptorTime = performance.now();
      track.identity = matchEmbeddingAgainstProfiles(track.descriptor, this.enrolledProfiles);

      // Session memory: same face coming back => same "Person N" (temporary, never saved).
      if (sessionMemory.active) {
        const taken = new Set<number>();
        for (const o of tracks) if (o !== track && o.sessionPersonId !== undefined) taken.add(o.sessionPersonId);
        const r = sessionMemory.resolve(track.descriptor, {
          currentId: track.sessionPersonId,
          takenIds: taken,
          trackKey: track.trackId,
          thumbnail: () => cropFaceRegion(source, refBox, 0.15) || undefined,
        });
        if (r) {
          track.sessionPersonId = r.id;
          track.sessionLabel = r.label;
        }
      }
    }
    if (typeof res.age === 'number') {
      track.age = updateAgeEstimation(track.age, res.age, track.quality);
      if (res.gender) {
        track.gender = res.gender;
        track.genderConfidence = res.genderProbability ? Math.round(res.genderProbability * 100) : undefined;
      }
    }
    if (res.expressions) track.expression = updateExpressionAnalysis(track.expression, res.expressions);
    if (res.landmarks) {
      track.landmarks = res.landmarks;
      (track as any).landmarksRef = refBox; // renderer re-projects onto the live box
    }
  }

  private meanDescriptor(hist: number[][]): number[] {
    const n = hist[0].length;
    const out = new Array<number>(n).fill(0);
    for (const d of hist) for (let i = 0; i < n; i++) out[i] += d[i] / hist.length;
    return out;
  }

  private emitState(onlyIfChanged: boolean): void {
    if (!this.onStateUpdate) return;
    const now = performance.now();
    const tracks = this.tracker.getRenderTracks(now);
    for (const t of tracks) if (t.sessionPersonId !== undefined) sessionMemory.touch(t.sessionPersonId);
    const ids = tracks.map((t) => `${t.trackId}:${t.sessionPersonId ?? ''}`).join(',') + `|${sessionMemory.version}`;
    if (onlyIfChanged && ids === this.lastEmittedIds) return;
    this.lastEmittedIds = ids;

    const stage = getModelStageStatus();
    this.onStateUpdate({
      tracks: [...tracks],
      targetState: targetTracker.getState(),
      session: {
        ...sessionMemory.snapshot(),
        visibleIds: tracks.map((t) => t.sessionPersonId).filter((x): x is number => x !== undefined),
      },
      telemetry: {
        cameraFps: this.cameraFps,
        inferenceFps: this.detectionFps,
        detectionLatencyMs: this.detLatency,
        trackingLatencyMs: this.trackLatency,
        embeddingLatencyMs: this.embedLatency,
        totalCvLatencyMs: this.totalLatency,
        activeTracksCount: tracks.length,
        facesDetectedCount: tracks.length,
        modelsLoaded: stage.isDetectorReady,
        webGpuActive: stage.backend === 'webgpu' || (this.backend as any).executionProvider === 'webgpu',
        backendOnline: true,
        hasGeminiKey: true,
      },
    });
  }
}

export const visionEngine = new VisionEngine();
