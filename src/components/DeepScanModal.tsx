import React from 'react';
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Cpu,
  Eye,
  Activity,
} from 'lucide-react';
import { DeepScanResult, TrackedFace } from '../types';

interface DeepScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  deepScanResult: DeepScanResult | null;
  localFaces: TrackedFace[];
  isScanning: boolean;
}

export const DeepScanModal: React.FC<DeepScanModalProps> = ({
  isOpen,
  onClose,
  deepScanResult,
  localFaces,
  isScanning,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col font-mono max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 uppercase">
                Multimodal AI Deep Scan & Result Fusion
              </h3>
              <p className="text-[11px] text-zinc-400">
                Local Fast CV &bull; Gemini 3.8 Flash Vision Cross-Check
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
          {isScanning && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
              <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                Synthesizing Local CV + Multimodal Reasoning
              </div>
              <p className="text-[11px] text-zinc-500">
                Sending frame to server-side Gemini 3.8 Flash...
              </p>
            </div>
          )}

          {!isScanning && !deepScanResult && (
            <div className="text-center py-12 text-xs text-zinc-500">
              No Deep Scan data available. Click "Deep AI Scan" in the header to run an inspection.
            </div>
          )}

          {!isScanning && deepScanResult && (
            <>
              {/* Result Fusion Banner */}
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-200">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span>SYSTEM CONSISTENCY ASSESSMENT</span>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                      deepScanResult.cvConsistency === 'HIGH'
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                        : deepScanResult.cvConsistency === 'MODERATE'
                        ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                        : 'bg-red-500/20 text-red-400 border-red-500/40'
                    }`}
                  >
                    CONSISTENCY: {deepScanResult.cvConsistency}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                  <div className="bg-zinc-900 p-2.5 rounded-lg border border-zinc-800">
                    <div className="text-[10px] text-zinc-500 uppercase flex items-center gap-1">
                      <Cpu className="w-3 h-3 text-emerald-400" />
                      <span>Local Computer Vision</span>
                    </div>
                    <div className="text-sm font-bold text-emerald-400 mt-1">
                      {localFaces.length} Faces Detected
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      Deterministic real-time embeddings
                    </div>
                  </div>

                  <div className="bg-zinc-900 p-2.5 rounded-lg border border-zinc-800">
                    <div className="text-[10px] text-zinc-500 uppercase flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                      <span>Gemini 3.8 Multimodal</span>
                    </div>
                    <div className="text-sm font-bold text-cyan-400 mt-1">
                      {deepScanResult.facesDetected} Faces Interpreted
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      High-level contextual reasoning
                    </div>
                  </div>
                </div>

                <div className="text-xs text-zinc-300 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80 leading-relaxed">
                  <span className="text-zinc-500 font-semibold block mb-1">Scene Summary:</span>
                  {deepScanResult.sceneSummary}
                </div>
              </div>

              {/* Individual Face Breakdown */}
              <div className="flex flex-col gap-2.5">
                <div className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                  Observed Face Attributes ({deepScanResult.faces.length})
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {deepScanResult.faces.map((f, i) => (
                    <div
                      key={i}
                      className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-xs flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-cyan-400">
                          Person #{f.faceIndex}
                        </span>
                        <span className="text-[11px] text-zinc-400">
                          Approx Age: <strong className="text-zinc-200">{f.approximateAgeRange}</strong>
                        </span>
                      </div>

                      <div className="text-[11px] text-zinc-300">
                        Expression: <strong className="text-amber-300 capitalize">{f.observedExpression}</strong>
                      </div>

                      {f.visualAttributes && f.visualAttributes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {f.visualAttributes.map((attr, ai) => (
                            <span
                              key={ai}
                              className="px-2 py-0.5 rounded text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400"
                            >
                              {attr}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Contextual Insights */}
              {deepScanResult.contextualInsights && deepScanResult.contextualInsights.length > 0 && (
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex flex-col gap-1.5 text-xs">
                  <div className="font-bold text-zinc-400 uppercase text-[10px]">
                    Contextual Insights
                  </div>
                  <ul className="list-disc list-inside text-zinc-300 space-y-1 text-[11px]">
                    {deepScanResult.contextualInsights.map((ci, idx) => (
                      <li key={idx}>{ci}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
          <span>Latency: {deepScanResult?.latencyMs ?? 0}ms</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
