import React, { useState } from 'react';
import { X, Plus, Trash2, Eye, EyeOff, Zap, CheckCircle2, AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import {
  AIProvider, PRESETS, useAISettings, saveAISettings, newProviderFromPreset, isUsable, ProviderKind, toPayload,
} from '../ai/aiSettings';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  serverHasKey: boolean;
}

interface TestState { busy: boolean; ok?: boolean; msg?: string; ms?: number }

const inputCls = 'w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-cyan-500 placeholder:text-zinc-600';
const labelCls = 'text-[11px] text-zinc-400 font-semibold mb-1 block';

export const AISettingsModal: React.FC<Props> = ({ isOpen, onClose, serverHasKey }) => {
  const settings = useAISettings();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [addKey, setAddKey] = useState('gemini');
  const [tests, setTests] = useState<Record<string, TestState>>({});

  if (!isOpen) return null;

  const providers = settings.providers;
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0] ?? null;

  const update = (id: string, patch: Partial<AIProvider>) =>
    saveAISettings({ ...settings, providers: providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const add = () => {
    const p = newProviderFromPreset(addKey);
    saveAISettings({ ...settings, providers: [...providers, p] });
    setSelectedId(p.id);
    setShowKey(false);
  };

  const remove = (id: string) => {
    const routing = { ...settings.routing };
    if (routing.vision === id) routing.vision = 'auto';
    if (routing.text === id) routing.text = 'auto';
    saveAISettings({ providers: providers.filter((p) => p.id !== id), routing });
    setSelectedId(null);
  };

  const runTest = async (p: AIProvider, withImage: boolean) => {
    setTests((t) => ({ ...t, [p.id]: { busy: true } }));
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: toPayload(p), withImage }),
      });
      const j = await res.json();
      setTests((t) => ({
        ...t,
        [p.id]: j.ok
          ? { busy: false, ok: true, msg: `${withImage ? 'Vision' : 'Text'} OK - replied "${j.reply}"`, ms: j.latencyMs }
          : { busy: false, ok: false, msg: j.error || 'Failed', ms: j.latencyMs },
      }));
    } catch (e: any) {
      setTests((t) => ({ ...t, [p.id]: { busy: false, ok: false, msg: e?.message || 'Could not reach the local server' } }));
    }
  };

  const preset = selected ? PRESETS.find((x) => x.provider.kind === selected.kind && x.provider.name === selected.name) : null;
  const test = selected ? tests[selected.id] : undefined;
  const visionOptions = providers.filter((p) => p.vision && isUsable(p));
  const textOptions = providers.filter((p) => p.text && isUsable(p));

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-3xl max-h-[92vh] shadow-2xl overflow-hidden flex flex-col font-mono">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 uppercase">AI Providers &amp; API Keys</h3>
            <p className="text-[11px] text-zinc-500">Connect any online model. Used for Deep Scan, face analysis and the command assistant.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-[210px_1fr]">
          {/* Provider list */}
          <div className="border-b md:border-b-0 md:border-r border-zinc-800 p-3 flex flex-col gap-2 bg-zinc-950/40">
            {serverHasKey && (
              <div className="text-[10px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-2">
                Server default (GEMINI_API_KEY in .env) is active as a fallback.
              </div>
            )}
            {providers.length === 0 && <p className="text-[11px] text-zinc-500 p-1">No providers yet. Add one below.</p>}
            {providers.map((p) => {
              const usable = isUsable(p);
              const active = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => { setSelectedId(p.id); setShowKey(false); }}
                  className={`text-left p-2.5 rounded-lg border transition-all ${active ? 'bg-cyan-500/10 border-cyan-500/40' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-100 truncate">{p.name || 'Unnamed'}</span>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${usable ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{p.model || 'no model'} · {[p.vision && 'vision', p.text && 'text'].filter(Boolean).join(' + ') || 'no capability'}</div>
                </button>
              );
            })}
            <div className="flex gap-1.5 pt-1">
              <select value={addKey} onChange={(e) => setAddKey(e.target.value)} className={inputCls + ' !py-1.5'}>
                {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <button onClick={add} title="Add provider" className="px-2.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Editor */}
          <div className="p-5 flex flex-col gap-4">
            {!selected ? (
              <div className="text-xs text-zinc-400 leading-relaxed">
                Pick a provider type at the bottom-left and press <strong>+</strong>, then paste your API key.
                <ul className="list-disc pl-5 mt-2 space-y-1 text-zinc-500">
                  <li><strong className="text-zinc-300">Gemini / OpenAI / Claude</strong>: paste the key, done.</li>
                  <li><strong className="text-zinc-300">OpenRouter, Groq, Together, Mistral, DeepSeek, LM Studio, vLLM</strong>: use an OpenAI-compatible entry.</li>
                  <li><strong className="text-zinc-300">Ollama</strong>: run a local model with no key.</li>
                  <li><strong className="text-zinc-300">Any other API</strong>: use “Any REST API” and describe the request.</li>
                </ul>
              </div>
            ) : (
              <>
                {preset && <p className="text-[11px] text-zinc-500">{preset.hint}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input className={inputCls} value={selected.name} onChange={(e) => update(selected.id, { name: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>API type</label>
                    <select className={inputCls} value={selected.kind} onChange={(e) => update(selected.id, { kind: e.target.value as ProviderKind })}>
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI-compatible</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="custom">Custom REST</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>{selected.kind === 'custom' ? 'Endpoint URL' : 'Base URL'}</label>
                  <input className={inputCls} value={selected.baseUrl} placeholder="https://..." onChange={(e) => update(selected.id, { baseUrl: e.target.value })} />
                </div>

                <div>
                  <label className={labelCls}>API key {selected.keyOptional && <span className="text-zinc-600">(optional for local servers)</span>}</label>
                  <div className="flex gap-1.5">
                    <input
                      className={inputCls}
                      type={showKey ? 'text' : 'password'}
                      autoComplete="off"
                      spellCheck={false}
                      value={selected.apiKey}
                      placeholder="Paste your API key"
                      onChange={(e) => update(selected.id, { apiKey: e.target.value.trim() })}
                    />
                    <button onClick={() => setShowKey((v) => !v)} className="px-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700">
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Model</label>
                  <input className={inputCls} value={selected.model} placeholder="e.g. gemini-2.5-flash" onChange={(e) => update(selected.id, { model: e.target.value.trim() })} />
                </div>

                {selected.kind === 'custom' && selected.custom && (
                  <div className="flex flex-col gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-950/50">
                    <div className="text-[11px] text-zinc-500">
                      Placeholders: <code className="text-cyan-300">{'{{prompt}} {{system}} {{model}} {{apiKey}} {{image}} {{imageBase64}}'}</code>
                    </div>
                    <div className="grid grid-cols-[110px_1fr] gap-3">
                      <div>
                        <label className={labelCls}>Method</label>
                        <select className={inputCls} value={selected.custom.method} onChange={(e) => update(selected.id, { custom: { ...selected.custom!, method: e.target.value as any } })}>
                          <option>POST</option><option>PUT</option><option>GET</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Response path (where the answer text is)</label>
                        <input className={inputCls} value={selected.custom.responsePath} placeholder="choices.0.message.content" onChange={(e) => update(selected.id, { custom: { ...selected.custom!, responsePath: e.target.value } })} />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Headers (JSON)</label>
                      <textarea rows={2} className={inputCls + ' font-mono'} value={selected.custom.headers} onChange={(e) => update(selected.id, { custom: { ...selected.custom!, headers: e.target.value } })} />
                    </div>
                    <div>
                      <label className={labelCls}>Request body template (JSON)</label>
                      <textarea rows={4} className={inputCls + ' font-mono'} value={selected.custom.bodyTemplate} onChange={(e) => update(selected.id, { custom: { ...selected.custom!, bodyTemplate: e.target.value } })} />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-5 text-xs text-zinc-300">
                  <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={selected.vision} onChange={(e) => update(selected.id, { vision: e.target.checked })} /> Understands images (vision)</label>
                  <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={selected.text} onChange={(e) => update(selected.id, { text: e.target.checked })} /> Text / commands</label>
                  <label className="flex items-center gap-1.5 cursor-pointer ml-auto"><input type="checkbox" checked={selected.enabled} onChange={(e) => update(selected.id, { enabled: e.target.checked })} /> Enabled</label>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => runTest(selected, false)} disabled={test?.busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 text-xs font-bold disabled:opacity-50">
                    {test?.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} Test connection
                  </button>
                  {selected.vision && (
                    <button onClick={() => runTest(selected, true)} disabled={test?.busy} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs disabled:opacity-50">
                      Test vision
                    </button>
                  )}
                  <button onClick={() => remove(selected.id)} className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-300 hover:bg-red-500/10 border border-red-500/30 text-xs">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>

                {test && !test.busy && (
                  <div className={`flex items-start gap-2 text-xs p-2.5 rounded-lg border ${test.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-red-300 bg-red-500/10 border-red-500/30'}`}>
                    {test.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    <span className="break-words min-w-0">{test.msg}{test.ms !== undefined && ` (${test.ms} ms)`}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Routing */}
        <div className="border-t border-zinc-800 p-4 bg-zinc-950/60 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Deep Scan &amp; Face Analysis use (needs vision)</label>
            <select className={inputCls} value={settings.routing.vision} onChange={(e) => saveAISettings({ ...settings, routing: { ...settings.routing, vision: e.target.value } })}>
              <option value="auto">Automatic (first working provider)</option>
              {visionOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Command Assistant uses (text)</label>
            <select className={inputCls} value={settings.routing.text} onChange={(e) => saveAISettings({ ...settings, routing: { ...settings.routing, text: e.target.value } })}>
              <option value="auto">Automatic (first working provider)</option>
              {textOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 flex items-start gap-2 text-[10px] text-zinc-500 leading-relaxed">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-500/70 mt-0.5" />
            <span>
              Keys are stored in <strong className="text-zinc-400">this browser only</strong> (localStorage, unencrypted) and sent to your
              local server just to forward each request to the provider. Don&apos;t use this on a shared computer. Face matching itself never
              leaves your machine; only images you send to Deep Scan / Face Analysis go to the provider.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
