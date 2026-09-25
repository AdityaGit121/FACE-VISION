import { IdentityProfile, IdentityMatch, IdentityStatus } from '../types';
import { idb } from './indexedDb';

export const MATCH_THRESHOLD = 0.48; // Euclidean distance cutoff for KNOWN
export const UNCERTAIN_THRESHOLD = 0.58; // Cutoff for UNCERTAIN

/**
 * Calculates Euclidean distance between two 128-dimensional vectors.
 */
export function euclideanDistance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  if (a.length !== b.length) return 2.0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Compares an unknown face embedding against all enrolled profiles in the gallery.
 * Uses multi-sample matching: computes minimum distance, average distance, and best-k distance.
 */
export function matchEmbeddingAgainstProfiles(
  descriptor: Float32Array | number[],
  profiles: IdentityProfile[]
): IdentityMatch {
  if (!profiles || profiles.length === 0 || !descriptor) {
    return {
      status: 'UNKNOWN',
      confidence: 0,
      distance: 1.0,
      sampleCount: 0,
      matchScore: 0,
    };
  }

  let bestProfile: IdentityProfile | null = null;
  let minDistance = Number.MAX_VALUE;
  let bestProfileSampleCount = 0;

  for (const profile of profiles) {
    if (!profile.embeddings || profile.embeddings.length === 0) continue;

    // Collect all distances for this profile's samples
    const distances: number[] = [];
    for (const sample of profile.embeddings) {
      const dist = euclideanDistance(descriptor, sample);
      distances.push(dist);
    }

    // Sort to find best-k (up to top 3 samples)
    distances.sort((a, b) => a - b);
    const k = Math.min(3, distances.length);
    const bestKDist = distances.slice(0, k).reduce((acc, d) => acc + d, 0) / k;
    const profileMinDist = distances[0];

    // Blended metric: 70% min distance + 30% best-k distance
    const combinedDist = 0.7 * profileMinDist + 0.3 * bestKDist;

    if (combinedDist < minDistance) {
      minDistance = combinedDist;
      bestProfile = profile;
      bestProfileSampleCount = profile.embeddings.length;
    }
  }

  if (!bestProfile || minDistance > UNCERTAIN_THRESHOLD) {
    const fallbackScore = Math.max(0, Math.round((1 - Math.min(1.2, minDistance) / 1.2) * 100));
    return {
      status: 'UNKNOWN',
      confidence: fallbackScore,
      distance: Number(minDistance.toFixed(3)),
      sampleCount: 0,
      matchScore: fallbackScore,
    };
  }

  // Normalized similarity score: 0.20 -> 98%, 0.48 -> 76%, 0.58 -> 55%
  // Formula: score = Math.max(0, Math.min(100, Math.round((1 - minDistance / 0.70) * 100)))
  const matchScore = Math.max(
    0,
    Math.min(99, Math.round((1 - minDistance / 0.72) * 100))
  );

  let status: IdentityStatus = 'UNKNOWN';
  if (minDistance <= MATCH_THRESHOLD) {
    status = 'KNOWN';
  } else if (minDistance <= UNCERTAIN_THRESHOLD) {
    status = 'UNCERTAIN';
  }

  return {
    status,
    personId: bestProfile.id,
    name: bestProfile.name,
    confidence: matchScore,
    distance: Number(minDistance.toFixed(3)),
    sampleCount: bestProfileSampleCount,
    matchScore,
  };
}

/**
 * Enrolls a new identity or adds samples to an existing identity profile.
 */
export async function enrollFaceSample(
  name: string,
  descriptor: Float32Array | number[],
  thumbnailUrl?: string,
  notes?: string
): Promise<IdentityProfile> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Identity name is required');

  const existingList = await idb.getAllIdentities();
  const existing = existingList.find(
    (p) => p.name.toLowerCase() === cleanName.toLowerCase()
  );

  const descriptorArray = Array.from(descriptor);

  if (existing) {
    // Check if new sample is duplicate (distance < 0.08)
    const isDuplicate = existing.embeddings.some(
      (e) => euclideanDistance(descriptorArray, e) < 0.08
    );
    if (!isDuplicate) {
      existing.embeddings.push(descriptorArray);
      // Keep up to 12 diverse samples per identity
      if (existing.embeddings.length > 12) {
        existing.embeddings.shift();
      }
    }

    existing.sampleCount = existing.embeddings.length;
    existing.updatedAt = Date.now();
    if (thumbnailUrl) existing.thumbnail = thumbnailUrl;
    if (notes) existing.metadata = { ...existing.metadata, notes };

    await idb.saveIdentity(existing);
    return existing;
  } else {
    // Create new identity profile
    const newProfile: IdentityProfile = {
      id: `id_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: cleanName,
      embeddings: [descriptorArray],
      thumbnail: thumbnailUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sampleCount: 1,
      metadata: { notes },
    };

    await idb.saveIdentity(newProfile);
    return newProfile;
  }
}
