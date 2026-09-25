import { BoundingBox, Point2D, FaceQuality } from '../types';

export function evaluateFaceQuality(
  sourceCanvasOrVideo: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
  box: BoundingBox,
  landmarks?: Point2D[],
  detectionConfidence: number = 0.9
): FaceQuality {
  const reasons: string[] = [];

  // 1. Resolution Score (Target: >= 120px width & height)
  const minDim = Math.min(box.width, box.height);
  let resolutionScore = 100;
  if (minDim < 60) {
    resolutionScore = Math.max(15, Math.round((minDim / 60) * 45));
    reasons.push('Face resolution too low (move closer)');
  } else if (minDim < 110) {
    resolutionScore = Math.round(45 + ((minDim - 60) / 50) * 45);
  } else {
    resolutionScore = Math.min(100, Math.round(90 + (minDim / 400) * 10));
  }

  // 2. Sample face region for Brightness, Contrast, Sharpness
  let brightnessScore = 80;
  let contrastScore = 80;
  let sharpnessScore = 80;

  try {
    const offscreen = document.createElement('canvas');
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });
    if (ctx && box.width > 10 && box.height > 10) {
      const sampleSize = 64;
      offscreen.width = sampleSize;
      offscreen.height = sampleSize;

      // Ensure bounding coordinates stay within source bounds
      const sx = Math.max(0, box.x);
      const sy = Math.max(0, box.y);
      const sw = Math.max(10, box.width);
      const sh = Math.max(10, box.height);

      ctx.drawImage(sourceCanvasOrVideo, sx, sy, sw, sh, 0, 0, sampleSize, sampleSize);
      const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize);
      const data = imgData.data;

      let sumLuma = 0;
      const grays: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        // Luminance formula
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sumLuma += gray;
        grays.push(gray);
      }

      const meanLuma = sumLuma / grays.length;

      // Brightness: ideal 90 - 170
      if (meanLuma < 50) {
        brightnessScore = Math.max(10, Math.round((meanLuma / 50) * 50));
        reasons.push('Lighting too dim');
      } else if (meanLuma > 215) {
        brightnessScore = Math.max(10, Math.round(((255 - meanLuma) / 40) * 50));
        reasons.push('Face overexposed / high glare');
      } else if (meanLuma < 85) {
        brightnessScore = Math.round(50 + ((meanLuma - 50) / 35) * 40);
      } else {
        brightnessScore = 95;
      }

      // Contrast: Standard deviation of luminance
      let varianceSum = 0;
      for (const g of grays) {
        varianceSum += (g - meanLuma) ** 2;
      }
      const stdDev = Math.sqrt(varianceSum / grays.length);
      if (stdDev < 18) {
        contrastScore = Math.max(20, Math.round((stdDev / 18) * 55));
        reasons.push('Low facial contrast');
      } else {
        contrastScore = Math.min(100, Math.round(60 + (stdDev / 60) * 40));
      }

      // Sharpness: 3x3 Laplacian edge magnitude approximation
      let edgeEnergy = 0;
      for (let y = 1; y < sampleSize - 1; y++) {
        for (let x = 1; x < sampleSize - 1; x++) {
          const idx = y * sampleSize + x;
          const val = grays[idx];
          const laplacian =
            4 * val -
            grays[idx - 1] -
            grays[idx + 1] -
            grays[idx - sampleSize] -
            grays[idx + sampleSize];
          edgeEnergy += Math.abs(laplacian);
        }
      }
      const avgEdge = edgeEnergy / ((sampleSize - 2) * (sampleSize - 2));
      if (avgEdge < 6.5) {
        sharpnessScore = Math.max(15, Math.round((avgEdge / 6.5) * 55));
        reasons.push('Image blur detected');
      } else {
        sharpnessScore = Math.min(100, Math.round(55 + (avgEdge / 25) * 45));
      }
    }
  } catch {
    // If canvas extraction fails (e.g. cross-origin), keep safe estimates
  }

  // 3. Pose Score & Angles from Landmarks (if 68 landmarks available)
  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  let poseScore = 90;

  if (landmarks && landmarks.length >= 68) {
    const leftEye = landmarks[36];
    const rightEye = landmarks[45];
    const noseTip = landmarks[30];
    const chin = landmarks[8];
    const mouthCenter = landmarks[62] || landmarks[66] || {
      x: (landmarks[48].x + landmarks[54].x) / 2,
      y: (landmarks[48].y + landmarks[54].y) / 2,
    };

    // Roll (tilt) in degrees
    const dy = rightEye.y - leftEye.y;
    const dx = rightEye.x - leftEye.x;
    roll = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);

    // Yaw (horizontal turn): ratio between leftEye-nose vs nose-rightEye
    const distLeft = Math.hypot(noseTip.x - leftEye.x, noseTip.y - leftEye.y);
    const distRight = Math.hypot(rightEye.x - noseTip.x, rightEye.y - noseTip.y);
    if (distLeft + distRight > 0) {
      const asymmetry = (distLeft - distRight) / (distLeft + distRight);
      yaw = Math.round(asymmetry * 65); // degrees approx
    }

    // Pitch (tilt up/down): nose vertical relative to eye-mouth span
    const eyeY = (leftEye.y + rightEye.y) / 2;
    const totalSpan = Math.max(10, chin.y - eyeY);
    const noseRatio = (noseTip.y - eyeY) / totalSpan;
    // Expected frontal ratio is roughly 0.45
    pitch = Math.round((noseRatio - 0.45) * 75);

    const absRoll = Math.abs(roll);
    const absYaw = Math.abs(yaw);
    const absPitch = Math.abs(pitch);

    if (absYaw > 28) {
      reasons.push('Face turned away (align with camera)');
      poseScore -= Math.min(50, (absYaw - 28) * 2);
    }
    if (absRoll > 22) {
      reasons.push('Head tilted excessively');
      poseScore -= Math.min(30, (absRoll - 22) * 1.5);
    }
    if (absPitch > 25) {
      poseScore -= Math.min(30, (absPitch - 25) * 1.5);
    }
    poseScore = Math.max(10, Math.min(100, Math.round(poseScore)));
  }

  // 4. Detection Confidence weighting
  const confScore = Math.round(Math.min(1.0, detectionConfidence) * 100);

  // 5. Overall Weighted Face Quality Score
  const overall = Math.round(
    resolutionScore * 0.25 +
      brightnessScore * 0.20 +
      contrastScore * 0.15 +
      sharpnessScore * 0.20 +
      poseScore * 0.15 +
      confScore * 0.05
  );

  const isAcceptable = overall >= 65 && resolutionScore >= 45 && poseScore >= 50;

  return {
    overall: Math.min(100, Math.max(0, overall)),
    resolutionScore,
    brightnessScore,
    contrastScore,
    sharpnessScore,
    poseScore,
    yaw,
    pitch,
    roll,
    isAcceptable,
    reasons,
  };
}

/** Head pose (degrees, approximate) from 68 landmarks. Same convention as evaluateFaceQuality. */
export function estimatePose(landmarks: Point2D[]): { yaw: number; pitch: number; roll: number } | null {
  if (!landmarks || landmarks.length < 68) return null;
  const leftEye = landmarks[36], rightEye = landmarks[45], noseTip = landmarks[30], chin = landmarks[8];
  const roll = (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI;
  const dl = Math.hypot(noseTip.x - leftEye.x, noseTip.y - leftEye.y);
  const dr = Math.hypot(rightEye.x - noseTip.x, rightEye.y - noseTip.y);
  const yaw = dl + dr > 0 ? ((dl - dr) / (dl + dr)) * 65 : 0;
  const eyeY = (leftEye.y + rightEye.y) / 2;
  const span = Math.max(10, chin.y - eyeY);
  const pitch = ((noseTip.y - eyeY) / span - 0.45) * 75;
  return { yaw, pitch, roll };
}
