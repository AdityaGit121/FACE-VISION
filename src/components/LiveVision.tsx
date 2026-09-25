import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Maximize2,
  Minimize2,
  FlipHorizontal,
  Eye,
  AlertCircle,
  Lock,
  Search,
  CheckCircle2,
  RefreshCw,
  CameraOff,
} from 'lucide-react';
import { TrackedFace, TargetState, VideoSourceMode } from '../types';
import { SamplePortrait } from '../data/samples';
import { ExtendedTrackState } from '../tracking/multiFaceTracker';
import { visionEngine } from '../vision/visionEngine';
import { sessionMemory } from '../identity/sessionMemory';

// Stable colour per session person: Person 2 keeps its colour when they leave and come back.
const SESSION_COLORS = ['#10b981', '#f59e0b', '#a78bfa', '#f472b6', '#38bdf8', '#fb923c', '#a3e635', '#2dd4bf'];

interface LiveVisionProps {
  mode: VideoSourceMode;
  activeSample: SamplePortrait | null;
  uploadedImageUrl: string | null;
  trackedFaces: ExtendedTrackState[];
  selectedTrackId: number | null;
  onSelectTrack: (trackId: number) => void;
  targetState: TargetState;
  onQuickLockTarget: (trackId: number) => void;
  isMirrored: boolean;
  onToggleMirror: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  imageRef: React.RefObject<HTMLImageElement | null>;
  isStreaming: boolean;
  isLoadingDetector: boolean;
  detectorError: string | null;
  onRetryCamera?: () => void;
  isCameraError?: boolean;
  cameraErrorMessage?: string;
  showLandmarks: boolean;
  onToggleLandmarks: () => void;
}

interface RenderLabel {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  isTarget: boolean;
  isSelected: boolean;
  color: string;
  bgColor: string;
  alpha: number;
}

interface InterpolatedTrack {
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
}

