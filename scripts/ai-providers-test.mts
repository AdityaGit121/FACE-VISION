/** Verifies each provider adapter against local mock servers (request shape + response parsing). */
import http from 'node:http';
import { callModel, parseJsonLoose, getPath } from '../server/aiProviders';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); if (!ok) fails++; };

const seen: any[] = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = body ? JSON.parse(body) : null;
    seen.push({ url: req.url, headers: req.headers, json });
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.includes(':generateContent')) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }));
    if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: 'openai-ok' } }] }));
    if (req.url === '/v1/messages') return res.end(JSON.stringify({ content: [{ type: 'text', text: 'claude-ok' }] }));
    if (req.url === '/custom') return res.end(JSON.stringify({ result: { items: [{ text: 'custom-ok' }] } }));
    if (req.url === '/bad/chat/completions') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'invalid api key' } })); }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const img = { data: 'QUJD', mime: 'image/jpeg' };

// Gemini
let t = await callModel({ kind: 'gemini', baseUrl: base, apiKey: 'K1', model: 'gem-x' }, { prompt: 'hi', system: 'sys', images: [img], json: true });
let s = seen.at(-1);
check('gemini: text parsed', t === '{"a":1}');
check('gemini: model in URL + key header', s.url === '/v1beta/models/gem-x:generateContent' && s.headers['x-goog-api-key'] === 'K1');
check('gemini: image + prompt parts, JSON mode, system', s.json.contents[0].parts[0].inlineData.data === 'QUJD' && s.json.contents[0].parts[1].text === 'hi' && s.json.generationConfig.responseMimeType === 'application/json' && s.json.systemInstruction.parts[0].text === 'sys');

// OpenAI-compatible
t = await callModel({ kind: 'openai', baseUrl: `${base}/v1`, apiKey: 'K2', model: 'gpt-x' }, { prompt: 'hi', system: 'sys', images: [img] });
s = seen.at(-1);
check('openai: text parsed', t === 'openai-ok');
check('openai: bearer auth + model', s.headers.authorization === 'Bearer K2' && s.json.model === 'gpt-x');
check('openai: system msg + image_url data URL', s.json.messages[0].role === 'system' && s.json.messages[1].content[1].image_url.url === 'data:image/jpeg;base64,QUJD');
check('openai: no response_format on non-OpenAI hosts', s.json.response_format === undefined);
await callModel({ kind: 'openai', baseUrl: `${base}/v1`, model: 'local' }, { prompt: 'hi' }); // Ollama-style: no key
check('openai: works without an API key (local servers)', seen.at(-1).headers.authorization === undefined);

// Anthropic
t = await callModel({ kind: 'anthropic', baseUrl: base, apiKey: 'K3', model: 'claude-x' }, { prompt: 'hi', system: 'sys', images: [img] });
s = seen.at(-1);
check('anthropic: text parsed', t === 'claude-ok');
check('anthropic: x-api-key + version header', s.headers['x-api-key'] === 'K3' && s.headers['anthropic-version'] === '2023-06-01');
check('anthropic: base64 image block, system, max_tokens', s.json.messages[0].content[0].source.data === 'QUJD' && s.json.system === 'sys' && s.json.max_tokens > 0);

// Custom REST
t = await callModel(
  { kind: 'custom', baseUrl: `${base}/custom`, apiKey: 'K4', model: 'm', custom: {
      headers: '{"X-Token":"{{apiKey}}"}',
      bodyTemplate: '{"input":{"question":"{{prompt}}","img":"{{imageBase64}}"},"m":"{{model}}"}',
      responsePath: 'result.items.0.text' } },
  { prompt: 'what?', images: [img] });
s = seen.at(-1);
check('custom: template filled + header key', s.json.input.question === 'what?' && s.json.input.img === 'QUJD' && s.json.m === 'm' && s.headers['x-token'] === 'K4');
check('custom: response path extracts nested value', t === 'custom-ok');

// Errors
let msg = '';
try { await callModel({ kind: 'openai', baseUrl: base + '/bad', apiKey: 'x' }, { prompt: 'p' }); } catch (e: any) { msg = e.message; }
check('error surfaces provider message', /401/.test(msg));
msg = '';
try { await callModel({ kind: 'custom', baseUrl: 'file:///etc/passwd' }, { prompt: 'p' }); } catch (e: any) { msg = e.message; }
check('non-http URLs are rejected', /http/i.test(msg));
msg = '';
try { await callModel({ kind: 'custom', baseUrl: `${base}/custom`, custom: { bodyTemplate: '{oops' } }, { prompt: 'p' }); } catch (e: any) { msg = e.message; }
check('bad template JSON gives a clear error', /valid JSON/.test(msg));

// JSON parsing tolerance
check('parseJsonLoose: fenced', parseJsonLoose('```json\n{"x":2}\n```').x === 2);
check('parseJsonLoose: chatter around JSON', parseJsonLoose('Sure! Here you go: {"x":3} hope it helps').x === 3);
check('getPath', getPath({ a: [{ b: 5 }] }, 'a.0.b') === 5);

server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
