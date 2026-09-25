import * as faceapi from '@vladmandic/face-api';

export interface ModelStageStatus {
  isDetectorReady: boolean;
  isRecognitionReady: boolean;
  isAnalysisReady: boolean;
  isAllLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  backend: string;
}

let stageStatus: ModelStageStatus = {
  isDetectorReady: false,
  isRecognitionReady: false,
  isAnalysisReady: false,
  isAllLoaded: false,
  isLoading: false,
  error: null,
  backend: 'unknown',
};

const LOCAL_MODEL_PATH = '/models';
const CDN_MODEL_PATH = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

async function resolveModelPath(modelLoaderFn: (uri: string) => Promise<void>): Promise<void> {
  try {
    await modelLoaderFn(LOCAL_MODEL_PATH);
  } catch (err) {
    console.warn('Local model load failed, falling back to CDN:', err);
    await modelLoaderFn(CDN_MODEL_PATH);
  }
}

/**
 * Initializes TensorFlow backend and performs staged model loading.
 * Stage 1 (TinyFaceDetector) loads immediately so camera and detection start with zero delay.
 * Subsequent stages (Recognition, Landmarks, Age/Gender, Expressions) load in the background.
 */
export async function initializeVisionModels(
  onProgress?: (status: ModelStageStatus) => void
): Promise<ModelStageStatus> {
  if (stageStatus.isAllLoaded) {
    onProgress?.(stageStatus);
    return stageStatus;
  }

  if (stageStatus.isLoading) {
    while (stageStatus.isLoading) {
      await new Promise((r) => setTimeout(r, 80));
    }
    onProgress?.(stageStatus);
    return stageStatus;
  }

  stageStatus.isLoading = true;
  stageStatus.error = null;

  try {
    // 1. TF backend: WebGL is the fastest/most stable backend for these small CNNs (the old
    //    WebGPU switch was slower on some GPUs and could silently break ops). YOLO runs in its own
    //    onnxruntime session (WebGPU/WASM), so it does not depend on this choice.
    const tf = faceapi.tf as any;
    if (tf) {
      try {
        if (typeof tf.setBackend === 'function') await tf.setBackend('webgl');
        if (typeof tf.ready === 'function') await tf.ready();
        tf.env?.().set?.('WEBGL_PACK', true);
        tf.env?.().set?.('WEBGL_FORCE_F16_TEXTURES', true);
      } catch { /* keep whatever backend tf picked */ }
      stageStatus.backend = (typeof tf.getBackend === 'function' ? tf.getBackend() : 'webgl') || 'webgl';
    }

    // STAGE 1: Face Detector (Immediate readiness)
    await resolveModelPath((uri) => faceapi.nets.tinyFaceDetector.loadFromUri(uri));
    // Warm-up: the first inference compiles GPU shaders (100s of ms). Do it before going "ready".
    try {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 240;
      c.getContext('2d')?.fillRect(0, 0, 320, 240);
      await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }));
    } catch { /* non-fatal */ }
    stageStatus.isDetectorReady = true;
    onProgress?.({ ...stageStatus });

    // STAGE 2: Recognition & Landmarks (Background)
    Promise.all([
      resolveModelPath((uri) => faceapi.nets.faceLandmark68Net.loadFromUri(uri)),
      resolveModelPath((uri) => faceapi.nets.faceRecognitionNet.loadFromUri(uri)),
    ])
      .then(() => {
        stageStatus.isRecognitionReady = true;
        onProgress?.({ ...stageStatus });

        // STAGE 3: Age & Expression Analysis (Background)
        return Promise.all([
          resolveModelPath((uri) => faceapi.nets.ageGenderNet.loadFromUri(uri)),
          resolveModelPath((uri) => faceapi.nets.faceExpressionNet.loadFromUri(uri)),
        ]);
      })
      .then(() => {
        stageStatus.isAnalysisReady = true;
        stageStatus.isAllLoaded = true;
        stageStatus.isLoading = false;
        onProgress?.({ ...stageStatus });
      })
      .catch((err) => {
        console.warn('Background model stage load warning:', err);
        // Even if secondary models fail, detection remains active
        stageStatus.isLoading = false;
      });

    stageStatus.isLoading = false;
    return stageStatus;
  } catch (err: any) {
    stageStatus.isLoading = false;
    stageStatus.error = err?.message || 'Failed to initialize face detector model';
    console.error('Face detector initialization failure:', err);
    throw err;
  }
}

export function getModelStageStatus(): ModelStageStatus {
  return { ...stageStatus };
}
