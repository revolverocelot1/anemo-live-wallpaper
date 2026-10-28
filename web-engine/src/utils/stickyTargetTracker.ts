/**
 * Sticky single-target tracker (pure logic, no DOM / MediaPipe imports).
 *
 * Rules (from the product spec):
 *  - Lock onto ONE person (the closest = largest `scale`) and remember (x, y, scale).
 *  - Every frame, match candidates against the last known position (Euclidean gate).
 *    All non-matching people are ignored. We NEVER average two people.
 *  - Occlusion grace: if the locked person is missing, hold the last position for
 *    `graceMs` (2500ms). Only after that do we hand over to another person.
 *  - Manual handover: `switchTarget()` jumps to the next person (UI "Switch Target").
 *
 * Coordinates are normalized camera-frame coords in [0,1] (raw, un-mirrored).
 */

export interface PersonCandidate {
  /** Anchor point (face centre if face visible, else head-from-torso estimate). */
  x: number;
  y: number;
  /** Approximate head width in normalized frame units (bigger = closer). */
  scale: number;
  /** Which detector produced the anchor. */
  source: 'face' | 'body';
  /** Index of the matching face in FaceLandmarker output (if any). */
  faceIndex?: number;
}

export interface StickyTargetState {
  /** The currently locked person, or null if nobody has been seen. */
  target: PersonCandidate | null;
  /** True when target is a held (not currently visible) position during grace. */
  held: boolean;
  /** True when no one is locked and the grace period elapsed. */
  lost: boolean;
}

export interface StickyTargetOptions {
  graceMs: number;
  /** Max distance (normalized) between frames to count as the same person. */
  gateRadius: number;
}

export const DEFAULT_STICKY_OPTIONS: StickyTargetOptions = {
  graceMs: 2500,
  gateRadius: 0.22,
};

export class StickyTargetTracker {
  private opts: StickyTargetOptions;
  private last: PersonCandidate | null = null;
  private lastSeenMs = 0;

  constructor(opts: Partial<StickyTargetOptions> = {}) {
    this.opts = { ...DEFAULT_STICKY_OPTIONS, ...opts };
  }

  reset(): void {
    this.last = null;
    this.lastSeenMs = 0;
  }

  private static dist(a: PersonCandidate, b: PersonCandidate): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Closest person = biggest head scale. */
  private static pickClosest(cands: PersonCandidate[]): PersonCandidate {
    return cands.reduce((best, c) => (c.scale > best.scale ? c : best), cands[0]);
  }

  update(cands: PersonCandidate[], nowMs: number): StickyTargetState {
    // 1) Nothing locked yet -> lock onto the closest person.
    if (!this.last) {
      if (cands.length === 0) return { target: null, held: false, lost: true };
      this.last = StickyTargetTracker.pickClosest(cands);
      this.lastSeenMs = nowMs;
      return { target: this.last, held: false, lost: false };
    }

    // 2) Try to match the locked person (nearest candidate inside the gate).
    //    Gate grows with the person's scale so a close person can move faster.
    const gate = Math.max(this.opts.gateRadius, this.last.scale * 2.0);
    let match: PersonCandidate | null = null;
    let bestD = Infinity;
    for (const c of cands) {
      const d = StickyTargetTracker.dist(c, this.last);
      if (d < gate && d < bestD) {
        bestD = d;
        match = c;
      }
    }
    if (match) {
      this.last = match;
      this.lastSeenMs = nowMs;
      return { target: match, held: false, lost: false };
    }

    // 3) Locked person missing -> hold position during grace period.
    if (nowMs - this.lastSeenMs <= this.opts.graceMs) {
      return { target: this.last, held: true, lost: false };
    }

    // 4) Grace expired -> hand over to someone else (if present) else lost.
    if (cands.length > 0) {
      this.last = StickyTargetTracker.pickClosest(cands);
      this.lastSeenMs = nowMs;
      return { target: this.last, held: false, lost: false };
    }
    this.last = null;
    return { target: null, held: false, lost: true };
  }

  /**
   * Manual handover ("Switch Target" button / tray). Picks the nearest candidate
   * that is NOT the current lock (sorted left→right as tie-break). Returns true if switched.
   */
  switchTarget(cands: PersonCandidate[], nowMs: number): boolean {
    if (!this.last || cands.length < 2) return false;
    const current = this.last;
    const currentIdx = cands.reduce(
      (bi, c, i) =>
        StickyTargetTracker.dist(c, current) < StickyTargetTracker.dist(cands[bi], current) ? i : bi,
      0
    );
    const next = cands.filter((_, i) => i !== currentIdx);
    if (next.length === 0) return false;
    this.last = next.sort(
      (a, b) => StickyTargetTracker.dist(a, current) - StickyTargetTracker.dist(b, current)
    )[0];
    this.lastSeenMs = nowMs;
    return true;
  }
}
