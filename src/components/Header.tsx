import React from 'react';
import {
  Camera,
  Image as ImageIcon,
  Upload,
  UserPlus,
  Database,
  Activity,
  Play,
  Pause,
  Scan,
  Sparkles,
  KeyRound,
} from 'lucide-react';
import { VideoSourceMode, TargetState, DiagnosticsTelemetry } from '../types';

interface HeaderProps {
  mode: VideoSourceMode;
  onModeChange: (mode: VideoSourceMode) => void;
  isStreaming: boolean;
  onToggleStreaming: () => void;
  targetState: TargetState;
  hasGeminiKey: boolean;
  onOpenAISettings: () => void;
  onOpenEnrollment: () => void;
  onOpenMemory: () => void;
  onOpenDiagnostics: () => void;
  onTriggerDeepScan: () => void;
  isDeepScanning: boolean;
  telemetry?: DiagnosticsTelemetry;
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  onModeChange,
  isStreaming,
  onToggleStreaming,
  targetState,
  hasGeminiKey,
  onOpenAISettings,
  onOpenEnrollment,
  onOpenMemory,
  onOpenDiagnostics,
  onTriggerDeepScan,
  isDeepScanning,
}) => {
  return (
    <header className="w-full bg-zinc-900/90 border border-zinc-800 backdrop-blur-md rounded-xl p-3 sm:p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-2xl">
      {/* Brand & Subsystem Indicators */}
      <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <Scan className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold tracking-wider text-zinc-100 uppercase font-mono">
                AI Face Intelligence
              </h1>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                PRO-CV
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-mono mt-0.5">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-emerald-400 font-medium">CAMERA ONLINE</span>
              </span>
              <span className="text-zinc-600">&bull;</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <span className="text-cyan-400 font-medium">VISION ENGINE ONLINE</span>
              </span>
              {targetState.locked && (
                <>
                  <span className="text-zinc-600">&bull;</span>
                  <span className="text-red-400 font-bold animate-pulse">
                    TARGET: {targetState.name.toUpperCase()}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mode Switches */}
      <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs font-mono">
        <button
          onClick={() => onModeChange('webcam')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
            mode === 'webcam'
              ? 'bg-emerald-500 text-black font-semibold shadow-[0_0_10px_rgba(16,185,129,0.3)]'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Webcam</span>
        </button>
        <button
          onClick={() => onModeChange('sample')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
            mode === 'sample'
              ? 'bg-emerald-500 text-black font-semibold shadow-[0_0_10px_rgba(16,185,129,0.3)]'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Test Scenes</span>
        </button>
        <button
          onClick={() => onModeChange('upload')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
            mode === 'upload'
              ? 'bg-emerald-500 text-black font-semibold shadow-[0_0_10px_rgba(16,185,129,0.3)]'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Upload</span>
        </button>
      </div>

      {/* Action Controls */}
      <div className="flex items-center gap-2 w-full md:w-auto justify-end">
        {/* Stream Pause / Play */}
        <button
          onClick={onToggleStreaming}
          title="Pause / Resume Live Worker (Hotkey: Q)"
          className={`p-2 rounded-lg border transition-all text-xs font-mono flex items-center gap-1.5 ${
            isStreaming
              ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700'
              : 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
          }`}
        >
          {isStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{isStreaming ? 'Pause' : 'Resume'}</span>
        </button>

        {/* AI provider / API settings */}
        <button
          onClick={onOpenAISettings}
          title="AI providers & API keys"
          className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-mono transition-all"
        >
          <KeyRound className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">API</span>
          <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-zinc-900 ${hasGeminiKey ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        </button>

        {/* Deep AI Scan Button */}
        <button
          onClick={onTriggerDeepScan}
          disabled={isDeepScanning}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-xs font-mono transition-all font-medium disabled:opacity-50 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
        >
          <Sparkles className={`w-3.5 h-3.5 ${isDeepScanning ? 'animate-spin' : ''}`} />
          <span>{isDeepScanning ? 'Scanning...' : 'Deep AI Scan'}</span>
        </button>

        {/* Smart Enrollment Wizard */}
        <button
          onClick={onOpenEnrollment}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-xs font-mono transition-all font-medium"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Enroll Face</span>
        </button>

        {/* Biometric Memory & History */}
        <button
          onClick={onOpenMemory}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-xs font-mono transition-all"
        >
          <Database className="w-3.5 h-3.5 text-zinc-400" />
          <span className="hidden sm:inline">Memory</span>
        </button>

        {/* Telemetry Diagnostics Drawer */}
        <button
          onClick={onOpenDiagnostics}
          title="Telemetry & Diagnostics"
          className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-xs font-mono transition-all"
        >
          <Activity className="w-4 h-4 text-emerald-400" />
        </button>
      </div>
    </header>
  );
};
