export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface FaceQuality {
  overall: number; // 0 to 100
  resolutionScore: number;
  brightnessScore: number;
  contrastScore: number;
  sharpnessScore: number;
  poseScore: number;
  yaw: number; // estimated degrees
  pitch: number;
  roll: number;
  isAcceptable: boolean;
  reasons: string[];
}

export interface ExpressionAnalysis {
  dominant: string;
  confidence: number; // 0 to 100
  stability: number; // 0 to 100 (temporal consistency over recent frames)
  distribution: Record<string, number>;
  history: string[];
}

export interface AgeEstimation {
  rawAge: number;
  smoothedAge: number;
  minAge: number;
  maxAge: number;
  confidence: number; // 0 to 100
  isLowQuality: boolean;
  history: number[];
}

export type IdentityStatus = 'KNOWN' | 'UNCERTAIN' | 'UNKNOWN';

export interface IdentityMatch {
  status: IdentityStatus;
  personId?: string;
  name?: string;
  confidence: number; // 0 to 100
  distance: number; // Euclidean distance (e.g. 0.0 to 1.5)
  sampleCount: number;
  matchScore: number; // Normalized similarity 0 to 100
}

export interface TrackedFace {
  trackId: number;
  box: BoundingBox;
  predictedBox?: BoundingBox;
  velocity: { vx: number; vy: number };
  missedFrames: number;
  firstSeen: number;
  lastSeen: number;

  quality: FaceQuality;
  age: AgeEstimation;
  expression: ExpressionAnalysis;
  identity: IdentityMatch;

  descriptor?: Float32Array;
  landmarks?: Point2D[];
  gender?: string;
  genderConfidence?: number;

  isSelected?: boolean;
  isTarget?: boolean;

  /** Temporary per-session identity (NOT an enrolled profile). */
  sessionPersonId?: number;
  sessionLabel?: string;
}

export interface IdentityProfile {
  id: string;
  name: string;
  role?: string;
  notes?: string;
  tags?: string[];
  embeddings: number[][]; // Multi-sample 128-d vectors
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
  sampleCount: number;
  metadata?: {
    notes?: string;
    role?: string;
    tags?: string[];
    enrollmentAngles?: string[];
  };
}

export type TargetTrackingStatus = 'IDLE' | 'LOCKED' | 'SEARCHING' | 'REACQUIRED' | 'LOST';

export interface TargetState {
  personId: string | null;
  name: string;
  locked: boolean;
  status: TargetTrackingStatus;

  trackingConfidence: number;
  identityConfidence: number;

  lastSeen: number;
  boundingBox?: BoundingBox;
  trackId?: number;

  age?: number;
  emotion?: string;
  searchQuery?: string;
  searchStartTime?: number;
}

export interface FaceSighting {
  id: string;
  personId: string;
  personName: string;
  timestamp: number;
  confidence: number;
  ageEstimate?: number;
  expression?: string;
  boundingBox?: BoundingBox;
}

export interface DiagnosticsTelemetry {
  cameraFps: number;
  inferenceFps: number;
  detectionLatencyMs: number;
  trackingLatencyMs: number;
  embeddingLatencyMs: number;
  totalCvLatencyMs: number;
  geminiLatencyMs?: number;
  activeTracksCount: number;
  facesDetectedCount: number;
  modelsLoaded: boolean;
  webGpuActive: boolean;
  backendOnline: boolean;
  hasGeminiKey: boolean;
}

export interface DeepScanResult {
  sceneSummary: string;
  facesDetected: number;
  faces: Array<{
    faceIndex: number;
    observedExpression: string;
    approximateAgeRange: string;
    visualAttributes: string[];
    lightingQuality?: string;
    confidenceScore?: number;
  }>;
  cvConsistency: 'HIGH' | 'MODERATE' | 'DISAGREEMENT';
  contextualInsights: string[];
  timestamp: number;
  latencyMs: number;
}

export type VideoSourceMode = 'webcam' | 'sample' | 'upload';
