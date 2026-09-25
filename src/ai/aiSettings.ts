import { useSyncExternalStore } from 'react';

export type ProviderKind = 'gemini' | 'openai' | 'anthropic' | 'custom';
export type Capability = 'vision' | 'text';

export interface AIProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  vision: boolean; // can it look at images (Deep Scan, face analysis)?
  text: boolean; // can it handle text commands (assistant)?
  enabled: boolean;
  /** Local servers such as Ollama do not need a key. */
  keyOptional?: boolean;
  custom?: { method: 'POST' | 'GET' | 'PUT'; headers: string; bodyTemplate: string; responsePath: string };
}

export interface AISettings {
  providers: AIProvider[];
  /** Which provider handles each capability: a provider id, or 'auto' (first enabled that can). */
  routing: { vision: string; text: string };
}

export interface ProviderPreset {
  key: string;
  label: string;
  provider: Omit<AIProvider, 'id' | 'apiKey' | 'enabled'>;
  hint: string;
}

export const PRESETS: ProviderPreset[] = [
  {
    key: 'gemini', label: 'Google Gemini',
    hint: 'Get a key at aistudio.google.com/apikey',
    provider: { name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', vision: true, text: true },
  },
  {
    key: 'openai', label: 'OpenAI',
    hint: 'Key from platform.openai.com/api-keys',
    provider: { name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', vision: true, text: true },
  },
  {
    key: 'anthropic', label: 'Anthropic Claude',
    hint: 'Key from console.anthropic.com',
    provider: { name: 'Anthropic Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5', vision: true, text: true },
  },
  {
    key: 'openrouter', label: 'OpenRouter (any model)',
    hint: 'One key for hundreds of models: openrouter.ai/keys',
    provider: { name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash', vision: true, text: true },
  },
  {
    key: 'groq', label: 'Groq (fast, text only)',
    hint: 'Key from console.groq.com',
    provider: { name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', vision: false, text: true },
  },
  {
    key: 'ollama', label: 'Ollama (local, no key)',
    hint: 'Runs on your PC. Install Ollama, then: ollama pull llava',
    provider: { name: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llava', vision: true, text: true, keyOptional: true },
  },
  {
    key: 'openai-compat', label: 'Other OpenAI-compatible',
    hint: 'Together, Mistral, DeepSeek, xAI, LM Studio, vLLM... any server exposing /chat/completions',
    provider: { name: 'Custom OpenAI-compatible', kind: 'openai', baseUrl: '', model: '', vision: false, text: true },
  },
  {
    key: 'custom', label: 'Any REST API (custom)',
    hint: 'Describe the request with a template. Placeholders: {{prompt}} {{system}} {{model}} {{apiKey}} {{image}} {{imageBase64}}',
    provider: {
      name: 'Custom API', kind: 'custom', baseUrl: '', model: '', vision: false, text: true,
      custom: {
        method: 'POST',
        headers: '{"Authorization": "Bearer {{apiKey}}"}',
        bodyTemplate: '{"model": "{{model}}", "messages": [{"role": "user", "content": "{{prompt}}"}]}',
        responsePath: 'choices.0.message.content',
      },
    },
  },
];

const KEY = 'vil.ai.settings.v1';
const EMPTY: AISettings = { providers: [], routing: { vision: 'auto', text: 'auto' } };

let cache: AISettings = load();
const listeners = new Set<() => void>();

function load(): AISettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw);
    return {
      providers: Array.isArray(p.providers) ? p.providers : [],
      routing: { vision: p?.routing?.vision ?? 'auto', text: p?.routing?.text ?? 'auto' },
    };
  } catch {
    return EMPTY;
  }
}

export function getAISettings(): AISettings {
  return cache;
}

export function saveAISettings(next: AISettings): void {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full / blocked */ }
  listeners.forEach((l) => l());
}

export function useAISettings(): AISettings {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => cache
  );
}

export function newProviderFromPreset(key: string): AIProvider {
  const preset = PRESETS.find((p) => p.key === key) ?? PRESETS[0];
  return { ...structuredClone(preset.provider), id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, apiKey: '', enabled: true };
}

export function isUsable(p: AIProvider, cap?: Capability): boolean {
  if (!p.enabled) return false;
  if (cap && !p[cap]) return false;
  if (!p.baseUrl && p.kind !== 'gemini' && p.kind !== 'anthropic') return false;
  return Boolean(p.apiKey) || Boolean(p.keyOptional);
}

/** Provider that should handle a capability right now (explicit routing first, then first usable). */
export function getProviderFor(cap: Capability, s: AISettings = cache): AIProvider | null {
  const wanted = s.routing[cap];
  if (wanted !== 'auto') {
    const p = s.providers.find((x) => x.id === wanted);
    if (p && isUsable(p, cap)) return p;
  }
  return s.providers.find((p) => isUsable(p, cap)) ?? null;
}

export function hasUserProvider(s: AISettings = cache): boolean {
  return s.providers.some((p) => isUsable(p));
}

/** What is sent to the local server (only what the adapter needs). */
export function toPayload(p: AIProvider) {
  return { kind: p.kind, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, custom: p.kind === 'custom' ? p.custom : undefined };
}
