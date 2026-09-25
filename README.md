# Vision Intelligence Lab

## Run
```
npm install        # postinstall copies the ONNX runtime to public/ort and fetches the YOLO model if missing
npm run dev
npm test               # tracker benchmark + session memory + AI provider adapters (no camera needed)
```
On Windows just double-click `setup.bat`, then `run.bat`.
For Deep Scan / face analysis / the assistant, click **API** in the top bar and add a provider (no `.env` needed).

## Pipeline (what changed and why)
| Stage | Before | Now |
|---|---|---|
| Detector | Tiny SSD only, fixed settings | **YOLOv8n-face (ONNX, WebGPU -> WASM)**, auto-fallback to Tiny SSD; higher-recall mode while nothing is tracked |
| Scheduling | timer + overlapping async jobs | one **frame-synced** (`requestVideoFrameCallback`) single-flight loop; never analyses a frame twice, never piles up |
| Latency | box drawn where the face was ~60-100 ms ago | Kalman **extrapolates to display time** every animation frame |
| Kalman | per-cycle dt=1, + EMA + rounding + renderer lerp | **time-based CV Kalman**, size/score-scaled noise, correction-offset decay (no snaps) |
| Association | IoU only, gating breaks on fast motion | Hungarian, priority passes, IoU+centre cost, gate widens while unseen |
| Duplicates | spawned then merged later | suppressed **before** spawning; merge net also catches partial boxes |
| Flicker | box vanished after 1 missed frame | tentative -> confirmed -> **coasting (fading)** -> hidden -> removed |
| Recognition / landmarks / age / expression | ran on the **whole frame**, result written to an arbitrary track (wrong face!) | run on a **padded crop of that one track**, nearest-face check, descriptor averaging |
| React | full-app re-render 30x/s | UI state ~7 Hz; canvas reads engine directly |

Tuning knobs: `src/tracking/kalmanFilter.ts` (`DEFAULT_KALMAN_TUNING`), `src/tracking/multiFaceTracker.ts` (`DEFAULT_CONFIG`).
Force a detector: `visionEngine.setConfig({ detector: 'tiny' | 'yolo' })`.
Model: YOLOv8n-face (Ultralytics, AGPL-3.0) - check the licence if you distribute this commercially.

## Session memory vs. enrolled identities (two separate systems)
| | Session memory | Enrollment |
|---|---|---|
| Purpose | "Have I seen this face since I pressed Start?" | "Remember this specific person" |
| Stored | RAM only, wiped by **Refresh** / page reload | IndexedDB, permanent |
| Names | Person 1, 2, 3... | Names you type |
| Used for | Same face leaving and returning keeps its number | Recognition, target lock / follow |
Both can be active at once: a box reads `Alex · Person 2` when an enrolled person is also in the session.
Code: `src/identity/sessionMemory.ts` (thresholds `SESSION_SAME` / `SESSION_GRAY`).

## Auto enrollment
Open **Enroll Face**, type a name (before or after), and slowly turn your head. Front, both sides, up and down are captured
automatically (quality-gated, pose held ~0.3 s). Saves itself when done. Code: `src/components/EnrollmentWizard.tsx`.

## AI providers (any API)
Top bar -> **API**. Presets: Gemini, OpenAI, Claude, OpenRouter, Groq, Ollama (local, no key), any OpenAI-compatible server,
and **Any REST API** (request template + response path). Route vision tasks (Deep Scan, face analysis) and text tasks
(assistant) to different providers. Keys live in this browser's localStorage and are forwarded by the local server;
the server binds to 127.0.0.1 only. Code: `server/aiProviders.ts`, `src/ai/`.
"# FACE-VISION" 
