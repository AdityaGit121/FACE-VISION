import { AgeEstimation, ExpressionAnalysis, FaceQuality } from '../types';

/**
 * Updates age estimation state with temporal smoothing, variance calculation,
 * dynamic range boundaries, and quality gating.
 */
export function updateAgeEstimation(
  prevAge: AgeEstimation | undefined,
  rawAge: number,
  quality: FaceQuality
): AgeEstimation {
  const roundedRaw = Math.round(rawAge);
  const history = prevAge ? [...prevAge.history, roundedRaw].slice(-15) : [roundedRaw];

  // Outlier filter: if history has >= 4 items, compute median and filter extreme spikes
  let filtered = history;
  if (history.length >= 4) {
    const sorted = [...history].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    filtered = history.filter((val) => Math.abs(val - median) <= 12);
    if (filtered.length === 0) filtered = [roundedRaw];
  }

  // Weighted Exponential Moving Average (give more weight to recent consistent frames)
  let smoothedAge = roundedRaw;
  if (prevAge && prevAge.smoothedAge > 0) {
    // 85% previous smoothed + 15% new sample
    smoothedAge = Math.round(0.85 * prevAge.smoothedAge + 0.15 * roundedRaw);
  } else {
    smoothedAge = roundedRaw;
  }

  // Compute standard deviation
  const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  const variance =
    filtered.reduce((sum, val) => sum + (val - mean) ** 2, 0) / filtered.length;
  const stdDev = Math.sqrt(variance);

  // Derive estimated range [min, max]
  const spread = Math.max(3, Math.round(stdDev * 1.6 + 2));
  const minAge = Math.max(1, smoothedAge - spread);
  const maxAge = smoothedAge + spread;

  // Confidence computation based on face quality and temporal stability
  // Lower stdDev = higher confidence; higher face quality = higher confidence
  const stabilityFactor = Math.max(0.4, 1.0 - Math.min(0.6, stdDev / 10));
  const qualityFactor = quality.overall / 100;
  const confidence = Math.min(
    95,
    Math.max(25, Math.round(stabilityFactor * qualityFactor * 100))
  );

  const isLowQuality = quality.overall < 50 || quality.resolutionScore < 40;

  return {
    rawAge: roundedRaw,
    smoothedAge,
    minAge,
    maxAge,
    confidence,
    isLowQuality,
    history,
  };
}

/**
 * Updates expression analysis with sliding window temporal smoothing,
 * stability tracking, and confidence derivation to prevent jitter.
 */
export function updateExpressionAnalysis(
  prevExpr: ExpressionAnalysis | undefined,
  rawExpressions: Record<string, number>
): ExpressionAnalysis {
  // Find instantaneous dominant expression
  let dominant = 'neutral';
  let maxScore = -1;

  for (const [expr, score] of Object.entries(rawExpressions)) {
    if (score > maxScore) {
      maxScore = score;
      dominant = expr;
    }
  }

  const confidence = Math.round(Math.min(1.0, maxScore) * 100);

  // Maintain last 10 frames of dominant expressions
  const history = prevExpr ? [...prevExpr.history, dominant].slice(-10) : [dominant];

  // Calculate stability: proportion of history matching the dominant expression
  const matchCount = history.filter((item) => item === dominant).length;
  const stability = Math.round((matchCount / history.length) * 100);

  // Hysteresis smoothing: If previous dominant has high stability and current
  // frame score is only slightly higher, retain previous to prevent flickering
  let stableDominant = dominant;
  if (prevExpr && prevExpr.stability > 65 && dominant !== prevExpr.dominant) {
    const prevScore = rawExpressions[prevExpr.dominant] || 0;
    // Require new emotion to exceed previous emotion by at least 25% margin to switch
    if (maxScore - prevScore < 0.25) {
      stableDominant = prevExpr.dominant;
    }
  }

  return {
    dominant: stableDominant,
    confidence,
    stability,
    distribution: rawExpressions,
    history,
  };
}
