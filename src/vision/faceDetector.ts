import * as faceapi from '@vladmandic/face-api';
import { BoundingBox, Point2D } from '../types';

export interface DetectorConfig {
  inputSize: 224 | 320 | 416 | 512;
  scoreThreshold: number;
}

export interface RawDetection {
  box: BoundingBox; // floating point, source-frame pixels
  score: number;
}

/** Any face detector (Tiny SSD via face-api, YOLOv8-face via ONNX, ...) implements this. */
export interface FaceDetectorBackend {
  readonly name: string;
  /**
   * @param frame  canvas holding the (downscaled) frame
   * @param recall true = favour recall (nothing tracked right now), false = favour speed
   */
  detect(frame: HTMLCanvasElement, recall: boolean): Promise<RawDetection[]>;
}

function iouOf(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.width * a.height + b.width * b.height - inter;
  return uni > 0 ? inter / uni : 0;
}

/** Non-maximum suppression: one box per face (IoU + centre-inside-larger-box test). */
export function applyNonMaximumSuppression(detections: RawDetection[], iouThreshold = 0.4): RawDetection[] {
  if (detections.length <= 1) return detections;
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: RawDetection[] = [];
  for (const c of sorted) {
    let keep = true;
    for (const k of kept) {
      const cx = c.box.x + c.box.width / 2, cy = c.box.y + c.box.height / 2;
      const inside = cx > k.box.x && cx < k.box.x + k.box.width && cy > k.box.y && cy < k.box.y + k.box.height;
      const ratio = (c.box.width * c.box.height) / Math.max(1, k.box.width * k.box.height);
      if (iouOf(c.box, k.box) > iouThreshold || (inside && ratio > 0.4)) { keep = false; break; }
    }
    if (keep) kept.push(c);
  }
  return kept;
}

/** Maps a box from processing-canvas space back to source-frame space (floating point). */
export function mapDetectionToDisplayCoordinates(
  box: BoundingBox, processingWidth: number, processingHeight: number, displayWidth: number, displayHeight: number
): BoundingBox {
  if (processingWidth <= 0 || processingHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) return { ...box };
  const sx = displayWidth / processingWidth, sy = displayHeight / processingHeight;
  return { x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy };
}

/** Filters impossible faces (tiny / weird aspect) and clamps to the frame. */
export function sanitizeDetection(d: RawDetection, frameW: number, frameH: number): RawDetection | null {
  let { x, y, width, height } = d.box;
  const x2 = Math.min(frameW, x + width), y2 = Math.min(frameH, y + height);
  x = Math.max(0, x); y = Math.max(0, y);
  width = x2 - x; height = y2 - y;
  if (width < 14 || height < 14) return null;
  const aspect = height / width;
  if (aspect < 0.6 || aspect > 2.0) return null;
  return { box: { x, y, width, height }, score: d.score };
}

/** Tiny SSD MobileNet (face-api) backend. Fast, always available, works offline with /models. */
export class TinyFaceBackend implements FaceDetectorBackend {
  readonly name = 'TinyFaceDetector';
  async detect(frame: HTMLCanvasElement, recall: boolean): Promise<RawDetection[]> {
    // Larger input + lower threshold only while nothing is tracked; cheap settings otherwise.
    const opts = new faceapi.TinyFaceDetectorOptions({
      inputSize: recall ? 416 : 320,
      scoreThreshold: recall ? 0.3 : 0.38,
    });
    const results = await faceapi.detectAllFaces(frame, opts);
    const out: RawDetection[] = [];
    for (const r of results) {
      const s = sanitizeDetection({ box: { x: r.box.x, y: r.box.y, width: r.box.width, height: r.box.height }, score: r.score }, frame.width, frame.height);
      if (s) out.push(s);
    }
    return applyNonMaximumSuppression(out, 0.4);
  }
}

// ---------------------------------------------------------------------------------------------
// Crop-based analysis.
//
// BUG FIXED: the old code ran detectSingleFace() on the WHOLE video frame for every analysis job
// and then wrote the result (descriptor / landmarks / age / expression) into whichever track was
// first in the list. With 2+ faces that put identities and landmarks on the wrong person ("face
// in one place, detected in another") and made every job ~10x more expensive than needed.
// Now each job runs on a padded crop of exactly one tracked face.
// ---------------------------------------------------------------------------------------------

