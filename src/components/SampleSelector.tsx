import React from 'react';
import { Image as ImageIcon, Users, User, AlertCircle, ShieldAlert } from 'lucide-react';
import { SAMPLE_PORTRAITS, SamplePortrait } from '../data/samples';

interface SampleSelectorProps {
  activeSample: SamplePortrait | null;
  onSelectSample: (sample: SamplePortrait) => void;
}

export const SampleSelector: React.FC<SampleSelectorProps> = ({
  activeSample,
  onSelectSample,
}) => {
  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3.5 shadow-xl flex flex-col gap-2.5 font-mono">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-zinc-100 uppercase tracking-wider">
          <ImageIcon className="w-4 h-4 text-emerald-400" />
          <span>Evaluation Test Scenes ({SAMPLE_PORTRAITS.length})</span>
        </div>
        <span className="text-[10px] text-zinc-500">Benchmark datasets</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {SAMPLE_PORTRAITS.map((sample) => {
          const isSelected = activeSample?.id === sample.id;
          return (
            <button
              key={sample.id}
              onClick={() => onSelectSample(sample)}
              className={`p-2 rounded-lg border text-left transition-all flex flex-col gap-1.5 ${
                isSelected
                  ? 'bg-emerald-500/20 border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                  : 'bg-zinc-950/70 border-zinc-800/80 hover:border-zinc-700'
              }`}
            >
              <div className="relative w-full aspect-video rounded overflow-hidden bg-black">
                <img
                  src={sample.url}
                  alt={sample.title}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1 right-1 px-1 py-0.2 rounded bg-black/80 text-[9px] text-zinc-300 font-bold">
                  {sample.expectedFacesCount}F
                </span>
              </div>
              <div>
                <div className="text-[11px] font-bold text-zinc-200 truncate">
                  {sample.title}
                </div>
                <div className="text-[9px] text-zinc-500 capitalize truncate">
                  {sample.category}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
