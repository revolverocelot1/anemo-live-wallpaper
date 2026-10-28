/**
 * Person-position tracking helpers (pure logic).
 *
 * Mode A ("person"): gaze follows WHERE the person is in the camera FOV.
 *   - Raw webcam frames are NOT mirrored, so the user's physical left appears on the
 *     RIGHT of the raw image. We mirror: x_mirrored = 1 - x_raw.
 *   - gazeX < 0 means Roxy looks to screen-left == the user's physical left. Never invert!
 *   - gazeY > 0 means looking UP.
 */
import type { PersonCandidate } from './stickyTargetTracker';

export interface Pt {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** Normalized offset (from the zero point) that maps to full gaze deflection (±1). */
export const PERSON_GAIN_X = 0.3;
export const PERSON_GAIN_Y = 0.26;

/** Zero point = where the person stands when looking straight at Roxy ("Center Here"). */
export interface PersonCenterOffset {
  /** mirrored x of the zero point */
  x: number;
  y: number;
}
export const DEFAULT_PERSON_CENTER: PersonCenterOffset = { x: 0.5, y: 0.45 };
export const PERSON_CENTER_STORAGE_KEY = 'anemoia_roxy_person_center_v1';

export const mirrorX = (xRaw: number): number => 1 - xRaw;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Map a raw (un-mirrored) camera-space anchor to gaze in [-1,1]². */
export function mapPersonToGaze(
  xRaw: number,
  yRaw: number,
  center: PersonCenterOffset = DEFAULT_PERSON_CENTER
): [number, number] {
  const xm = mirrorX(xRaw);
  const gx = (xm - center.x) / PERSON_GAIN_X;
  const gy = (center.y - yRaw) / PERSON_GAIN_Y; // image y grows downward; +gy = up
  return [clamp(gx, -1, 1), clamp(gy, -1, 1)];
}

/** Head anchor from upper-body pose (landmarks 11/12 shoulders, 0 nose). */
export function bodyAnchorFromPose(pose: Pt[]): PersonCandidate | null {
  const ls = pose[11];
  const rs = pose[12];
  if (!ls || !rs) return null;
  const vis = Math.min(ls.visibility ?? 1, rs.visibility ?? 1);
  if (vis < 0.35) return null;
  const mx = (ls.x + rs.x) / 2;
  const my = (ls.y + rs.y) / 2;
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  // Neck vector: head centre sits ~0.9 shoulder-widths above the shoulder midpoint.
  const nose = pose[0];
  let hx = mx;
  let hy = my - shoulderW * 0.9;
  if (nose && (nose.visibility ?? 1) > 0.5) {
    hx = nose.x;
    hy = nose.y;
  }
  return { x: hx, y: hy, scale: shoulderW / 2.5, source: 'body' };
}

/** Face anchor: nose tip (landmark 1) + head width from cheek landmarks (234/454). */
export function faceAnchor(face: Pt[], faceIndex: number): PersonCandidate | null {
  const nose = face[1];
  if (!nose) return null;
  const l = face[234];
  const r = face[454];
  const w = l && r ? Math.hypot(l.x - r.x, l.y - r.y) : 0.12;
  return { x: nose.x, y: nose.y, scale: w, source: 'face', faceIndex };
}

/**
 * Merge face + pose detections into one candidate per person.
 * A pose whose head anchor lies within ~1.2 head widths of a face is the same person
 * -> face wins (Priority 1). Unmatched poses become body-fallback candidates (Priority 2).
 */
export function buildCandidates(faces: Pt[][], poses: Pt[][]): PersonCandidate[] {
  const out: PersonCandidate[] = [];
  faces.forEach((f, i) => {
    const c = faceAnchor(f, i);
    if (c) out.push(c);
  });
  const faceCount = out.length;
  for (const p of poses) {
    const b = bodyAnchorFromPose(p);
    if (!b) continue;
    let dup = false;
    for (let i = 0; i < faceCount; i++) {
      const f = out[i];
      const gate = Math.max(f.scale, b.scale) * 1.6 + 0.04;
      if (Math.hypot(f.x - b.x, f.y - b.y) < gate) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push(b);
  }
  return out;
}

export function loadPersonCenter(): PersonCenterOffset {
  try {
    const raw = localStorage.getItem(PERSON_CENTER_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') return p;
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PERSON_CENTER };
}

export function savePersonCenter(c: PersonCenterOffset): void {
  try {
    localStorage.setItem(PERSON_CENTER_STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