export interface CropWants { descriptor?: boolean; landmarks?: boolean; ageGender?: boolean; expression?: boolean }
export interface CropAnalysis {
  descriptor?: Float32Array;
  landmarks?: Point2D[]; // in SOURCE-frame coordinates
  age?: number;
  gender?: string;
  genderProbability?: number;
  expressions?: Record<string, number>;
}

let cropCanvas: HTMLCanvasElement | null = null;

export async function analyzeFaceCrop(
  source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
  box: BoundingBox,
  wants: CropWants
): Promise<CropAnalysis | null> {
  try {
    const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!srcW || !srcH) return null;

    const pad = 0.4;
    const cx = Math.max(0, box.x - box.width * pad);
    const cy = Math.max(0, box.y - box.height * pad);
    const cw = Math.min(srcW - cx, box.width * (1 + 2 * pad));
    const ch = Math.min(srcH - cy, box.height * (1 + 2 * pad));
    if (cw < 16 || ch < 16) return null;

    const scale = Math.min(1, 256 / Math.max(cw, ch));
    if (!cropCanvas) cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.max(16, Math.round(cw * scale));
    cropCanvas.height = Math.max(16, Math.round(ch * scale));
    const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, cx, cy, cw, ch, 0, 0, cropCanvas.width, cropCanvas.height);

    let task: any = faceapi.detectAllFaces(
      cropCanvas,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.25 })
    );
    const needLandmarks = wants.landmarks || wants.descriptor;
    if (needLandmarks && faceapi.nets.faceLandmark68Net.isLoaded) task = task.withFaceLandmarks();
    if (wants.expression && faceapi.nets.faceExpressionNet.isLoaded) task = task.withFaceExpressions();
    if (wants.ageGender && faceapi.nets.ageGenderNet.isLoaded) task = task.withAgeAndGender();
    if (wants.descriptor && faceapi.nets.faceRecognitionNet.isLoaded) task = task.withFaceDescriptors();

    const results: any[] = await task;
    if (!results || results.length === 0) return null;

    // Pick the face closest to where the tracked face should be (crop centre), never "the first".
    const ex = ((box.x + box.width / 2) - cx) * scale;
    const ey = ((box.y + box.height / 2) - cy) * scale;
    let best: any = null, bestD = Infinity;
    for (const r of results) {
      const det = r.detection ?? r;
      const b = det.box;
      const d = Math.hypot(b.x + b.width / 2 - ex, b.y + b.height / 2 - ey);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (!best || bestD > 0.35 * Math.max(box.width, box.height) * scale) return null; // wrong face

    const out: CropAnalysis = {};
    if (best.descriptor) out.descriptor = best.descriptor as Float32Array;
    if (wants.landmarks && best.landmarks) {
      out.landmarks = (best.landmarks.positions as Array<{ x: number; y: number }>).map((p) => ({
        x: cx + p.x / scale,
        y: cy + p.y / scale,
      }));
    }
    if (typeof best.age === 'number') {
      out.age = Math.round(best.age);
      out.gender = best.gender;
      out.genderProbability = best.genderProbability;
    }
    if (best.expressions) out.expressions = best.expressions as Record<string, number>;
    return out;
  } catch (err) {
    console.warn('analyzeFaceCrop:', err);
    return null;
  }
}

/**
 * Crops a face region from a video/canvas/image source with optional margin padding.
 */
export function cropFaceRegion(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  box: BoundingBox,
  paddingPercent: number = 0.20
): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const srcW = source instanceof HTMLVideoElement ? source.videoWidth : (source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width;
    const srcH = source instanceof HTMLVideoElement ? source.videoHeight : (source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height;

    const padX = box.width * paddingPercent;
    const padY = box.height * paddingPercent;

    const cropX = Math.max(0, box.x - padX);
    const cropY = Math.max(0, box.y - padY);
    const cropW = Math.min(srcW - cropX, box.width + padX * 2);
    const cropH = Math.min(srcH - cropY, box.height + padY * 2);

    if (cropW <= 0 || cropH <= 0) return '';

    canvas.width = Math.min(256, cropW);
    canvas.height = Math.min(256, cropH);

    ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return '';
  }
}
