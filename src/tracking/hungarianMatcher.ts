/**
 * Hungarian (Kuhn-Munkres) Algorithm for optimal bipartite maximum weight / minimum cost assignment.
 * Supports non-square cost matrices (tracks != detections).
 */

export interface MatchResult {
  matches: Array<[number, number]>; // [trackIndex, detectionIndex]
  unmatchedTracks: number[];
  unmatchedDetections: number[];
}

const INFINITY = 1e9;

/**
 * Solves the linear sum assignment problem using the Kuhn-Munkres (Hungarian) algorithm in O(N^3).
 *
 * @param costMatrix 2D array of costs where costMatrix[i][j] is the cost of assigning track i to detection j.
 * @param maxCostThreshold Any match with cost >= maxCostThreshold will be rejected and considered unmatched.
 */
export function hungarianMatch(
  costMatrix: number[][],
  maxCostThreshold: number = 0.85
): MatchResult {
  const numRows = costMatrix.length;
  if (numRows === 0) {
    return { matches: [], unmatchedTracks: [], unmatchedDetections: [] };
  }
  const numCols = costMatrix[0].length;
  if (numCols === 0) {
    return {
      matches: [],
      unmatchedTracks: Array.from({ length: numRows }, (_, i) => i),
      unmatchedDetections: [],
    };
  }

  // Dimension of padded square matrix
  const dim = Math.max(numRows, numCols);

  // Build square cost matrix padded with max values
  const matrix: number[][] = Array.from({ length: dim }, (_, r) =>
    Array.from({ length: dim }, (_, c) => {
      if (r < numRows && c < numCols) {
        return Number.isFinite(costMatrix[r][c]) ? costMatrix[r][c] : INFINITY;
      }
      return INFINITY;
    })
  );

  // 1-indexed variables for the classical Hungarian implementation
  const u = new Float64Array(dim + 1);
  const v = new Float64Array(dim + 1);
  const p = new Int32Array(dim + 1);
  const way = new Int32Array(dim + 1);

  for (let i = 1; i <= dim; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(dim + 1).fill(INFINITY);
    const used = new Uint8Array(dim + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INFINITY;
      let j1 = 0;

      for (let j = 1; j <= dim; j++) {
        if (!used[j]) {
          const cur = matrix[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }

      for (let j = 0; j <= dim; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  // Extract assignments: p[col] = row (1-indexed)
  const matches: Array<[number, number]> = [];
  const assignedTracks = new Set<number>();
  const assignedDetections = new Set<number>();

  for (let j = 1; j <= dim; j++) {
    const rowIdx = p[j] - 1;
    const colIdx = j - 1;

    if (rowIdx >= 0 && rowIdx < numRows && colIdx >= 0 && colIdx < numCols) {
      const cost = costMatrix[rowIdx][colIdx];
      if (cost < maxCostThreshold) {
        matches.push([rowIdx, colIdx]);
        assignedTracks.add(rowIdx);
        assignedDetections.add(colIdx);
      }
    }
  }

  const unmatchedTracks: number[] = [];
  for (let i = 0; i < numRows; i++) {
    if (!assignedTracks.has(i)) unmatchedTracks.push(i);
  }

  const unmatchedDetections: number[] = [];
  for (let j = 0; j < numCols; j++) {
    if (!assignedDetections.has(j)) unmatchedDetections.push(j);
  }

  return {
    matches,
    unmatchedTracks,
    unmatchedDetections,
  };
}
