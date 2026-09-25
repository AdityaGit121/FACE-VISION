import { TargetState, TrackedFace, IdentityProfile } from '../types';
import { euclideanDistance, MATCH_THRESHOLD } from '../identity/identityEngine';

export class TargetTrackerManager {
  private targetState: TargetState = {
    personId: null,
    name: '',
    locked: false,
    status: 'IDLE',
    trackingConfidence: 0,
    identityConfidence: 0,
    lastSeen: 0,
  };

  private reidentificationWindowMs: number = 8000; // 8 seconds search window before declaring LOST
  private targetDescriptor: number[] | null = null;

  getState(): TargetState {
    return { ...this.targetState };
  }

  /**
   * Lock a target by tracked face or identity profile.
   */
  lockTarget(
    face: TrackedFace | null,
    name: string,
    personId: string | null = null,
    descriptor?: Float32Array | number[]
  ): TargetState {
    const now = Date.now();
    this.targetState = {
      personId: personId || face?.identity.personId || null,
      name,
      locked: true,
      status: 'LOCKED',
      trackingConfidence: face ? 95 : 70,
      identityConfidence: face ? face.identity.confidence || 90 : 85,
      lastSeen: now,
      boundingBox: face?.box,
      trackId: face?.trackId,
      age: face?.age.smoothedAge,
      emotion: face?.expression.dominant,
      searchStartTime: now,
    };

    if (descriptor) {
      this.targetDescriptor = Array.from(descriptor);
    } else if (face?.descriptor) {
      this.targetDescriptor = Array.from(face.descriptor);
    }

    return this.getState();
  }

  /**
   * Search for an enrolled person by name in visible tracks or activate search mode.
   */
  searchTarget(
    targetName: string,
    enrolledProfiles: IdentityProfile[],
    activeTracks: TrackedFace[]
  ): { targetState: TargetState; foundImmediately: boolean; message: string } {
    const cleanName = targetName.trim().toLowerCase();
    const profile = enrolledProfiles.find(
      (p) => p.name.toLowerCase() === cleanName
    );

    const now = Date.now();

    // 1. Check if person is already recognized in active tracks
    const matchedTrack = activeTracks.find(
      (t) =>
        t.identity.status === 'KNOWN' &&
        t.identity.name?.toLowerCase() === cleanName
    );

    if (matchedTrack) {
      this.lockTarget(
        matchedTrack,
        matchedTrack.identity.name || targetName,
        profile?.id || matchedTrack.identity.personId,
        matchedTrack.descriptor
      );
      this.targetState.status = 'LOCKED';
      return {
        targetState: this.getState(),
        foundImmediately: true,
        message: `Target found: ${this.targetState.name}. Target locked.`,
      };
    }

    // 2. If profile exists with embeddings, search active track embeddings directly
    if (profile && profile.embeddings.length > 0) {
      let bestTrack: TrackedFace | null = null;
      let minDistance = Number.MAX_VALUE;

      for (const track of activeTracks) {
        if (!track.descriptor) continue;
        for (const sample of profile.embeddings) {
          const d = euclideanDistance(track.descriptor, sample);
          if (d < minDistance) {
            minDistance = d;
            bestTrack = track;
          }
        }
      }

      if (bestTrack && minDistance <= MATCH_THRESHOLD) {
        this.lockTarget(bestTrack, profile.name, profile.id, profile.embeddings[0]);
        this.targetState.status = 'LOCKED';
        return {
          targetState: this.getState(),
          foundImmediately: true,
          message: `Target found: ${profile.name}. Identity confidence: ${this.targetState.identityConfidence}%.`,
        };
      }
    }

    // 3. Not currently visible -> activate SEARCHING mode
    this.targetState = {
      personId: profile?.id || null,
      name: profile?.name || targetName,
      locked: true,
      status: 'SEARCHING',
      trackingConfidence: 0,
      identityConfidence: 0,
      lastSeen: 0,
      searchQuery: targetName,
      searchStartTime: now,
    };

    if (profile && profile.embeddings.length > 0) {
      this.targetDescriptor = profile.embeddings[0];
    }

    return {
      targetState: this.getState(),
      foundImmediately: false,
      message: `${this.targetState.name} is not currently visible. Searching visible frames...`,
    };
  }

