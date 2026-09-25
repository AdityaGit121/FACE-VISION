import * as ort from 'onnxruntime-web/webgpu';
import { BoundingBox } from '../types';
import { FaceDetectorBackend, RawDetection, applyNonMaximumSuppression, sanitizeDetection } from './faceDetector';

/**
 * YOLOv8n-face detector (ONNX, runs on WebGPU with automatic WASM fallback).
 *
 * The model (public/models/yolov8n-face.onnx) has three anchor-free heads (strides 8/16/32), each
 * (1, 80, H/stride, W/stride): 64 DFL box channels (4 sides x 16 bins), 1 face-class logit, and
 * 15 keypoint channels (unused here). Decoding was verified against onnxruntime on a real photo.
 *
 * Compared with the Tiny SSD it is more accurate on small / turned / partly occluded faces and
 * gives much steadier box geometry frame to frame, which is what lets the Kalman filter output
 * a smooth box.
 */

const MODEL_URL = '/models/yolov8n-face.onnx';
const DFL_BINS = 16;

let ortConfigured = false;
function configureOrt(): void {
  if (ortConfigured) return;
  ortConfigured = true;
  // wasm/mjs runtime files are copied here by `npm run setup:yolo` (runs on postinstall).
  if (typeof window !== 'undefined') ort.env.wasm.wasmPaths = '/ort/';
  const threads = (globalThis as any).crossOriginIsolated ? Math.min(4, (globalThis as any).navigator?.hardwareConcurrency || 2) : 1;
  ort.env.wasm.numThreads = threads;
}

export class YoloFaceBackend implements FaceDetectorBackend {
  readonly name: string;
  private session: ort.InferenceSession | null = null;
  private provider = 'wasm';
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

  private constructor() {
    this.name = 'YOLOv8n-face';
  }

  get executionProvider(): string {
    return this.provider;
  }

  /** Resolves to a ready backend, or rejects (caller falls back to TinyFaceBackend). */
  static async create(): Promise<YoloFaceBackend> {
    configureOrt();
    const head = await fetch(MODEL_URL, { method: 'HEAD' });
    if (!head.ok) throw new Error(`YOLO model not found at ${MODEL_URL}`);

    const be = new YoloFaceBackend();
    const attempts: string[][] = [];
    if ('gpu' in navigator) attempts.push(['webgpu']);
    attempts.push(['wasm']);

    let lastErr: unknown = null;
    for (const eps of attempts) {
      try {
        be.session = await ort.InferenceSession.create(MODEL_URL, {
          executionProviders: eps,
          graphOptimizationLevel: 'all',
        });
        be.provider = eps[0];
        await be.warmup();
        return be;
      } catch (e) {
        lastErr = e;
        be.session = null;
      }
    }
    throw lastErr ?? new Error('YOLO session creation failed');
  }

  /** Compile shaders / allocate buffers for both input sizes so the first live frame isn't slow. */
  private async warmup(): Promise<void> {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 270;
    c.getContext('2d')!.fillRect(0, 0, 480, 270);
    await this.detect(c, false);
    await this.detect(c, true);
  }

  async detect(frame: HTMLCanvasElement, recall: boolean): Promise<RawDetection[]> {
    const session = this.session;
    if (!session) return [];

    // Letterbox (top-left anchored): long side = 320 (fast) or 416 (recall); dims multiple of 32.
    const longSide = recall ? 416 : 320;
    const scale = longSide / Math.max(frame.width, frame.height);
    const nw = Math.max(1, Math.round(frame.width * scale));
    const nh = Math.max(1, Math.round(frame.height * scale));
    const inW = Math.ceil(nw / 32) * 32;
    const inH = Math.ceil(nh / 32) * 32;

    if (this.canvas.width !== inW || this.canvas.height !== inH) {
      this.canvas.width = inW;
      this.canvas.height = inH;
    }
    this.ctx.fillStyle = 'rgb(114,114,114)';
    this.ctx.fillRect(0, 0, inW, inH);
    this.ctx.drawImage(frame, 0, 0, nw, nh);
    const px = this.ctx.getImageData(0, 0, inW, inH).data;

    const plane = inW * inH;
    const input = new Float32Array(3 * plane);
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      input[i] = px[p] / 255;
      input[plane + i] = px[p + 1] / 255;
      input[2 * plane + i] = px[p + 2] / 255;
    }

    const outputs = await session.run({ images: new ort.Tensor('float32', input, [1, 3, inH, inW]) });

    const scoreThr = recall ? 0.3 : 0.4;
    const logitThr = Math.log(scoreThr / (1 - scoreThr));
    const cands: RawDetection[] = [];

    for (const name of session.outputNames) {
      const t = outputs[name];
      const dims = t.dims as readonly number[];
      if (dims.length !== 4 || dims[1] < 65) continue;
      const C = dims[1], H = dims[2], W = dims[3];
      const stride = inW / W;
      const data = t.data as Float32Array;
      const hw = H * W;
      const bins = new Float32Array(DFL_BINS);

      for (let i = 0; i < hw; i++) {
        const logit = data[64 * hw + i];
        if (logit < logitThr) continue;
        const score = 1 / (1 + Math.exp(-logit));
        const gx = i % W, gy = (i / W) | 0;
        const cx = (gx + 0.5) * stride, cy = (gy + 0.5) * stride;

        const d = [0, 0, 0, 0]; // left, top, right, bottom in pixels
        for (let side = 0; side < 4; side++) {
          let max = -Infinity;
          for (let k = 0; k < DFL_BINS; k++) {
            const v = data[(side * DFL_BINS + k) * hw + i];
            bins[k] = v;
            if (v > max) max = v;
          }
          let sum = 0, acc = 0;
          for (let k = 0; k < DFL_BINS; k++) {
            const e = Math.exp(bins[k] - max);
            sum += e;
            acc += e * k;
          }
          d[side] = (acc / sum) * stride;
        }
        const box: BoundingBox = {
          x: (cx - d[0]) / scale,
          y: (cy - d[1]) / scale,
          width: (d[0] + d[2]) / scale,
          height: (d[1] + d[3]) / scale,
        };
        const s = sanitizeDetection({ box, score }, frame.width, frame.height);
        if (s) cands.push(s);
      }
      void C;
    }
    return applyNonMaximumSuppression(cands, 0.45);
  }
}
