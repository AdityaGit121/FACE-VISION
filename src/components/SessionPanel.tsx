import React, { useEffect, useState } from 'react';
import { Play, Square, RefreshCw, Users, Clock } from 'lucide-react';
import type { SessionView } from '../vision/visionEngine';

interface SessionPanelProps {
  session: SessionView;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
}

const COLORS = ['#10b981', '#f59e0b', '#a78bfa', '#f472b6', '#38bdf8', '#fb923c', '#a3e635', '#2dd4bf'];

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const SessionPanel: React.FC<SessionPanelProps> = ({ session, onStart, onStop, onRefresh }) => {
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (!session.active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session.active]);

  const hasData = session.people.length > 0;
  const started = session.startedAt !== null && session.sessionId > 0;

  return (
    <div className="rounded-xl bg-zinc-900/90 border border-zinc-800 p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Session Memory</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
              session.active
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }`}
          >
            {session.active ? `SESSION #${session.sessionId} LIVE` : started ? 'PAUSED' : 'IDLE'}
          </span>
        </div>
        {session.active && session.startedAt && (
          <span className="flex items-center gap-1 text-[11px] text-zinc-400">
            <Clock className="w-3 h-3" />
            {fmtDuration(now - session.startedAt)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!session.active ? (
          <button
            onClick={onStart}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 text-xs font-bold transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            {started && hasData ? 'Resume' : 'Start Session'}
          </button>
        ) : (
          <button
            onClick={onStop}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-bold transition-all"
          >
            <Square className="w-3.5 h-3.5" />
            Pause
          </button>
        )}
        <button
          onClick={onRefresh}
          title="Wipe session memory and start a new session"
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {!started ? (
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          Press <strong className="text-zinc-300">Start Session</strong> and every different face that appears is
          remembered as Person 1, 2, 3… If someone leaves the frame and comes back they keep the same number.
          Nothing is saved: <strong className="text-zinc-300">Refresh</strong> wipes it and starts over.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>
              People seen: <strong className="text-cyan-300 text-sm">{session.people.length}</strong>
            </span>
            <span>In view now: <strong className="text-emerald-300">{new Set(session.visibleIds).size}</strong></span>
          </div>

          {hasData ? (
            <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-0.5">
              {session.people.map((p) => {
                const visible = session.visibleIds.includes(p.id);
                const color = COLORS[(p.id - 1) % COLORS.length];
                const ago = Math.round((now - p.lastSeen) / 1000);
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2.5 p-1.5 rounded-lg bg-zinc-950 border border-zinc-800"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={p.label} className="w-9 h-9 rounded object-cover border border-zinc-700" />
                    ) : (
                      <div className="w-9 h-9 rounded bg-zinc-800 border border-zinc-700" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-zinc-100">{p.label}</div>
                      <div className="text-[10px] text-zinc-500">
                        {visible ? 'in view' : `last seen ${ago < 2 ? 'just now' : `${ago}s ago`}`} · seen {p.sightings}×
                      </div>
                    </div>
                    <span
                      className={`w-2 h-2 rounded-full ${visible ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`}
                      title={visible ? 'In view' : 'Out of frame'}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">Waiting for faces… (recognition models must finish loading first)</p>
          )}
          <p className="text-[10px] text-zinc-600">Temporary memory - separate from enrolled identities.</p>
        </>
      )}
    </div>
  );
};
