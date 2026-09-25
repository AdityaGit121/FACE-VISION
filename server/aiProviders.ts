/**
 * Provider-agnostic model calls. The browser stores the user's provider settings and sends the
 * chosen provider with each request; this module forwards it (no CORS problems, and the key is
 * never stored on the server).
 *
 * Supported kinds:
 *   gemini     Google Generative Language API (generateContent)
 *   openai     Anything OpenAI-compatible (/chat/completions): OpenAI, OpenRouter, Groq, Together,
 *              Mistral, DeepSeek, xAI, Ollama, LM Studio, vLLM, ...
 *   anthropic  Anthropic Messages API
 *   custom     Any HTTP JSON API, described by a request template + a response path
 */

export type ProviderKind = 'gemini' | 'openai' | 'anthropic' | 'custom';

export interface ProviderPayload {
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  custom?: {
    method?: 'POST' | 'GET' | 'PUT';
    headers?: string; // JSON object as text; may use {{apiKey}}
    bodyTemplate?: string; // JSON as text; placeholders: {{prompt}} {{system}} {{model}} {{apiKey}} {{image}} {{imageBase64}} {{imageMime}}
    responsePath?: string; // e.g. choices.0.message.content
  };
}

export interface ImageInput {
  data: string; // base64, no data: prefix
  mime: string;
}

export interface ModelRequest {
  system?: string;
  prompt: string;
  images?: ImageInput[];
  json?: boolean;
  maxTokens?: number;
}

const TIMEOUT_MS = 60_000;

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

export function assertHttpUrl(u: string): string {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    throw new Error(`Invalid URL: "${u}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.');
  return url.toString();
}

async function post(url: string, headers: Record<string, string>, body: unknown, method = 'POST'): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(assertHttpUrl(url), {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    if (!res.ok) {
      const msg = json?.error?.message || json?.error?.type || json?.message || (typeof json?.error === 'string' ? json.error : '') || text.slice(0, 300);
      throw new Error(`Provider returned HTTP ${res.status}: ${msg}`);
    }
    return json ?? text;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`Provider request timed out after ${TIMEOUT_MS / 1000}s`);
    if (e?.message === 'fetch failed') {
      const code = e?.cause?.code || e?.cause?.message || 'network error';
      let host = url;
      try { host = new URL(url).host; } catch { /* keep raw */ }
      const hint = code === 'ECONNREFUSED' ? ' (is the server running / is the URL right?)' : code === 'ENOTFOUND' ? ' (check the base URL and your internet connection)' : '';
      throw new Error(`Could not reach ${host}: ${code}${hint}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
async function callGemini(p: ProviderPayload, r: ModelRequest): Promise<string> {
  const base = trimSlash(p.baseUrl || 'https://generativelanguage.googleapis.com');
  const model = p.model || 'gemini-2.5-flash';
  const parts: any[] = (r.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }));
  parts.push({ text: r.prompt });
  const body: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: r.maxTokens ?? 2048, ...(r.json ? { responseMimeType: 'application/json' } : {}) },
  };
  if (r.system) body.systemInstruction = { parts: [{ text: r.system }] };
  const data = await post(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': p.apiKey || '' }, body);
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? '').join('');
  if (!text) throw new Error(data?.promptFeedback?.blockReason ? `Blocked by provider: ${data.promptFeedback.blockReason}` : 'Empty response from Gemini');
  return text;
}

async function callOpenAI(p: ProviderPayload, r: ModelRequest): Promise<string> {
  const base = trimSlash(p.baseUrl || 'https://api.openai.com/v1');
  const content: any[] = [{ type: 'text', text: r.prompt }];
  for (const i of r.images ?? []) content.push({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } });
  const messages: any[] = [];
  if (r.system) messages.push({ role: 'system', content: r.system });
  messages.push({ role: 'user', content: r.images?.length ? content : r.prompt });
  const body: any = { model: p.model || 'gpt-4o-mini', messages, max_tokens: r.maxTokens ?? 2048 };
  // response_format is only reliably supported by OpenAI itself; other servers get the JSON instruction in the prompt.
  if (r.json && /api\.openai\.com/.test(base)) body.response_format = { type: 'json_object' };
  const headers: Record<string, string> = {};
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
  const data = await post(`${base}/chat/completions`, headers, body);
  const m = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(m) ? m.map((x: any) => x.text ?? '').join('') : m;
  if (!text) throw new Error('Empty response from provider');
  return String(text);
}

async function callAnthropic(p: ProviderPayload, r: ModelRequest): Promise<string> {
  const base = trimSlash(p.baseUrl || 'https://api.anthropic.com');
  const content: any[] = (r.images ?? []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }));
  content.push({ type: 'text', text: r.prompt });
  const body: any = { model: p.model || 'claude-sonnet-5', max_tokens: r.maxTokens ?? 2048, messages: [{ role: 'user', content }] };
  if (r.system) body.system = r.system;
  const data = await post(`${base}/v1/messages`, { 'x-api-key': p.apiKey || '', 'anthropic-version': '2023-06-01' }, body);
  const text = (data?.content ?? []).map((x: any) => (x.type === 'text' ? x.text : '')).join('');
  if (!text) throw new Error('Empty response from Anthropic');
  return text;
}

function fill(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{(\w+)\}\}$/.exec(value);
    if (whole) return vars[whole[1]] ?? '';
    return value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fill(v, vars)]));
  }
  return value;
}

export function getPath(obj: any, path: string): any {
  return path
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[/^\d+$/.test(key) ? Number(key) : key]), obj);
}

async function callCustom(p: ProviderPayload, r: ModelRequest): Promise<string> {
  const c = p.custom ?? {};
  const img = r.images?.[0];
  const vars: Record<string, string> = {
    prompt: r.prompt,
    system: r.system ?? '',
    model: p.model ?? '',
    apiKey: p.apiKey ?? '',
    image: img ? `data:${img.mime};base64,${img.data}` : '',
    imageBase64: img?.data ?? '',
    imageMime: img?.mime ?? '',
  };
  let headers: Record<string, string> = {};
  if (c.headers?.trim()) {
    try { headers = fill(JSON.parse(c.headers), vars) as Record<string, string>; }
    catch { throw new Error('Custom provider: "Headers" is not valid JSON.'); }
  }
  let body: unknown = { prompt: r.prompt };
  if (c.bodyTemplate?.trim()) {
    try { body = fill(JSON.parse(c.bodyTemplate), vars); }
    catch { throw new Error('Custom provider: "Body template" is not valid JSON.'); }
  }
  const data = await post(p.baseUrl || '', headers, body, c.method || 'POST');
  if (!c.responsePath?.trim()) return typeof data === 'string' ? data : JSON.stringify(data);
  const out = getPath(data, c.responsePath.trim());
  if (out == null) throw new Error(`Custom provider: response has nothing at "${c.responsePath}". Response started with: ${JSON.stringify(data).slice(0, 200)}`);
  return typeof out === 'string' ? out : JSON.stringify(out);
}

export async function callModel(p: ProviderPayload, r: ModelRequest): Promise<string> {
  switch (p.kind) {
    case 'gemini': return callGemini(p, r);
    case 'openai': return callOpenAI(p, r);
    case 'anthropic': return callAnthropic(p, r);
    case 'custom': return callCustom(p, r);
    default: throw new Error(`Unknown provider kind "${(p as any).kind}"`);
  }
}

/** Models often wrap JSON in ```fences``` or add a sentence around it; be forgiving. */
export function parseJsonLoose(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new Error('The model did not return valid JSON.');
}
