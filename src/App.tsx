import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { LiveVision } from './components/LiveVision';
import { TargetPanel } from './components/TargetPanel';
import { PeoplePanel } from './components/PeoplePanel';
import { VisionAssistant } from './components/VisionAssistant';
import { EnrollmentWizard } from './components/EnrollmentWizard';
import { SessionPanel } from './components/SessionPanel';
import { AISettingsModal } from './components/AISettingsModal';
import { aiPost } from './ai/aiClient';
import { useAISettings, hasUserProvider } from './ai/aiSettings';
import { sessionMemory } from './identity/sessionMemory';
import type { SessionView } from './vision/visionEngine';
import { IdentityMemoryModal } from './components/IdentityMemoryModal';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer';
import { DeepScanModal } from './components/DeepScanModal';
import { FaceDetailsModal } from './components/FaceDetailsModal';
import { SampleSelector } from './components/SampleSelector';

import {
  TrackedFace,
  TargetState,
  IdentityProfile,
  DiagnosticsTelemetry,
  DeepScanResult,
  VideoSourceMode,
} from './types';
import { initializeVisionModels, ModelStageStatus } from './vision/modelLoader';
import { visionEngine } from './vision/visionEngine';
import { targetTracker } from './tracking/targetTracker';
import { idb } from './identity/indexedDb';
import { SAMPLE_PORTRAITS, SamplePortrait } from './data/samples';
import { ExtendedTrackState } from './tracking/multiFaceTracker';

