import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  X,
  Lock,
  Crosshair,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  Filter,
} from 'lucide-react';
import { TrackedFace } from '../types';

interface PeoplePanelProps {
  faces: TrackedFace[];
  selectedTrackId: number | null;
  onSelectTrack: (trackId: number) => void;
  targetTrackId: number | undefined;
  onQuickLockTarget: (trackId: number) => void;
  onDeepAnalyzeFace: (face: TrackedFace) => void;
}

type StatusFilterType = 'ALL' | 'KNOWN' | 'UNKNOWN' | 'TARGET';

export const PeoplePanel: React.FC<PeoplePanelProps> = ({
  faces,
  selectedTrackId,
  onSelectTrack,
  targetTrackId,
  onQuickLockTarget,
  onDeepAnalyzeFace,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('ALL');

  // Filter faces by text query & status
  const filteredFaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return faces.filter((face) => {
      // Status filter tab match
      const isTarget = face.trackId === targetTrackId;
      if (statusFilter === 'KNOWN' && face.identity.status !== 'KNOWN') return false;
      if (statusFilter === 'UNKNOWN' && face.identity.status !== 'UNKNOWN' && face.identity.status !== 'UNCERTAIN') return false;
      if (statusFilter === 'TARGET' && !isTarget) return false;

      // Text query match
      if (!query) return true;

      const trackStr = String(face.trackId);
      const paddedTrackStr = `#${trackStr.padStart(2, '0')}`;
      const name = (face.identity.name || face.sessionLabel || '').toLowerCase();
      const status = (face.identity.status || '').toLowerCase();
      const expr = (face.expression?.dominant || '').toLowerCase();
      const targetLabel = isTarget ? 'target' : '';

      return (
        trackStr.includes(query) ||
        paddedTrackStr.toLowerCase().includes(query) ||
        name.includes(query) ||
        status.includes(query) ||
        expr.includes(query) ||
        targetLabel.includes(query)
      );
    });
  }, [faces, searchQuery, statusFilter, targetTrackId]);

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 shadow-xl flex flex-col gap-3 font-mono">
      {/* Panel Title & Counts */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-emerald-400" />
          <h2 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
            People In Frame ({faces.length})
          </h2>
        </div>
        <span className="text-[10px] text-zinc-400">
          <strong className="text-emerald-400">
            {faces.filter((f) => f.identity.status === 'KNOWN').length}
          </strong>{' '}
          Known / {faces.length} Total
        </span>
      </div>

      {/* Text-Input Search Filter & Quick Status Filter Bar */}
      <div className="flex flex-col gap-2">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, #ID, status, or expression..."
            className="w-full bg-zinc-950/90 border border-zinc-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 p-0.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status Filter Chips */}
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="text-zinc-500 flex items-center gap-1 text-[9px] uppercase">
            <Filter className="w-3 h-3" />
          </span>
          {(
            [
              { id: 'ALL', label: 'All' },
              { id: 'KNOWN', label: 'Known' },
              { id: 'UNKNOWN', label: 'Unknown' },
              { id: 'TARGET', label: 'Target' },
            ] as const
          ).map((filter) => {
            const isActive = statusFilter === filter.id;
            return (
              <button
                key={filter.id}
                onClick={() => setStatusFilter(filter.id)}
                className={`px-2 py-0.5 rounded-md border transition-all ${
                  isActive
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                    : 'bg-zinc-950/60 text-zinc-400 border-zinc-800/80 hover:border-zinc-700'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
          {(searchQuery || statusFilter !== 'ALL') && (
            <span className="ml-auto text-[10px] text-zinc-400">
              {filteredFaces.length} found
            </span>
          )}
        </div>
      </div>

      {/* List of tracked persons */}
      {faces.length === 0 ? (
        <div className="p-6 text-center text-xs text-zinc-500 bg-zinc-950/50 rounded-lg border border-zinc-800/60">
          No faces detected in current frame.
        </div>
      ) : filteredFaces.length === 0 ? (
        <div className="p-5 text-center text-xs text-zinc-400 bg-zinc-950/50 rounded-lg border border-zinc-800/60 flex flex-col gap-2 items-center">
          <span>No persons match "{searchQuery || statusFilter}".</span>
          <button
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('ALL');
            }}
            className="text-[11px] text-cyan-400 hover:underline"
          >
            Clear Search & Filters
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
          {filteredFaces.map((face) => {
            const isSelected = face.trackId === selectedTrackId;
            const isTarget = face.trackId === targetTrackId;

            return (
              <div
                key={face.trackId}
                onClick={() => onSelectTrack(face.trackId)}
                className={`p-3 rounded-lg border transition-all cursor-pointer flex flex-col gap-2 ${
                  isTarget
                    ? 'bg-red-950/40 border-red-500/60 shadow-[0_0_14px_rgba(239,68,68,0.25)]'
                    : isSelected
                    ? 'bg-cyan-950/40 border-cyan-500/60 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                    : 'bg-zinc-950/75 border-zinc-800/80 hover:border-zinc-700'
                }`}
              >
                {/* Person Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold ${
                        isTarget
                          ? 'bg-red-500 text-white'
                          : isSelected
                          ? 'bg-cyan-500 text-black'
                          : 'bg-zinc-800 text-zinc-200'
                      }`}
                    >
                      {String(face.trackId).padStart(2, '0')}
                    </span>

                    <div>
                      <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                        <span>{face.identity.name || face.sessionLabel || `Person #${face.trackId}`}</span>
                        {isTarget && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] bg-red-500/20 text-red-400 font-bold border border-red-500/40">
                            TARGET
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] flex items-center gap-1.5 mt-0.5">
                        {face.identity.status === 'KNOWN' ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>KNOWN {face.identity.confidence}%</span>
                          </span>
                        ) : face.identity.status === 'UNCERTAIN' ? (
                          <span className="text-amber-400 flex items-center gap-1">
                            <HelpCircle className="w-3 h-3" />
                            <span>UNCERTAIN ({face.identity.confidence}%)</span>
                          </span>
                        ) : (
                          <span className="text-zinc-500">UNKNOWN</span>
                        )}
                        <span className="text-zinc-600">&bull;</span>
                        <span className="text-zinc-400">Qual: {face.quality.overall}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {!isTarget ? (
                      <button
                        onClick={() => onQuickLockTarget(face.trackId)}
                        title="Lock this person as target"
                        className="p-1.5 rounded bg-zinc-800 hover:bg-red-950/60 hover:text-red-300 border border-zinc-700 hover:border-red-500/50 text-zinc-400 text-xs transition-all"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span className="text-red-400 p-1">
                        <Lock className="w-3.5 h-3.5" />
                      </span>
                    )}
                    <button
                      onClick={() => onDeepAnalyzeFace(face)}
                      title="Run Gemini Multimodal Analysis on this face"
                      className="p-1.5 rounded bg-zinc-800 hover:bg-cyan-950/60 hover:text-cyan-300 border border-zinc-700 hover:border-cyan-500/50 text-zinc-400 text-xs transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Sub-metrics bar */}
                <div className="grid grid-cols-3 gap-1.5 text-[10px] pt-1.5 border-t border-zinc-800/60 text-zinc-400">
                  <div>
                    Age:{' '}
                    <strong className="text-zinc-200">
                      {face.age.isLowQuality ? '~' : `~${face.age.smoothedAge}`}
                    </strong>
                  </div>
                  <div>
                    Expr:{' '}
                    <strong className="text-zinc-200 capitalize">
                      {face.expression.dominant}
                    </strong>
                  </div>
                  <div>
                    Stab:{' '}
                    <strong className="text-emerald-400">
                      {face.expression.stability}%
                    </strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
