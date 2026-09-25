import { aiPost } from '../ai/aiClient';
import { TrackedFace, IdentityProfile, TargetState } from '../types';

export interface ParsedCommand {
  intent:
    | 'LOCK_TARGET'
    | 'UNLOCK_TARGET'
    | 'FIND_TARGET'
    | 'ANALYZE_SCENE'
    | 'ANALYZE_FACE'
    | 'DEEP_SCAN'
    | 'LIST_IDENTITIES'
    | 'SHOW_HISTORY'
    | 'SELECT_FACE'
    | 'CLEAR_TARGET'
    | 'UNKNOWN';
  targetName?: string;
  faceIndex?: number;
  spokenResponse: string;
}

/**
 * Fast client-side rule-based command interpreter for zero-latency local execution.
 */
export function parseLocalCommand(
  rawQuery: string,
  faces: TrackedFace[],
  enrolled: IdentityProfile[],
  targetState: TargetState
): ParsedCommand | null {
  const query = rawQuery.trim().toLowerCase();

  // 1. Find target by name (e.g. "find alex", "locate sarah", "where is john")
  const findMatch = query.match(/^(?:find|locate|search for|where is|track)\s+([a-z0-9_\- ]+)/i);
  if (findMatch) {
    const name = findMatch[1].trim();
    return {
      intent: 'FIND_TARGET',
      targetName: name,
      spokenResponse: `Initiating biometric search for ${name}.`,
    };
  }

  // 2. Lock target
  if (query.includes('lock target') || query.includes('lock on') || query.startsWith('lock')) {
    const nameMatch = query.match(/lock (?:on |target )?([a-z0-9_\-]+)/i);
    const targetName = nameMatch ? nameMatch[1].trim() : undefined;
    return {
      intent: 'LOCK_TARGET',
      targetName,
      spokenResponse: targetName
        ? `Locking target ${targetName}.`
        : 'Target lock engaged for selected face.',
    };
  }

  // 3. Unlock or clear target
  if (query.includes('unlock') || query.includes('release target') || query.includes('clear target')) {
    return {
      intent: 'UNLOCK_TARGET',
      spokenResponse: 'Target lock released. System returning to autonomous tracking.',
    };
  }

  // 4. Deep scan
  if (query.includes('deep scan') || query.includes('ai scan') || query.includes('gemini scan')) {
    return {
      intent: 'DEEP_SCAN',
      spokenResponse: 'Executing multimodal AI deep scan on active frame.',
    };
  }

  // 5. How many people / Who is visible
  if (
    query.includes('how many people') ||
    query.includes('count people') ||
    query.includes('who is visible') ||
    query.includes('who is in')
  ) {
    const count = faces.length;
    const knownNames = faces
      .filter((f) => f.identity.status === 'KNOWN' && f.identity.name)
      .map((f) => f.identity.name);

    let response = `${count} ${count === 1 ? 'person' : 'people'} currently detected in frame.`;
    if (knownNames.length > 0) {
      response += ` Recognized identities: ${knownNames.join(', ')}.`;
    }
    return {
      intent: 'ANALYZE_SCENE',
      spokenResponse: response,
    };
  }

  // 6. Select face (e.g. "select person 2", "select face 1", "face 3")
  const selectMatch = query.match(/(?:select\s+)?(?:face|person|track)\s*#?\s*(\d+)/i);
  if (selectMatch) {
    const idx = parseInt(selectMatch[1], 10);
    return {
      intent: 'SELECT_FACE',
      faceIndex: idx,
      spokenResponse: `Inspection reticle focused on Person #${idx}.`,
    };
  }

  // 7. Analyze selected face or person
  if (
    query.includes('analyze face') ||
    query.includes('analyze person') ||
    query.includes('what expression') ||
    query.includes('how old')
  ) {
    return {
      intent: 'ANALYZE_FACE',
      spokenResponse: 'Analyzing facial biometrics and micro-expressions for selected person.',
    };
  }

  // 8. List identities or enrolled gallery
  if (
    query.includes('list identities') ||
    query.includes('who is enrolled') ||
    query.includes('show gallery')
  ) {
    return {
      intent: 'LIST_IDENTITIES',
      spokenResponse: `Currently storing ${enrolled.length} enrolled local biometric profiles.`,
    };
  }

  // 9. History or sightings
  if (query.includes('history') || query.includes('sightings') || query.includes('attendance')) {
    return {
      intent: 'SHOW_HISTORY',
      spokenResponse: 'Displaying biometric sighting logs and temporal records.',
    };
  }

  // Return null if fallback to Gemini server assistant is desired
  return null;
}

/**
 * Calls server-side Gemini Assistant for natural-language intent parsing when
 * local heuristics don't have a direct pattern match.
 */
export async function dispatchServerAssistantCommand(
  query: string,
  sceneContext: any
): Promise<ParsedCommand> {
  const res = await aiPost('/api/gemini/assistant', { query, sceneContext }, 'text');

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Command assistant error (${res.status})`);
  }

  const result = await res.json();
  return result.data as ParsedCommand;
}