export const LiveVision: React.FC<LiveVisionProps> = ({
  mode,
  activeSample,
  uploadedImageUrl,
  trackedFaces,
  selectedTrackId,
  onSelectTrack,
  targetState,
  onQuickLockTarget,
  isMirrored,
  onToggleMirror,
  isFullscreen,
  onToggleFullscreen,
  videoRef,
  canvasRef,
  imageRef,
  isStreaming,
  isLoadingDetector,
  detectorError,
  onRetryCamera,
  isCameraError,
  cameraErrorMessage,
  showLandmarks,
  onToggleLandmarks,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Sync Canvas internal dimensions with media source
  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (mode === 'webcam' && videoRef.current) {
      const v = videoRef.current;
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        if (canvas.width !== v.videoWidth || canvas.height !== v.videoHeight) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
        }
      }
    } else if ((mode === 'sample' || mode === 'upload') && imageRef.current) {
      const img = imageRef.current;
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
        }
      }
    }
  }, [mode, videoRef, imageRef, canvasRef]);

  // Keep a ref of latest trackedFaces for the 60fps render loop
  const latestFacesRef = useRef<ExtendedTrackState[]>(trackedFaces);
  latestFacesRef.current = trackedFaces;

  const latestTargetRef = useRef<TargetState>(targetState);
  latestTargetRef.current = targetState;

  const latestSelectedTrackIdRef = useRef<number | null>(selectedTrackId);
  latestSelectedTrackIdRef.current = selectedTrackId;

  const latestMirrorRef = useRef<boolean>(isMirrored && mode === 'webcam');
  latestMirrorRef.current = isMirrored && mode === 'webcam';

  const latestShowLandmarksRef = useRef<boolean>(showLandmarks);
  latestShowLandmarksRef.current = showLandmarks;

  // Continuous 60 FPS Native HUD Overlay Rendering with Smooth Box Interpolation
  useEffect(() => {
    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      syncCanvasSize();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Pull latency-compensated (Kalman-extrapolated) boxes straight from the engine every frame,
      // instead of waiting for React state that only updates a few times per second.
      const faces = visionEngine.getRenderTracks(performance.now());
      const mirror = latestMirrorRef.current;
      const target = latestTargetRef.current;
      const selectedId = latestSelectedTrackIdRef.current;
      const displayLandmarks = latestShowLandmarksRef.current;

      if (!isLoadingDetector && isStreaming && faces.length > 0) {
        const canvasW = canvas.width;
        const canvasH = canvas.height;
        const scale = Math.max(1.0, Math.min(2.2, canvasW / 720));

        const labelsToRender: RenderLabel[] = [];

        // 1. Draw Bounding Boxes with smooth sub-pixel interpolation
        for (const face of faces) {
          // face.box is already Kalman-filtered + extrapolated to now: draw it as is (no extra lerp).
          const { x, y, width, height } = face.box;

          const isSelected = face.trackId === selectedId;
          const isTarget = face.trackId === target.trackId && target.locked;

          // Clean, professional theme colors
          let boxColor = '#10b981'; // Emerald for standard tracks
          let bgColor = 'rgba(16, 185, 129, 0.08)';

          if (isTarget) {
            boxColor = '#ef4444'; // Red for Target Lock
            bgColor = 'rgba(239, 68, 68, 0.12)';
          } else if (isSelected) {
            boxColor = '#06b6d4'; // Cyan for selected inspection
            bgColor = 'rgba(6, 182, 212, 0.10)';
          } else if (face.sessionPersonId !== undefined && face.identity.status !== 'KNOWN') {
            boxColor = SESSION_COLORS[(face.sessionPersonId - 1) % SESSION_COLORS.length];
            bgColor = boxColor + '14';
          } else if (face.identity.status === 'KNOWN') {
            boxColor = '#3b82f6'; // Blue for Known
            bgColor = 'rgba(59, 130, 246, 0.08)';
          }

          ctx.save();
          ctx.globalAlpha = Math.max(0.15, face.opacity ?? 1);
          if (mirror) {
            ctx.translate(canvasW, 0);
            ctx.scale(-1, 1);
          }

          // Bounding Box
          ctx.lineWidth = Math.round(isTarget ? 3.5 * scale : 2.5 * scale);
          ctx.strokeStyle = boxColor;
          ctx.fillStyle = bgColor;
          ctx.fillRect(x, y, width, height);

          // Corner Brackets
          const cornerLen = Math.min(30 * scale, Math.max(14 * scale, width * 0.22));
          ctx.lineWidth = Math.round(isTarget ? 4 * scale : 3 * scale);
          ctx.beginPath();
          // Top-Left
          ctx.moveTo(x, y + cornerLen);
          ctx.lineTo(x, y);
          ctx.lineTo(x + cornerLen, y);
          // Top-Right
          ctx.moveTo(x + width - cornerLen, y);
          ctx.lineTo(x + width, y);
          ctx.lineTo(x + width, y + cornerLen);
          // Bottom-Right
          ctx.moveTo(x + width, y + height - cornerLen);
          ctx.lineTo(x + width, y + height);
          ctx.lineTo(x + width - cornerLen, y + height);
          // Bottom-Left
          ctx.moveTo(x + cornerLen, y + height);
          ctx.lineTo(x, y + height);
          ctx.lineTo(x, y + height - cornerLen);
          ctx.stroke();

          // Target Reticle
          if (isTarget) {
            const cx = x + width / 2;
            const cy = y + height / 2;
            const retSize = Math.max(12 * scale, width * 0.12);
            ctx.lineWidth = 2 * scale;
            ctx.strokeStyle = '#ef4444';
            ctx.beginPath();
            ctx.moveTo(cx - retSize, cy);
            ctx.lineTo(cx + retSize, cy);
            ctx.moveTo(cx, cy - retSize);
            ctx.lineTo(cx, cy + retSize);
            ctx.stroke();
          }

          // 68 Facial Landmarks
          if (displayLandmarks && face.landmarks) {
            ctx.fillStyle = boxColor;
            const radius = Math.max(1.5, 2 * scale);
            const ref = (face as any).landmarksRef as { x: number; y: number; width: number; height: number } | undefined;
            for (const pt of face.landmarks) {
              // Re-project onto the live box so landmarks follow the face between analysis jobs.
              const lx = ref ? x + ((pt.x - ref.x) / ref.width) * width : pt.x;
              const ly = ref ? y + ((pt.y - ref.y) / ref.height) * height : pt.y;
              ctx.beginPath();
              ctx.arc(lx, ly, radius, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          ctx.restore();

          // Label Text
          const enrolledName =
            face.identity.status === 'KNOWN' && face.identity.name ? face.identity.name : null;
          const sessionActive = sessionMemory.active;
          const name = enrolledName
            ? face.sessionLabel ? `${enrolledName} · ${face.sessionLabel}` : enrolledName
            : face.sessionLabel
            ? face.sessionLabel
            : sessionActive
            ? 'IDENTIFYING...'
            : face.identity.status === 'UNCERTAIN'
            ? 'UNCERTAIN'
            : 'UNKNOWN';

          // With an active session the label is the session person (stable across leave/return);
          // the throwaway track number is only shown when no session is running.
          const labelText = isTarget
            ? `TARGET: ${name}`
            : sessionActive
            ? name
            : `#${String(face.trackId).padStart(2, '0')} ${name}`;

          const fontSize = Math.round(13 * scale);
          ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
          const textWidth = ctx.measureText(labelText).width;
          const labelPadding = 8 * scale;
          const labelW = textWidth + labelPadding * 2;
          const labelH = Math.round(24 * scale);

          // Boundary Checking
          let labelX = mirror ? canvasW - x - width : x;
          let labelY = y - labelH - 3;

          if (labelX + labelW > canvasW - 6) {
            labelX = canvasW - labelW - 6;
          }
          if (labelX < 6) {
            labelX = 6;
          }

          if (labelY < 4) {
            labelY = y + 4;
          }

          labelsToRender.push({
            x: labelX,
            y: labelY,
            width: labelW,
            height: labelH,
            text: labelText,
            isTarget,
            isSelected,
            color: isTarget ? '#ffffff' : boxColor,
            alpha: Math.max(0.15, face.opacity ?? 1),
            bgColor: isTarget ? '#ef4444' : 'rgba(9, 9, 11, 0.90)',
          });
        }

        // 2. Anti-Collision Label Layout: Offset overlapping labels vertically
        for (let i = 0; i < labelsToRender.length; i++) {
          for (let j = i + 1; j < labelsToRender.length; j++) {
            const a = labelsToRender[i];
            const b = labelsToRender[j];

            if (
              a.x < b.x + b.width &&
              a.x + a.width > b.x &&
              a.y < b.y + b.height &&
              a.y + a.height > b.y
            ) {
              b.y = a.y + a.height + 3;
            }
          }
        }

        // 3. Render Non-Overlapping Labels
        for (const label of labelsToRender) {
          ctx.save();
          ctx.globalAlpha = label.alpha;
          ctx.fillStyle = label.bgColor;
          ctx.fillRect(label.x, label.y, label.width, label.height);

          ctx.strokeStyle = label.color;
          ctx.lineWidth = 1.2 * scale;
          ctx.strokeRect(label.x, label.y, label.width, label.height);

          const fontSize = Math.round(13 * scale);
          ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
          ctx.fillStyle = label.color;
          ctx.fillText(label.text, label.x + 8 * scale, label.y + label.height * 0.70);
          ctx.restore();
        }
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [syncCanvasSize, isLoadingDetector, isStreaming]);

  // Click & Double-Click interactions
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // object-contain letterboxing: map through the displayed content rect, then un-mirror.
    const aspect = canvas.width / canvas.height;
    const contentW = rect.width / rect.height > aspect ? rect.height * aspect : rect.width;
    const contentH = rect.width / rect.height > aspect ? rect.height : rect.width / aspect;
    const offX = (rect.width - contentW) / 2;
    const offY = (rect.height - contentH) / 2;
    const clickY = ((e.clientY - rect.top - offY) / contentH) * canvas.height;
    const rawX = ((e.clientX - rect.left - offX) / contentW) * canvas.width;
    const clickX = latestMirrorRef.current ? canvas.width - rawX : rawX;

    for (const face of visionEngine.getRenderTracks(performance.now())) {
      const { x, y, width, height } = face.box;
      const pad = 15;
      if (
        clickX >= x - pad &&
        clickX <= x + width + pad &&
        clickY >= y - pad &&
        clickY <= y + height + pad
      ) {
        onSelectTrack(face.trackId);
        return;
      }
    }
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // object-contain letterboxing: map through the displayed content rect, then un-mirror.
    const aspect = canvas.width / canvas.height;
    const contentW = rect.width / rect.height > aspect ? rect.height * aspect : rect.width;
    const contentH = rect.width / rect.height > aspect ? rect.height : rect.width / aspect;
    const offX = (rect.width - contentW) / 2;
    const offY = (rect.height - contentH) / 2;
    const clickY = ((e.clientY - rect.top - offY) / contentH) * canvas.height;
    const rawX = ((e.clientX - rect.left - offX) / contentW) * canvas.width;
    const clickX = latestMirrorRef.current ? canvas.width - rawX : rawX;

    for (const face of visionEngine.getRenderTracks(performance.now())) {
      const { x, y, width, height } = face.box;
      const pad = 15;
      if (
        clickX >= x - pad &&
        clickX <= x + width + pad &&
        clickY >= y - pad &&
        clickY <= y + height + pad
      ) {
        onQuickLockTarget(face.trackId);
        return;
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl flex flex-col ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'aspect-[16/10] sm:aspect-[16/9]'
      }`}
    >
      {/* Top Left Feed Status */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2 pointer-events-none">
        <div className="px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-[11px] font-mono text-zinc-300 flex items-center gap-2 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>CAMERA: {mode.toUpperCase()}</span>
          <span className="text-zinc-600">|</span>
          <span>FACES: <strong className="text-emerald-400">{trackedFaces.length}</strong></span>
          {sessionMemory.active && (
            <>
              <span className="text-zinc-600">|</span>
              <span>SESSION: <strong className="text-cyan-400">{sessionMemory.count}</strong></span>
            </>
          )}
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-400">{visionEngine.detectorName}</span>
        </div>
      </div>

      {/* Target Status Banner */}
      {targetState.locked && (
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
          {targetState.status === 'LOCKED' && (
            <div className="px-3 py-1 rounded-md bg-red-950/90 border border-red-500 text-red-200 font-mono text-xs font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(239,68,68,0.3)] backdrop-blur-md">
              <Lock className="w-3.5 h-3.5 text-red-400 animate-pulse" />
              <span>TARGET LOCKED: {targetState.name}</span>
            </div>
          )}
          {targetState.status === 'SEARCHING' && (
            <div className="px-3 py-1 rounded-md bg-amber-950/90 border border-amber-500 text-amber-200 font-mono text-xs font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.3)] backdrop-blur-md animate-pulse">
              <Search className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              <span>SEARCHING FOR {targetState.name}...</span>
            </div>
          )}
          {targetState.status === 'REACQUIRED' && (
            <div className="px-3 py-1 rounded-md bg-emerald-950/90 border border-emerald-500 text-emerald-200 font-mono text-xs font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)] backdrop-blur-md">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>REACQUIRED: {targetState.name}</span>
            </div>
          )}
          {targetState.status === 'LOST' && (
            <div className="px-3 py-1 rounded-md bg-zinc-900/90 border border-zinc-700 text-zinc-300 font-mono text-xs font-bold flex items-center gap-1.5 backdrop-blur-md">
              <AlertCircle className="w-3.5 h-3.5 text-zinc-500" />
              <span>TARGET LOST: {targetState.name}</span>
            </div>
          )}
        </div>
      )}

      {/* Media Feed: Continuous Native Video Playback OR Image */}
      <div className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden">
        {mode === 'webcam' ? (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-contain ${isMirrored ? 'scale-x-[-1]' : ''}`}
          />
        ) : (
          <img
            ref={imageRef}
            crossOrigin="anonymous"
            src={mode === 'sample' ? activeSample?.url : uploadedImageUrl || ''}
            alt="Source Frame"
            className="w-full h-full object-contain select-none pointer-events-none"
          />
        )}

        {/* HUD Canvas Overlay */}
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDoubleClick}
          className="absolute inset-0 w-full h-full object-contain cursor-crosshair z-20"
        />

        {/* Camera Failure Message with Retry Button */}
        {isCameraError && (
          <div className="absolute inset-0 bg-black/95 z-40 flex flex-col items-center justify-center p-6 text-center gap-3">
            <CameraOff className="w-12 h-12 text-zinc-500" />
            <div className="text-sm font-bold text-zinc-200 font-mono uppercase tracking-wider">
              CAMERA OFFLINE
            </div>
            <p className="text-xs text-zinc-400 max-w-sm font-mono">
              {cameraErrorMessage || 'Unable to access video stream. Please grant camera permission.'}
            </p>
            {onRetryCamera && (
              <button
                onClick={onRetryCamera}
                className="mt-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold flex items-center gap-2 transition-all shadow-lg"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Camera Connection</span>
              </button>
            )}
          </div>
        )}

        {/* Detector Loading Indicator */}
        {isLoadingDetector && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-40 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
            <div className="font-mono text-xs text-emerald-400 font-bold uppercase tracking-wider">
              Starting Face Detection Engine
            </div>
          </div>
        )}

        {/* Detector Error */}
        {detectorError && (
          <div className="absolute inset-0 bg-black/90 z-40 flex flex-col items-center justify-center p-6 text-center gap-2">
            <AlertCircle className="w-10 h-10 text-red-400" />
            <div className="text-xs font-bold text-red-300 font-mono">
              Face Detector Initialization Error
            </div>
            <div className="text-[11px] text-zinc-400 max-w-md font-mono">{detectorError}</div>
          </div>
        )}
      </div>

      {/* Floating Bottom HUD Controls */}
      <div className="absolute bottom-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {mode === 'webcam' && (
            <button
              onClick={onToggleMirror}
              title="Mirror Camera (M)"
              className={`px-2.5 py-1 rounded-md border text-[11px] font-mono transition-all flex items-center gap-1.5 backdrop-blur-md ${
                isMirrored
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                  : 'bg-black/70 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span>Mirror</span>
            </button>
          )}

          <button
            onClick={onToggleLandmarks}
            title="Toggle Facial Landmarks"
            className={`px-2.5 py-1 rounded-md border text-[11px] font-mono transition-all flex items-center gap-1.5 backdrop-blur-md ${
              showLandmarks
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                : 'bg-black/70 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Landmarks</span>
          </button>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={onToggleFullscreen}
            title="Toggle Fullscreen (F)"
            className="p-1.5 rounded-md bg-black/70 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-mono transition-all backdrop-blur-md"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};
