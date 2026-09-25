import React, { useEffect, useState } from 'react';
import { X, Sparkles, User, AlertCircle, Eye, Activity, ShieldCheck } from 'lucide-react';
import { TrackedFace } from '../types';
import { aiPost } from '../ai/aiClient';
import { cropFaceRegion } from '../vision/faceDetector';

interface FaceDetailsModalProps {
  face: TrackedFace | null;
  isOpen: boolean;
  onClose: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  imageRef: React.RefObject<HTMLImageElement | null>;
  hasGeminiKey: boolean;
}

export const FaceDetailsModal: React.FC<FaceDetailsModalProps> = ({
  face,
  isOpen,
  onClose,
  videoRef,
  canvasRef,
  imageRef,
  hasGeminiKey,
}) => {
  const [faceCropUrl, setFaceCropUrl] = useState<string>('');
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !face) {
      setFaceCropUrl('');
      setAiAnalysis(null);
      setError(null);
      return;
    }

    const source = videoRef.current || imageRef.current || canvasRef.current;
    if (source) {
      const crop = cropFaceRegion(source, face.box);
      setFaceCropUrl(crop);

      // If Gemini key is available, run automatic face analysis
      if (hasGeminiKey && crop) {
        setIsLoadingAi(true);
        setError(null);

        aiPost('/api/gemini/analyze-face', {
          imageBase64: crop,
          localMetrics: {
            age: face.age.smoothedAge,
            expression: face.expression.dominant,
            quality: face.quality.overall,
          },
        }, 'vision')
          .then(async (res) => {
            if (!res.ok) {
              const e = await res.json().catch(() => ({}));
              throw new Error(e?.error || `Analysis error (${res.status})`);
            }
            return res.json();
          })
          .then((data) => {
            setAiAnalysis(data.data);
          })
          .catch((err) => {
            console.warn('Face AI reasoning note:', err);
            setError(err?.message || 'Gemini face analysis failed.');
          })
          .finally(() => {
            setIsLoadingAi(false);
          });
      }
    }
  }, [isOpen, face, hasGeminiKey]);

  if (!isOpen || !face) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col font-mono max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/70">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-zinc-100 uppercase">
              Face Biometrics & Analysis: Person #{face.trackId}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
          {/* Crop & Local CV Measurements */}
          <div className="flex items-start gap-4 bg-zinc-950 p-4 rounded-xl border border-zinc-800">
            {faceCropUrl ? (
              <img
                src={faceCropUrl}
                alt="Face Crop"
                className="w-24 h-24 rounded-lg object-cover border border-zinc-700 shrink-0"
              />
            ) : (
              <div className="w-24 h-24 rounded-lg bg-zinc-800 flex items-center justify-center text-xs text-zinc-500 shrink-0">
                No Crop
              </div>
            )}

            <div className="flex-1 flex flex-col gap-1.5 text-xs">
              <div className="text-sm font-bold text-zinc-100">
                {face.identity.name || 'Unknown Person'}
              </div>
              <div className="text-zinc-400">
                Match Status:{' '}
                <strong
                  className={
                    face.identity.status === 'KNOWN'
                      ? 'text-emerald-400'
                      : face.identity.status === 'UNCERTAIN'
                      ? 'text-amber-400'
                      : 'text-zinc-500'
                  }
                >
                  {face.identity.status} ({face.identity.confidence}%)
                </strong>
              </div>
              <div className="text-zinc-400">
                Estimated Age:{' '}
                <strong className="text-zinc-200">
                  ~{face.age.smoothedAge} [range: {face.age.minAge}-{face.age.maxAge}]
                </strong>
              </div>
              <div className="text-zinc-400">
                Expression:{' '}
                <strong className="text-amber-300 capitalize">
                  {face.expression.dominant} ({face.expression.confidence}%)
                </strong>
              </div>
              <div className="text-zinc-400">
                Face Quality: <strong className="text-cyan-400">{face.quality.overall}%</strong>
              </div>
            </div>
          </div>

          {/* Detailed Face Quality Breakdown */}
          <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 flex flex-col gap-2 text-xs">
            <div className="font-bold text-zinc-300 uppercase text-[11px]">
              Computer Vision Quality Analysis
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
              <div>Resolution: <strong className="text-zinc-200">{face.quality.resolutionScore}%</strong></div>
              <div>Lighting: <strong className="text-zinc-200">{face.quality.brightnessScore}%</strong></div>
              <div>Sharpness: <strong className="text-zinc-200">{face.quality.sharpnessScore}%</strong></div>
              <div>Contrast: <strong className="text-zinc-200">{face.quality.contrastScore}%</strong></div>
              <div>Yaw Angle: <strong className="text-zinc-200">{face.quality.yaw}°</strong></div>
              <div>Roll Angle: <strong className="text-zinc-200">{face.quality.roll}°</strong></div>
            </div>
          </div>

          {/* Gemini Multimodal Interpretation */}
          <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 flex flex-col gap-2 text-xs">
            <div className="font-bold text-cyan-400 uppercase text-[11px] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Gemini 3.8 Multimodal Reasoning</span>
            </div>

            {isLoadingAi && (
              <div className="py-4 text-center text-zinc-400 flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Running visual attribute reasoning...</span>
              </div>
            )}

            {!hasGeminiKey && !isLoadingAi && (
              <div className="text-zinc-500 text-[11px]">
                Gemini API key not configured. Multimodal micro-expression reasoning is offline.
              </div>
            )}

            {aiAnalysis && (
              <div className="flex flex-col gap-2 text-[11px] text-zinc-300">
                <div>
                  <span className="text-zinc-500">Micro-Expression:</span>{' '}
                  <strong className="text-zinc-200">{aiAnalysis.microExpression}</strong>
                </div>
                <div>
                  <span className="text-zinc-500">Gaze Direction:</span>{' '}
                  <strong className="text-zinc-200">{aiAnalysis.gazeDirection}</strong>
                </div>
                {aiAnalysis.distinctiveFeatures && aiAnalysis.distinctiveFeatures.length > 0 && (
                  <div>
                    <span className="text-zinc-500">Visual Features:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {aiAnalysis.distinctiveFeatures.map((f: string, idx: number) => (
                        <span key={idx} className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-cyan-300 text-[10px]">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="pt-1 border-t border-zinc-800/80 text-zinc-400 italic">
                  "{aiAnalysis.summary}"
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