export const App: React.FC = () => {
  // Mode & Media State
  const [mode, setMode] = useState<VideoSourceMode>('webcam');
  const [activeSample, setActiveSample] = useState<SamplePortrait | null>(SAMPLE_PORTRAITS[0]);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [isMirrored, setIsMirrored] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showLandmarks, setShowLandmarks] = useState<boolean>(false);

  // Camera Status
  const [isCameraError, setIsCameraError] = useState<boolean>(false);
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string>('');

  // Model & CV State
  const [isLoadingDetector, setIsLoadingDetector] = useState<boolean>(true);
  const [detectorError, setDetectorError] = useState<string | null>(null);
  const [serverHasKey, setHasGeminiKey] = useState<boolean>(false);
  const aiSettings = useAISettings();
  // AI features are on if the user added a provider in the UI OR the server has a key in .env
  const hasGeminiKey = serverHasKey || hasUserProvider(aiSettings);
  const [isAISettingsOpen, setIsAISettingsOpen] = useState<boolean>(false);

  // Tracking & Identity State (Throttled UI State from Vision Engine)
  const [trackedFaces, setTrackedFaces] = useState<ExtendedTrackState[]>([]);
  const [session, setSession] = useState<SessionView>({ ...sessionMemory.snapshot(), visibleIds: [] });
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null);
  const [targetState, setTargetState] = useState<TargetState>(targetTracker.getState());
  const [enrolledProfiles, setEnrolledProfiles] = useState<IdentityProfile[]>([]);

  // Modals & Drawers
  const [isEnrollmentOpen, setIsEnrollmentOpen] = useState<boolean>(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [isDeepScanOpen, setIsDeepScanOpen] = useState<boolean>(false);
  const [isFaceDetailsOpen, setIsFaceDetailsOpen] = useState<boolean>(false);
  const [inspectedFace, setInspectedFace] = useState<TrackedFace | null>(null);

  // Deep Scan & Diagnostics
  const [isDeepScanning, setIsDeepScanning] = useState<boolean>(false);
  const [deepScanResult, setDeepScanResult] = useState<DeepScanResult | null>(null);

  const [telemetry, setTelemetry] = useState<DiagnosticsTelemetry>({
    cameraFps: 0,
    inferenceFps: 0,
    detectionLatencyMs: 0,
    trackingLatencyMs: 0,
    embeddingLatencyMs: 0,
    totalCvLatencyMs: 0,
    activeTracksCount: 0,
    facesDetectedCount: 0,
    modelsLoaded: false,
    webGpuActive: false,
    backendOnline: true,
    hasGeminiKey: true,
  });

  // Media Elements Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const lastSightingRecordTimes = useRef<Record<string, number>>({});

  // 1. Staged Model Initialization & Database Preloading
  useEffect(() => {
    let isMounted = true;

    async function initSystem() {
      try {
        setIsLoadingDetector(true);
        const stageStatus = await initializeVisionModels((status: ModelStageStatus) => {
          if (!isMounted) return;
          if (status.isDetectorReady) {
            setIsLoadingDetector(false);
          }
          setTelemetry((prev) => ({
            ...prev,
            modelsLoaded: status.isDetectorReady,
            webGpuActive: status.backend === 'webgpu',
          }));
        });

        if (stageStatus.isDetectorReady && isMounted) {
          setIsLoadingDetector(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setDetectorError(err?.message || 'Failed to initialize computer vision models.');
          setIsLoadingDetector(false);
        }
      }

      // Load enrolled identities from IndexedDB
      try {
        const profiles = await idb.getAllIdentities();
        if (isMounted) {
          setEnrolledProfiles(profiles);
          visionEngine.setEnrolledProfiles(profiles);
        }
      } catch (e) {
        console.warn('IDB load error:', e);
      }

      // Verify server health
      try {
        const healthRes = await fetch('/api/health');
        if (healthRes.ok) {
          const data = await healthRes.json();
          if (isMounted) {
            setHasGeminiKey(Boolean(data.hasGeminiKey));
            setTelemetry((prev) => ({
              ...prev,
              backendOnline: true,
              hasGeminiKey: Boolean(data.hasGeminiKey),
            }));
          }
        }
      } catch {
        if (isMounted) {
          setTelemetry((prev) => ({ ...prev, backendOnline: false }));
        }
      }
    }

    initSystem();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Continuous Native Webcam Stream Setup
  const startWebcam = useCallback(async () => {
    setIsCameraError(false);
    setCameraErrorMessage('');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setIsCameraError(true);
      setCameraErrorMessage('Webcam media device API is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('autoplay', 'true');
        videoRef.current.muted = true;
        await videoRef.current.play().catch((err) => {
          console.warn('Video play triggered exception:', err);
        });
      }
    } catch (err: any) {
      console.warn('Webcam stream unavailable:', err);
      setIsCameraError(true);
      setCameraErrorMessage(
        err?.name === 'NotAllowedError'
          ? 'Camera access was denied. Please allow camera permissions in your browser.'
          : 'Unable to connect to camera device.'
      );
    }
  }, []);

  const stopWebcam = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  // Handle Mode Switching
  useEffect(() => {
    if (mode === 'webcam') {
      startWebcam();
    } else {
      stopWebcam();
      setIsCameraError(false);
    }

    return () => {
      if (mode === 'webcam') stopWebcam();
    };
  }, [mode, startWebcam, stopWebcam]);

  // 3. Connect Decoupled Vision Engine
  useEffect(() => {
    visionEngine.setEnrolledProfiles(enrolledProfiles);
    visionEngine.setLandmarksEnabled(showLandmarks);

    visionEngine.start(
      () => {
        if (!isStreaming) return null;
        if (mode === 'webcam') return videoRef.current;
        return imageRef.current;
      },
      ({ tracks, targetState: newTargetState, telemetry: newTelemetry, session: newSession }) => {
        setTrackedFaces(tracks);
        setSession(newSession);
        setTargetState(newTargetState);
        setTelemetry((prev) => ({
          ...prev,
          cameraFps: newTelemetry.cameraFps,
          inferenceFps: newTelemetry.inferenceFps,
          detectionLatencyMs: newTelemetry.detectionLatencyMs,
          trackingLatencyMs: newTelemetry.trackingLatencyMs,
          embeddingLatencyMs: newTelemetry.embeddingLatencyMs,
          totalCvLatencyMs: newTelemetry.totalCvLatencyMs,
          activeTracksCount: newTelemetry.activeTracksCount,
          facesDetectedCount: newTelemetry.facesDetectedCount,
          modelsLoaded: newTelemetry.modelsLoaded,
          webGpuActive: newTelemetry.webGpuActive,
        }));

        // Periodic Sighting logging in background
        const now = Date.now();
        for (const track of tracks) {
          if (track.identity.status === 'KNOWN' && track.identity.personId) {
            const lastLogged = lastSightingRecordTimes.current[track.identity.personId] || 0;
            if (now - lastLogged > 10000) {
              lastSightingRecordTimes.current[track.identity.personId] = now;
              idb.addSighting({
                id: `sight_${now}_${Math.random().toString(36).substr(2, 5)}`,
                personId: track.identity.personId,
                personName: track.identity.name || 'Known Person',
                timestamp: now,
                confidence: track.identity.confidence,
                ageEstimate: track.age.smoothedAge,
                expression: track.expression.dominant,
                boundingBox: track.box,
              });
            }
          }
        }
      }
    );

    return () => {
      visionEngine.stop();
    };
  }, [mode, isStreaming, enrolledProfiles, showLandmarks]);

  // 4. Target Management Handlers
  const handleLockTarget = useCallback(
    (name: string, face: TrackedFace | null, personId?: string) => {
      const updated = targetTracker.lockTarget(face, name, personId);
      setTargetState(updated);
    },
    []
  );

  const handleUnlockTarget = useCallback(() => {
    const updated = targetTracker.unlockTarget();
    setTargetState(updated);
  }, []);

  const handleSearchTarget = useCallback(
    (name: string) => {
      const res = targetTracker.searchTarget(name, enrolledProfiles, trackedFaces);
      setTargetState(res.targetState);
    },
    [enrolledProfiles, trackedFaces]
  );

  const handleQuickLockTarget = useCallback(
    (trackId: number) => {
      const face = trackedFaces.find((t) => t.trackId === trackId);
      if (face) {
        const name = face.identity.name || `Target_${trackId}`;
        handleLockTarget(name, face, face.identity.personId);
      }
    },
    [trackedFaces, handleLockTarget]
  );

  // 5. Deep Multimodal AI Scan (Gemini 3.8 Flash)
  const handleTriggerDeepScan = async () => {
    const source = videoRef.current || imageRef.current || canvasRef.current;
    if (!source) return;

    setIsDeepScanning(true);
    setIsDeepScanOpen(true);
    const scanStart = performance.now();

    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 640;
      tempCanvas.height = 360;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(source, 0, 0, tempCanvas.width, tempCanvas.height);
      }
      const base64 = tempCanvas.toDataURL('image/jpeg', 0.85);

      const localCVData = {
        facesCount: trackedFaces.length,
        faces: trackedFaces.map((f) => ({
          trackId: f.trackId,
          name: f.identity.name,
          age: f.age.smoothedAge,
          expression: f.expression.dominant,
          quality: f.quality.overall,
        })),
        targetName: targetState.locked ? targetState.name : null,
      };

      const res = await aiPost('/api/gemini/deep-scan', { imageBase64: base64, localCVData }, 'vision');

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error || `Deep scan request returned status ${res.status}`);
      }

      const data = await res.json();
      const scanLatency = Math.round(performance.now() - scanStart);

      setDeepScanResult({
        ...data.data,
        latencyMs: scanLatency,
        timestamp: Date.now(),
      });

      setTelemetry((prev) => ({
        ...prev,
        geminiLatencyMs: scanLatency,
      }));
    } catch (err: any) {
      console.warn('Deep scan failure:', err);
      setDeepScanResult({
        sceneSummary: 'AI provider is unavailable (check the API settings, key or quota). Local CV engine is active.',
        facesDetected: trackedFaces.length,
        faces: trackedFaces.map((f) => ({
          faceIndex: f.trackId,
          observedExpression: f.expression.dominant,
          approximateAgeRange: `${f.age.minAge}-${f.age.maxAge}`,
          visualAttributes: [f.gender || 'Person', `Track #${f.trackId}`],
          confidenceScore: f.identity.confidence,
        })),
        cvConsistency: 'HIGH',
        contextualInsights: ['Local computer vision tracking remains authoritative and uninterrupted.'],
        timestamp: Date.now(),
        latencyMs: Math.round(performance.now() - scanStart),
      });
    } finally {
      setIsDeepScanning(false);
    }
  };

  const handleOpenFaceDetails = (face: TrackedFace) => {
    setInspectedFace(face);
    setIsFaceDetailsOpen(true);
  };

  const handleEnrollSuccess = async (newProfile: IdentityProfile) => {
    const updated = await idb.getAllIdentities();
    setEnrolledProfiles(updated);
    visionEngine.setEnrolledProfiles(updated);
  };

  const selectedFace = trackedFaces.find((t) => t.trackId === selectedTrackId);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-mono selection:bg-cyan-500 selection:text-black">
      {/* 1. Header Bar */}
      <Header
        mode={mode}
        onModeChange={(newMode) => {
          setMode(newMode);
          if (newMode === 'sample' && !activeSample) {
            setActiveSample(SAMPLE_PORTRAITS[0]);
          }
        }}
        isStreaming={isStreaming}
        onToggleStreaming={() => setIsStreaming((prev) => !prev)}
        targetState={targetState}
        hasGeminiKey={hasGeminiKey}
        onOpenAISettings={() => setIsAISettingsOpen(true)}
        onOpenEnrollment={() => setIsEnrollmentOpen(true)}
        onOpenMemory={() => setIsMemoryOpen(true)}
        onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
        onTriggerDeepScan={handleTriggerDeepScan}
        isDeepScanning={isDeepScanning}
        telemetry={telemetry}
      />

      {/* 2. Main Workstation Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:p-6 flex flex-col gap-4">
        {/* Sample Scene Selector (when in sample mode) */}
        {mode === 'sample' && (
          <SampleSelector
            activeSample={activeSample}
            onSelectSample={(s: SamplePortrait) => setActiveSample(s)}
          />
        )}

        {/* Core Vision & Telemetry Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Main Camera & HUD Canvas (Col 8) */}
          <div className="lg:col-span-8 flex flex-col gap-3">
            <LiveVision
              mode={mode}
              activeSample={activeSample}
              uploadedImageUrl={uploadedImageUrl}
              trackedFaces={trackedFaces}
              selectedTrackId={selectedTrackId}
              onSelectTrack={(id) => setSelectedTrackId(id)}
              targetState={targetState}
              onQuickLockTarget={handleQuickLockTarget}
              isMirrored={isMirrored}
              onToggleMirror={() => setIsMirrored((prev) => !prev)}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => setIsFullscreen((prev) => !prev)}
              videoRef={videoRef}
              canvasRef={canvasRef}
              imageRef={imageRef}
              isStreaming={isStreaming}
              isLoadingDetector={isLoadingDetector}
              detectorError={detectorError}
              onRetryCamera={startWebcam}
              isCameraError={isCameraError}
              cameraErrorMessage={cameraErrorMessage}
              showLandmarks={showLandmarks}
              onToggleLandmarks={() => setShowLandmarks((prev) => !prev)}
            />

            {/* Quick Action Dock */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEnrollmentOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-bold transition-all shadow-sm"
                >
                  + Enroll Identity
                </button>
                <button
                  onClick={() => setIsMemoryOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-all"
                >
                  Gallery ({enrolledProfiles.length})
                </button>
                <button
                  onClick={handleTriggerDeepScan}
                  disabled={isDeepScanning}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 font-bold transition-all disabled:opacity-50"
                >
                  {isDeepScanning ? 'Scanning...' : 'Deep AI Scan'}
                </button>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                <span>
                  Camera: <strong className="text-emerald-400">{telemetry.cameraFps} FPS</strong>
                </span>
                <span>
                  Vision: <strong className="text-cyan-400">{telemetry.inferenceFps} FPS</strong>
                </span>
                <button
                  onClick={() => setIsDiagnosticsOpen(true)}
                  className="text-zinc-400 hover:text-zinc-200 underline"
                >
                  Diagnostics
                </button>
              </div>
            </div>
          </div>

          {/* Right Intelligence Panels (Col 4) */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            {/* Session Memory (temporary, separate from enrolled identities) */}
            <SessionPanel
              session={session}
              onStart={() => visionEngine.startSession()}
              onStop={() => visionEngine.stopSession()}
              onRefresh={() => visionEngine.refreshSession()}
            />

            {/* Target Following Subsystem */}
            <TargetPanel
              targetState={targetState}
              selectedFace={selectedFace}
              enrolledProfiles={enrolledProfiles}
              onLockTarget={handleLockTarget}
              onUnlockTarget={handleUnlockTarget}
              onSearchTarget={handleSearchTarget}
              onReEnrollTarget={() => setIsEnrollmentOpen(true)}
              onDeepAnalyzeFace={handleOpenFaceDetails}
            />

            {/* People in Frame Panel */}
            <PeoplePanel
              faces={trackedFaces}
              selectedTrackId={selectedTrackId}
              onSelectTrack={(id) => setSelectedTrackId(id)}
              targetTrackId={targetState.locked ? targetState.trackId : undefined}
              onQuickLockTarget={handleQuickLockTarget}
              onDeepAnalyzeFace={handleOpenFaceDetails}
            />
          </div>
        </div>
      </main>

      {/* 3. Natural Language Assistant Command Bar */}
      <VisionAssistant
        faces={trackedFaces}
        enrolledProfiles={enrolledProfiles}
        targetState={targetState}
        onLockTarget={handleLockTarget}
        onUnlockTarget={handleUnlockTarget}
        onSearchTarget={handleSearchTarget}
        onSelectTrack={(id) => setSelectedTrackId(id)}
        onTriggerDeepScan={handleTriggerDeepScan}
        onOpenMemory={() => setIsMemoryOpen(true)}
        hasGeminiKey={hasGeminiKey}
      />

      {/* Modals */}
      <EnrollmentWizard
        isOpen={isEnrollmentOpen}
        onClose={() => setIsEnrollmentOpen(false)}
        currentFaces={trackedFaces}
        selectedTrackId={selectedTrackId}
        videoRef={videoRef}
        canvasRef={canvasRef}
        imageRef={imageRef}
        onEnrollmentComplete={handleEnrollSuccess}
      />

      <IdentityMemoryModal
        isOpen={isMemoryOpen}
        onClose={() => setIsMemoryOpen(false)}
        identities={enrolledProfiles}
        onRefreshIdentities={async () => {
          const updated = await idb.getAllIdentities();
          setEnrolledProfiles(updated);
          visionEngine.setEnrolledProfiles(updated);
        }}
        onOpenEnrollment={() => setIsEnrollmentOpen(true)}
      />

      <DiagnosticsDrawer
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        telemetry={telemetry}
        targetState={targetState}
      />

      <DeepScanModal
        isOpen={isDeepScanOpen}
        onClose={() => setIsDeepScanOpen(false)}
        deepScanResult={deepScanResult}
        localFaces={trackedFaces}
        isScanning={isDeepScanning}
      />

      <AISettingsModal isOpen={isAISettingsOpen} onClose={() => setIsAISettingsOpen(false)} serverHasKey={serverHasKey} />

      <FaceDetailsModal
        isOpen={isFaceDetailsOpen}
        onClose={() => setIsFaceDetailsOpen(false)}
        face={inspectedFace}
        videoRef={videoRef}
        canvasRef={canvasRef}
        imageRef={imageRef}
        hasGeminiKey={hasGeminiKey}
      />
    </div>
  );
};

export default App;
