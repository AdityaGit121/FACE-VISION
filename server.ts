import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { callModel, parseJsonLoose, ProviderPayload, ImageInput } from './server/aiProviders';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// Loopback by default: this server forwards requests carrying API keys, so it must not be
// reachable from other machines on the network. Set HOST=0.0.0.0 to expose it deliberately.
const HOST = process.env.HOST || '127.0.0.1';

// Body parser with 25MB limit for high-resolution base64 video frames
app.use(express.json({ limit: '25mb' }));

// Optional server-side default (fallback when the user has not added a provider in the UI).
const envKey = process.env.GEMINI_API_KEY || '';
const envKeyUsable = Boolean(envKey) && !/^MY_/i.test(envKey); // ignore the .env.example placeholder
const serverDefault: ProviderPayload | null = envKeyUsable
  ? { kind: 'gemini', apiKey: envKey, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' }
  : null;

/** Provider sent by the browser wins; otherwise the server default; otherwise null. */
function resolveProvider(raw: any): ProviderPayload | null {
  if (raw && typeof raw === 'object' && ['gemini', 'openai', 'anthropic', 'custom'].includes(raw.kind)) {
    return {
      kind: raw.kind,
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : undefined,
      model: typeof raw.model === 'string' ? raw.model : undefined,
      custom: raw.custom && typeof raw.custom === 'object' ? raw.custom : undefined,
    };
  }
  return serverDefault;
}

function parseImage(dataUrlOrB64: unknown): ImageInput | null {
  if (typeof dataUrlOrB64 !== 'string' || !dataUrlOrB64) return null;
  const m = /^data:(image\/[\w+.-]+);base64,(.*)$/s.exec(dataUrlOrB64);
  return m ? { mime: m[1], data: m[2] } : { mime: 'image/jpeg', data: dataUrlOrB64 };
}

/** Shared handler: build request -> call provider -> parse JSON -> respond. */
async function runJsonTask(
  req: express.Request,
  res: express.Response,
  build: (body: any) => { prompt: string; system?: string; images?: ImageInput[] } | { error: string },
  label: string
) {
  const startTime = Date.now();
  try {
    const provider = resolveProvider(req.body?.provider);
    if (!provider) {
      return res.status(503).json({ error: 'No AI provider configured. Add one with the API button, or set GEMINI_API_KEY in .env.', code: 'NO_API_KEY' });
    }
    const built = build(req.body ?? {});
    if ('error' in built) return res.status(400).json({ error: built.error });
    const text = await callModel(provider, { ...built, json: true });
    res.json({ success: true, data: parseJsonLoose(text), latencyMs: Date.now() - startTime, model: provider.model, provider: provider.kind });
  } catch (error: any) {
    console.error(`${label} error:`, error?.message || error);
    res.status(500).json({ error: error?.message || `${label} failed`, latencyMs: Date.now() - startTime });
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', timestamp: Date.now(), hasGeminiKey: Boolean(serverDefault) });
});

// Connection test used by the API settings dialog
app.post('/api/ai/test', async (req, res) => {
  const startTime = Date.now();
  try {
    const provider = resolveProvider(req.body?.provider);
    if (!provider) return res.status(400).json({ ok: false, error: 'No provider supplied.' });
    const withImage = Boolean(req.body?.withImage);
    // 8x8 solid-red PNG for the vision check
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC';
    const text = await callModel(provider, {
      prompt: withImage ? 'What is the dominant colour of this image? Answer with one word.' : 'Reply with the single word: OK',
      images: withImage ? [{ data: png, mime: 'image/png' }] : undefined,
      maxTokens: 20,
    });
    res.json({ ok: true, reply: text.trim().slice(0, 120), latencyMs: Date.now() - startTime });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: e?.message || 'Connection failed', latencyMs: Date.now() - startTime });
  }
});

// Deep AI Scan
app.post('/api/gemini/deep-scan', (req, res) =>
  runJsonTask(req, res, (b) => {
    const img = parseImage(b.imageBase64);
    if (!img) return { error: 'Missing imageBase64 in request body' };
    return {
      images: [img],
      prompt: `Perform an advanced multimodal computer vision inspection of this frame.
Local computer vision subsystem detected ${b.localCVData?.facesCount ?? 0} face(s).
1. Give a succinct scene description.
2. For each person/face observed, give observed facial expression, approximate age range, visual attributes (glasses, facial hair, headwear), lighting and quality.
3. Compare with the local CV detection count and note any discrepancy.
Do NOT invent identity names. Biometric identity is handled locally.

Respond with ONLY a JSON object of exactly this shape (no markdown):
{"sceneSummary": string, "facesDetected": integer,
 "faces": [{"faceIndex": integer, "observedExpression": string, "approximateAgeRange": string, "visualAttributes": [string], "lightingQuality": string, "confidenceScore": number}],
 "cvConsistency": "HIGH" | "MODERATE" | "DISAGREEMENT", "contextualInsights": [string]}`,
    };
  }, 'Deep scan')
);

// Natural-language command dispatcher
app.post('/api/gemini/assistant', (req, res) =>
  runJsonTask(req, res, (b) => {
    if (!b.query) return { error: 'Missing query in request body' };
    const c = b.sceneContext;
    return {
      prompt: `You are the command dispatcher for an AI Face Intelligence workstation.
User query: "${String(b.query).slice(0, 500)}"
State: visible people ${c?.visiblePersonsCount ?? 0}; tracked names ${JSON.stringify(c?.visibleIdentities ?? [])}; target locked: ${c?.targetState?.locked ? c.targetState.name : 'none'}; enrolled: ${JSON.stringify(c?.enrolledNames ?? [])}.
Classify into one intent: LOCK_TARGET, UNLOCK_TARGET, FIND_TARGET, ANALYZE_SCENE, ANALYZE_FACE, DEEP_SCAN, LIST_IDENTITIES, SHOW_HISTORY, SELECT_FACE, CLEAR_TARGET, UNKNOWN.
spokenResponse must be under 2 sentences, direct, suitable for voice.

Respond with ONLY a JSON object (no markdown): {"intent": string, "targetName": string|null, "faceIndex": integer|null, "spokenResponse": string, "explanation": string}`,
    };
  }, 'Assistant')
);

// Single face in-depth analysis
app.post('/api/gemini/analyze-face', (req, res) =>
  runJsonTask(req, res, (b) => {
    const img = parseImage(b.imageBase64);
    if (!img) return { error: 'Missing imageBase64' };
    const m = b.localMetrics;
    return {
      images: [img],
      prompt: `Analyze this face crop.
Local measurements: age ${m?.age ?? 'unknown'}, expression ${m?.expression ?? 'unknown'}, quality ${m?.quality ?? 'unknown'}%.
Give: micro-expression indicators, head pose and gaze, facial features / visual attributes (glasses, facial hair, markers), lighting and sharpness.

Respond with ONLY a JSON object (no markdown):
{"microExpression": string, "gazeDirection": string, "distinctiveFeatures": [string], "lightingAssessment": string, "qualityAssessment": string, "summary": string}`,
    };
  }, 'Face analysis')
);

// Setup Vite middleware in development or static serving in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`AI Face Intelligence server active on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  });
}

startServer();
