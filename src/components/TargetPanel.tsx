import React, { useState } from 'react';
import {
  Crosshair,
  Lock,
  Unlock,
  Search,
  UserCheck,
  AlertCircle,
  Activity,
  UserPlus,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { TargetState, TrackedFace, IdentityProfile } from '../types';

interface TargetPanelProps {
  targetState: TargetState;
  selectedFace: TrackedFace | undefined;
  enrolledProfiles: IdentityProfile[];
  onLockTarget: (name: string, face: TrackedFace | null, personId?: string) => void;
  onUnlockTarget: () => void;
  onSearchTarget: (name: string) => void;
  onReEnrollTarget: () => void;
  onDeepAnalyzeFace: (face: TrackedFace) => void;
}

export const TargetPanel: React.FC<TargetPanelProps> = ({
  targetState,
  selectedFace,
  enrolledProfiles,
  onLockTarget,
  onUnlockTarget,
  onSearchTarget,
  onReEnrollTarget,
  onDeepAnalyzeFace,
}) => {
  const [nameInput, setNameInput] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');

  const handleLockSelected = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;

    if (selectedFace) {
      onLockTarget(nameInput.trim(), selectedFace, selectedFace.identity.personId);
    } else {
      // Find matching profile in enrolled profiles if any
      const match = enrolledProfiles.find(
        (p) => p.name.toLowerCase() === nameInput.trim().toLowerCase()
      );
      onLockTarget(nameInput.trim(), null, match?.id);
    }
    setNameInput('');
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    onSearchTarget(searchInput.trim());
    setSearchInput('');
  };

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 shadow-xl flex flex-col gap-4 font-mono">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-red-400 animate-pulse" />
          <h2 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
            Target Lock & Following Subsystem
          </h2>
        </div>
        {targetState.locked ? (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/40 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
            {targetState.status}
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
            IDLE
          </span>
        )}
      </div>

      {/* Target Status Card */}
      {targetState.locked ? (
        <div className="bg-zinc-950/80 border border-red-500/30 rounded-lg p-3.5 flex flex-col gap-3 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-full blur-2xl pointer-events-none" />

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Active Target</div>
              <div className="text-base font-bold text-red-300 flex items-center gap-1.5 mt-0.5">
                <Lock className="w-4 h-4 text-red-400" />
                <span>{targetState.name}</span>
              </div>
            </div>
            <button
              onClick={onUnlockTarget}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-xs flex items-center gap-1 transition-all"
            >
              <Unlock className="w-3 h-3 text-zinc-400" />
              <span>Unlock</span>
            </button>
          </div>

          {/* Telemetry Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800/80">
              <div className="text-[10px] text-zinc-500">Identity Conf</div>
              <div className="text-sm font-semibold text-emerald-400 mt-0.5">
                {targetState.identityConfidence > 0 ? `${targetState.identityConfidence}%` : '--'}
              </div>
            </div>
            <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800/80">
              <div className="text-[10px] text-zinc-500">Tracking Conf</div>
              <div className="text-sm font-semibold text-cyan-400 mt-0.5">
                {targetState.trackingConfidence > 0 ? `${targetState.trackingConfidence}%` : '--'}
              </div>
            </div>
            <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800/80">
              <div className="text-[10px] text-zinc-500">Estimated Age</div>
              <div className="text-sm font-semibold text-zinc-200 mt-0.5">
                {targetState.age ? `~${targetState.age}` : '--'}
              </div>
            </div>
            <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800/80">
              <div className="text-[10px] text-zinc-500">Expression</div>
              <div className="text-sm font-semibold text-amber-300 capitalize mt-0.5">
                {targetState.emotion || '--'}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-800/50">
            <span>
              Last Sighting:{' '}
              <strong className="text-zinc-300">
                {targetState.status === 'LOCKED' || targetState.status === 'REACQUIRED'
                  ? 'Active in frame'
                  : `${Math.round((Date.now() - targetState.lastSeen) / 1000)}s ago`}
              </strong>
            </span>
            {selectedFace && (
              <button
                onClick={() => onDeepAnalyzeFace(selectedFace)}
                className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-[11px]"
              >
                <Sparkles className="w-3 h-3" />
                <span>AI Face Deep Scan</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Lock Inactive State & Quick Lock */
        <div className="bg-zinc-950/60 border border-zinc-800/60 rounded-lg p-3 text-xs flex flex-col gap-3">
          <div className="text-zinc-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-zinc-500 shrink-0" />
            <span>
              {selectedFace
                ? `Person #${selectedFace.trackId} selected. Assign a name to lock target.`
                : 'Select any face on canvas or type a name to engage target tracking.'}
            </span>
          </div>

          <form onSubmit={handleLockSelected} className="flex gap-2">
            <input
              type="text"
              placeholder={selectedFace ? `Name for Person #${selectedFace.trackId} (e.g. Alex)` : 'Target Name (e.g. Alex)'}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-red-500"
            />
            <button
              type="submit"
              disabled={!nameInput.trim()}
              className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-bold transition-all shadow-[0_0_10px_rgba(239,68,68,0.3)] flex items-center gap-1"
            >
              <Lock className="w-3 h-3" />
              <span>Lock</span>
            </button>
          </form>
        </div>
      )}

      {/* Target Search Form */}
      <form onSubmit={handleSearchSubmit} className="flex flex-col gap-1.5">
        <label className="text-[11px] text-zinc-400 flex items-center gap-1">
          <Search className="w-3 h-3 text-cyan-400" />
          <span>Biometric Target Search (by Name)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search & lock target (e.g. Alex, Sarah)..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 font-mono"
          />
          <button
            type="submit"
            disabled={!searchInput.trim()}
            className="px-3 py-1.5 rounded bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold disabled:opacity-40 transition-all flex items-center gap-1"
          >
            <Search className="w-3 h-3" />
            <span>Search</span>
          </button>
        </div>
      </form>

      {/* Quick Enrolled Profiles Selector */}
      {enrolledProfiles.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-1 border-t border-zinc-800/60">
          <div className="text-[10px] text-zinc-500 uppercase">Enrolled Identities (Click to Lock)</div>
          <div className="flex flex-wrap gap-1.5">
            {enrolledProfiles.map((p) => (
              <button
                key={p.id}
                onClick={() => onSearchTarget(p.name)}
                className={`px-2 py-1 rounded text-[11px] border transition-all flex items-center gap-1 ${
                  targetState.locked && targetState.name.toLowerCase() === p.name.toLowerCase()
                    ? 'bg-red-500/20 text-red-300 border-red-500/50'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                <UserCheck className="w-3 h-3 text-emerald-400" />
                <span>{p.name}</span>
                <span className="text-[9px] text-zinc-500">({p.sampleCount})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
