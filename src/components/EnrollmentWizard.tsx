import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle2, AlertTriangle, RotateCcw, User, ShieldCheck, ScanFace, Loader2 } from 'lucide-react';
import { TrackedFace, IdentityProfile } from '../types';
import { enrollFaceSample, euclideanDistance } from '../identity/identityEngine';
import { cropFaceRegion } from '../vision/faceDetector';
import { estimatePose } from '../vision/faceQuality';
import { visionEngine, EnrollSample } from '../vision/visionEngine';
import { getModelStageStatus } from '../vision/modelLoader';

interface EnrollmentWizardProps {
  isOpen: boolean;
  onClose: () => void;
  currentFaces: TrackedFace[];
  selectedTrackId: number | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  imageRef: React.RefObject<HTMLImageElement | null>;
  onEnrollmentComplete: (profile: IdentityProfile) => void;
}

type Bin = 'center' | 'side1' | 'side2' | 'up' | 'down';

/**
 * AUTOMATIC enrollment.
 * No buttons to press: the wizard watches the live head pose and captures a sample by itself the
 * first time each angle is reached (front, both sides, up, down), gated on face quality and on the
 * pose being held steady for a few measurements. Done when the front + 3 other angles are covered.
 */
const STABLE_FRAMES = 3; // consecutive measurements (~0.3 s) in the same pose bin before capturing
const REQUIRED_OTHERS = 3;
const MIN_SAMPLE_GAP = 0.06; // descriptors closer than this are the same sample

function classify(yaw: number, pitch: number, roll: number): Bin | null {
  if (Math.abs(roll) > 30) return null;
  if (Math.abs(yaw) <= 10 && Math.abs(pitch) <= 10) return 'center';
  if (yaw >= 16 && Math.abs(pitch) <= 22) return 'side1';
  if (yaw <= -16 && Math.abs(pitch) <= 22) return 'side2';
  if (pitch <= -13 && Math.abs(yaw) <= 22) return 'up';
  if (pitch >= 13 && Math.abs(yaw) <= 22) return 'down';
  return null;
}

const BIN_LABEL: Record<Bin, string> = {
  center: 'Front',
  side1: 'Turn one side',
  side2: 'Turn other side',
  up: 'Tilt up',
  down: 'Tilt down',
};

