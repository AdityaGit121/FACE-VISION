import React from 'react';
import { X, Activity, Cpu, Zap, HardDrive, ShieldCheck, Layers, Gauge } from 'lucide-react';
import { DiagnosticsTelemetry, TargetState } from '../types';

interface DiagnosticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: DiagnosticsTelemetry;
  targetState: TargetState;
}

export const DiagnosticsDrawer: React.FC<DiagnosticsDrawerProps> = ({
  isOpen,
  onClose,
  telemetry,
  targetState,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-zinc-950 border-l border-zinc-800 z-50 p-5 flex flex-col font-mono shadow-2xl overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
            CV Telemetry & Diagnostics
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Latency & FPS Overview */}
      <div className="flex flex-col gap-4">
        <div className="bg-zinc-900/80 p-3.5 rounded-xl border border-zinc-800 flex flex-col gap-3">
          <div className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 uppercase">
            <Gauge className="w-4 h-4 text-emerald-400" />
            <span>Frame Rate & Pipeline Throughput</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
              <div className="text-[10px] text-zinc-500">Camera FPS</div>
              <div className="text-base font-bold text-emerald-400 mt-0.5">
                {telemetry.cameraFps} FPS
              </div>
            </div>
            <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
              <div className="text-[10px] text-zinc-500">Inference FPS</div>
              <div className="text-base font-bold text-cyan-400 mt-0.5">
                {telemetry.inferenceFps} FPS
              </div>
            </div>
          </div>
        </div>

        {/* Real Measured Latencies */}
        <div className="bg-zinc-900/80 p-3.5 rounded-xl border border-zinc-800 flex flex-col gap-2.5">
          <div className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 uppercase">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Measured Subsystem Latency</span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center text-zinc-400">
              <span>Face Detection</span>
              <span className="font-bold text-zinc-200">{telemetry.detectionLatencyMs} ms</span>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-amber-400 h-full"
                style={{ width: `${Math.min(100, (telemetry.detectionLatencyMs / 100) * 100)}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-zinc-400 pt-1">
              <span>Tracking Association</span>
              <span className="font-bold text-zinc-200">{telemetry.trackingLatencyMs} ms</span>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-emerald-400 h-full"
                style={{ width: `${Math.min(100, (telemetry.trackingLatencyMs / 30) * 100)}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-zinc-400 pt-1">
              <span>128-d Embedding Extraction</span>
              <span className="font-bold text-zinc-200">{telemetry.embeddingLatencyMs} ms</span>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-cyan-400 h-full"
                style={{ width: `${Math.min(100, (telemetry.embeddingLatencyMs / 50) * 100)}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-zinc-200 pt-2 border-t border-zinc-800 font-bold">
              <span>Total CV Cycle</span>
              <span className="text-emerald-400">{telemetry.totalCvLatencyMs} ms</span>
            </div>

            {telemetry.geminiLatencyMs !== undefined && (
              <div className="flex justify-between items-center text-cyan-300 pt-1 text-[11px]">
                <span>Gemini 3.8 Flash Roundtrip</span>
                <span>{telemetry.geminiLatencyMs} ms</span>
              </div>
            )}
          </div>
        </div>

        {/* Neural Engine & Hardware Hardware Status */}
        <div className="bg-zinc-900/80 p-3.5 rounded-xl border border-zinc-800 flex flex-col gap-2.5 text-xs">
          <div className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 uppercase">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span>Hardware & Neural Runtime</span>
          </div>

          <div className="flex justify-between text-zinc-400">
            <span>TensorFlow Acceleration</span>
            <span className="font-bold text-emerald-400">
              {telemetry.webGpuActive ? 'WebGPU' : 'WebGL'}
            </span>
          </div>

          <div className="flex justify-between text-zinc-400">
            <span>Model Weights</span>
            <span className={telemetry.modelsLoaded ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
              {telemetry.modelsLoaded ? 'Cached (Offline Ready)' : 'Loading...'}
            </span>
          </div>

          <div className="flex justify-between text-zinc-400">
            <span>Backend Bridge</span>
            <span className={telemetry.backendOnline ? 'text-emerald-400 font-bold' : 'text-zinc-500'}>
              {telemetry.backendOnline ? 'Express Port 3000' : 'Disconnected'}
            </span>
          </div>

          <div className="flex justify-between text-zinc-400">
            <span>Gemini Multimodal API</span>
            <span className={telemetry.hasGeminiKey ? 'text-cyan-400 font-bold' : 'text-zinc-500'}>
              {telemetry.hasGeminiKey ? 'Authenticated' : 'API Key Absent'}
            </span>
          </div>
        </div>

        {/* State Trackers */}
        <div className="bg-zinc-900/80 p-3.5 rounded-xl border border-zinc-800 flex flex-col gap-2.5 text-xs">
          <div className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 uppercase">
            <Layers className="w-4 h-4 text-zinc-400" />
            <span>Pipeline State Metrics</span>
          </div>

          <div className="flex justify-between text-zinc-400">
            <span>Faces in Frame</span>
            <span className="font-bold text-zinc-200">{telemetry.facesDetectedCount}</span>
          </div>

          <div className="flex justify-between text-zinc-400">
            <span>Active Tracks</span>
            <span className="font-bold text-zinc-200">{telemetry.activeTracksCount}</span>
          </div>

          <div className="flex justify-between text-zinc-400">
            <span>Target Lock Status</span>
            <span className={targetState.locked ? 'text-red-400 font-bold' : 'text-zinc-500'}>
              {targetState.locked ? `${targetState.name} (${targetState.status})` : 'None'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