  unlockTarget(): TargetState {
    this.targetState = {
      personId: null,
      name: '',
      locked: false,
      status: 'IDLE',
      trackingConfidence: 0,
      identityConfidence: 0,
      lastSeen: 0,
    };
    this.targetDescriptor = null;
    return this.getState();
  }

  /**
   * Evaluates active tracks in current frame and updates target following status.
   */
  update(
    activeTracks: TrackedFace[],
    enrolledProfiles: IdentityProfile[]
  ): { targetState: TargetState; targetTrackId: number | undefined } {
    if (!this.targetState.locked) {
      return { targetState: this.getState(), targetTrackId: undefined };
    }

    const now = Date.now();
    let matchedTrack: TrackedFace | null = null;

    // 1. Try matching by track ID first (spatial continuity)
    if (this.targetState.trackId) {
      const direct = activeTracks.find((t) => t.trackId === this.targetState.trackId);
      if (direct && direct.missedFrames <= 3) {
        // Validate biometric identity hasn't drastically swapped
        if (
          !this.targetDescriptor ||
          !direct.descriptor ||
          euclideanDistance(this.targetDescriptor, direct.descriptor) < 0.62
        ) {
          matchedTrack = direct;
        }
      }
    }

    // 2. If track ID lost or changed, match by biometric profile / stored descriptor
    if (!matchedTrack && (this.targetState.personId || this.targetDescriptor)) {
      const targetName = this.targetState.name.toLowerCase();

      // Check if any track has resolved to this known identity
      const byName = activeTracks.find(
        (t) =>
          t.identity.status === 'KNOWN' &&
          t.identity.name?.toLowerCase() === targetName
      );

      if (byName) {
        matchedTrack = byName;
      } else if (this.targetDescriptor) {
        // Direct embedding comparison
        let bestDist = Number.MAX_VALUE;
        let bestCandidate: TrackedFace | null = null;

        for (const track of activeTracks) {
          if (!track.descriptor) continue;
          const d = euclideanDistance(this.targetDescriptor, track.descriptor);
          if (d < bestDist) {
            bestDist = d;
            bestCandidate = track;
          }
        }

        if (bestCandidate && bestDist <= MATCH_THRESHOLD) {
          matchedTrack = bestCandidate;
        }
      }
    }

    // 3. State transition logic
    if (matchedTrack) {
      const wasSearchingOrLost =
        this.targetState.status === 'SEARCHING' || this.targetState.status === 'LOST';

      this.targetState.status = wasSearchingOrLost ? 'REACQUIRED' : 'LOCKED';
      this.targetState.trackId = matchedTrack.trackId;
      this.targetState.boundingBox = matchedTrack.box;
      this.targetState.lastSeen = now;
      this.targetState.age = matchedTrack.age.smoothedAge;
      this.targetState.emotion = matchedTrack.expression.dominant;
      this.targetState.identityConfidence = Math.max(
        this.targetState.identityConfidence,
        matchedTrack.identity.confidence || 88
      );
      this.targetState.trackingConfidence = Math.max(
        80,
        Math.min(99, Math.round(100 - matchedTrack.missedFrames * 10))
      );

      // Refresh target descriptor with high-quality sample
      if (matchedTrack.descriptor && matchedTrack.quality.overall >= 75) {
        this.targetDescriptor = Array.from(matchedTrack.descriptor);
      }

      return {
        targetState: this.getState(),
        targetTrackId: matchedTrack.trackId,
      };
    } else {
      // Target is not visible in current frame
      const timeSinceLastSeen = now - (this.targetState.lastSeen || this.targetState.searchStartTime || now);

      if (timeSinceLastSeen <= this.reidentificationWindowMs) {
        this.targetState.status = 'SEARCHING';
        this.targetState.trackingConfidence = Math.max(
          10,
          Math.round(70 * (1 - timeSinceLastSeen / this.reidentificationWindowMs))
        );
      } else {
        this.targetState.status = 'LOST';
        this.targetState.trackingConfidence = 0;
      }

      return {
        targetState: this.getState(),
        targetTrackId: undefined,
      };
    }
  }
}

export const targetTracker = new TargetTrackerManager();