export const EnrollmentWizard: React.FC<EnrollmentWizardProps> = ({
  isOpen,
  onClose,
  currentFaces,
  videoRef,
  imageRef,
  canvasRef,
  onEnrollmentComplete,
}) => {
  const [name, setName] = useState('');
  const [captured, setCaptured] = useState<Record<Bin, boolean>>({ center: false, side1: false, side2: false, up: false, down: false });
  const [sampleCount, setSampleCount] = useState(0);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveBin, setLiveBin] = useState<Bin | null>(null);
  const [pose, setPose] = useState<{ yaw: number; pitch: number } | null>(null);
  const [faceCount, setFaceCount] = useState(0);
  const [flash, setFlash] = useState(false);

  const samples = useRef<number[][]>([]);
  const capturedRef = useRef<Record<Bin, boolean>>({ center: false, side1: false, side2: false, up: false, down: false });
  const centerCaptures = useRef(0);
  const streak = useRef<{ bin: Bin | null; n: number }>({ bin: null, n: 0 });
  const nameRef = useRef('');
  const completeRef = useRef(false);
  const facesRef = useRef<TrackedFace[]>(currentFaces);
  facesRef.current = currentFaces;
  nameRef.current = name;

  const saveProfile = async () => {
    const who = nameRef.current.trim();
    if (!who) { setError('Type a name for this person to save the profile.'); return; }
    if (samples.current.length === 0) { setError('No samples captured yet.'); return; }
    setSaving(true);
    setError(null);
    try {
      let profile = await enrollFaceSample(who, samples.current[0], thumbnail || undefined, `Auto-enrolled (${samples.current.length} samples)`);
      for (let i = 1; i < samples.current.length; i++) profile = await enrollFaceSample(who, samples.current[i], thumbnail || undefined);
      onEnrollmentComplete(profile);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(saveProfile);
  saveRef.current = saveProfile;

  const reset = () => {
    samples.current = [];
    capturedRef.current = { center: false, side1: false, side2: false, up: false, down: false };
    centerCaptures.current = 0;
    streak.current = { bin: null, n: 0 };
    completeRef.current = false;
    setCaptured({ ...capturedRef.current });
    setSampleCount(0);
    setThumbnail(null);
    setComplete(false);
    setError(null);
    setLiveBin(null);
  };

  useEffect(() => {
    if (!isOpen) return;
    reset();
    setName('');

    const onSample = (s: EnrollSample) => {
      setFaceCount(s.faceCount);
      if (completeRef.current) return;
      if (s.faceCount !== 1 || !s.descriptor || !s.landmarks) { streak.current = { bin: null, n: 0 }; setLiveBin(null); return; }

      const p = estimatePose(s.landmarks);
      if (!p) return;
      setPose({ yaw: Math.round(p.yaw), pitch: Math.round(p.pitch) });

      // Quality gate (tracker measures it a few times per second)
      const q = facesRef.current.find((f) => f.trackId === s.trackId)?.quality;
      if (q && (q.resolutionScore < 45 || q.brightnessScore < 40 || q.sharpnessScore < 30)) {
        streak.current = { bin: null, n: 0 };
        return;
      }

      const bin = classify(p.yaw, p.pitch, p.roll);
      setLiveBin(bin);
      if (!bin) { streak.current = { bin: null, n: 0 }; return; }
      streak.current = streak.current.bin === bin ? { bin, n: streak.current.n + 1 } : { bin, n: 1 };
      if (streak.current.n < STABLE_FRAMES) return;

      const already = capturedRef.current[bin];
      const canSecondCenter = bin === 'center' && centerCaptures.current < 2 && Object.values(capturedRef.current).filter(Boolean).length >= 3;
      if (already && !canSecondCenter) return;
      if (samples.current.some((d) => euclideanDistance(d, s.descriptor!) < MIN_SAMPLE_GAP)) return;

      samples.current.push(Array.from(s.descriptor));
      if (bin === 'center') centerCaptures.current++;
      if (!capturedRef.current[bin]) {
        capturedRef.current = { ...capturedRef.current, [bin]: true };
        setCaptured({ ...capturedRef.current });
      }
      if (samples.current.length === 1 && s.box) {
        const src = videoRef.current || imageRef.current || canvasRef.current;
        if (src) { const t = cropFaceRegion(src, s.box); if (t) setThumbnail(t); }
      }
      setSampleCount(samples.current.length);
      setFlash(true);
      setTimeout(() => setFlash(false), 250);
      streak.current = { bin: null, n: 0 };

      const c = capturedRef.current;
      const others = (['side1', 'side2', 'up', 'down'] as Bin[]).filter((b) => c[b]).length;
      if (c.center && others >= REQUIRED_OTHERS) {
        completeRef.current = true;
        setComplete(true);
        if (nameRef.current.trim()) setTimeout(() => saveRef.current(), 400); // name already typed: save automatically
      }
    };

    visionEngine.setEnrollmentSink(onSample);
    return () => visionEngine.setEnrollmentSink(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const stage = getModelStageStatus();
  const c = captured;
  const sidesDone = (c.side1 ? 1 : 0) + (c.side2 ? 1 : 0);
  const vertDone = (c.up ? 1 : 0) + (c.down ? 1 : 0);

  let hint = 'Look straight at the camera.';
  if (!stage.isRecognitionReady) hint = 'Loading recognition models...';
  else if (faceCount === 0) hint = 'No face in view. Move into the camera frame.';
  else if (faceCount > 1) hint = 'Only one person should be in view.';
  else if (complete) hint = 'All angles captured.';
  else if (!c.center) hint = 'Look straight at the camera and hold still.';
  else if (sidesDone === 0) hint = 'Now slowly turn your head to one side.';
  else if (sidesDone === 1 && vertDone === 0 && !c.side2) hint = 'Good. Now turn to the other side.';
  else if (vertDone === 0) hint = 'Now tilt your head up or down slightly.';
  else if (vertDone === 1) hint = 'Almost done. Tilt the other way.';
  else hint = 'One more angle: turn or tilt a little more.';

  const total = 5;
  const done = Object.values(c).filter(Boolean).length;
  const bins: Bin[] = ['center', 'side1', 'side2', 'up', 'down'];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col font-mono">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 uppercase">Auto Enrollment</h3>
              <p className="text-[11px] text-zinc-500">Just move your head slowly. Samples are captured automatically.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <label className="text-xs text-zinc-300 font-semibold flex items-center gap-1.5 mb-1.5">
              <User className="w-3.5 h-3.5 text-emerald-400" /> Who is this?
            </label>
            <input
              type="text"
              autoFocus
              placeholder="Type a name (e.g. Alex)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && complete) saveProfile(); }}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className={`rounded-xl border p-4 flex items-center gap-3 transition-all ${flash ? 'border-emerald-400 bg-emerald-500/10' : 'border-zinc-800 bg-zinc-950'}`}>
            {complete ? <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" /> : faceCount === 1 && stage.isRecognitionReady ? <ScanFace className="w-6 h-6 text-cyan-400 shrink-0 animate-pulse" /> : <Loader2 className="w-6 h-6 text-amber-400 shrink-0 animate-spin" />}
            <div className="flex-1">
              <div className="text-xs font-bold text-zinc-100">{hint}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {pose ? `Head pose: yaw ${pose.yaw}°, pitch ${pose.pitch}°` : 'Waiting for a face...'}
              </div>
            </div>
            {thumbnail && <img src={thumbnail} className="w-12 h-12 rounded-lg border border-zinc-700 object-cover" alt="" />}
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
              <span>Angles captured</span>
              <span className="text-emerald-400 font-bold">{done} / {total} · {sampleCount} samples</span>
            </div>
            <div className="h-1.5 rounded bg-zinc-800 overflow-hidden mb-2.5">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(done / total) * 100}%` }} />
            </div>
            <div className="grid grid-cols-5 gap-1.5 text-[10px]">
              {bins.map((b) => (
                <div
                  key={b}
                  className={`p-2 rounded border text-center transition-all ${
                    c[b]
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : liveBin === b
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/50 animate-pulse'
                      : 'bg-zinc-950 text-zinc-500 border-zinc-800'
                  }`}
                >
                  {c[b] ? '✓ ' : ''}{BIN_LABEL[b]}
                </div>
              ))}
            </div>
          </div>

          {complete && !name.trim() && (
            <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 p-2.5 rounded-lg">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> All angles captured. Type a name above and press Save.
            </div>
          )}
          {faceCount > 1 && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg">
              <AlertTriangle className="w-4 h-4 shrink-0" /> Multiple faces detected. Capture is paused until only one person is in view.
            </div>
          )}
          {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-lg">{error}</div>}
        </div>

        <div className="p-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
          <button onClick={reset} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Restart
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
            <button
              onClick={saveProfile}
              disabled={saving || sampleCount === 0 || !name.trim()}
              title={sampleCount < 3 ? 'Works best with 4+ angles; you can save earlier (e.g. for a still photo).' : ''}
              className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 text-black font-bold text-xs transition-all"
            >
              {saving ? 'Saving...' : complete ? 'Save Profile' : `Save now (${sampleCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
