import { Capability, getProviderFor, toPayload } from './aiSettings';

/**
 * POST to one of the server's AI endpoints, attaching the provider the user configured for this
 * capability. If none is configured the server falls back to GEMINI_API_KEY from .env (if set).
 */
export function aiPost(path: string, body: Record<string, unknown>, capability: Capability): Promise<Response> {
  const provider = getProviderFor(capability);
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, provider: provider ? toPayload(provider) : undefined }),
  });
}
