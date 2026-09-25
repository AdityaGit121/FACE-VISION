// Copies the onnxruntime-web runtime into public/ort and downloads the YOLOv8n-face model if missing.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const out = join(root, 'public', 'ort');
mkdirSync(out, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  if (existsSync(join(dist, f))) cpSync(join(dist, f), join(out, f));
}
const model = join(root, 'public', 'models', 'yolov8n-face.onnx');
if (!existsSync(model)) {
  const url = 'https://github.com/yakhyo/yolov8-face-onnx-inference/releases/download/weights/yolov8n-face.onnx';
  console.log('Downloading YOLOv8n-face model...');
  const res = await fetch(url);
  if (!res.ok) { console.warn('Could not download YOLO model; the app will use the Tiny detector.'); process.exit(0); }
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
console.log('YOLO setup OK');
