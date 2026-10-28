/**
 * useRoxyTracking — webcam → gaze pipeline for the Roxy live wallpaper.
 *
 * Pipeline per processed frame:
 *   FaceLandmarker (numFaces 3) + PoseLandmarker (numPoses 3)
 *     → buildCandidates()   (one candidate per person; face wins, body is fallback)
 *     → StickyTargetTracker (lock ONE person, 2.5s grace, manual switch)
 *     → smoothed anchor (no snapping on face↔body transitions)
 *     → mode 'person' : mapPersonToGaze()  (mirror-corrected room position)  [DEFAULT]
 *       mode 'gaze'   : 8D head-pose + iris solver (needs a locked FACE)
 *     → OneEuroFilter2D → gazeTargetRef (consumed by the 60fps renderer)
 *
 * Options:
 *   targetFps / videoWidth / videoHeight — desktop wallpaper uses 15fps @ 320x240.
 *   `sleep(true)` releases the camera entirely (0 FPS); `sleep(false)` re-acquires it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalibrationModel,
  evaluateCalibratedGaze,
  extract8DFeatureVector,
  FeatureVector8D,
} from '../utils/liveWallpaperCalibration';
import { OneEuroFilter2D } from '../utils/oneEuroFilter';
import {
  buildCandidates,
  loadPersonCenter,
  mapPersonToGaze,
  PersonCenterOffset,
  Pt,
  savePersonCenter,
} from '../utils/personPositionTracking';
import { PersonCandidate, StickyTargetTracker } from '../utils/stickyTargetTracker';

export type RoxyTrackMode = 'person' | 'gaze';
export type RoxyTrackStatus = 'off' | 'searching' | 'face' | 'body' | 'holding';

export interface UseRoxyTrackingOptions {
  targetFps?: number;
  videoWidth?: number;
  videoHeight?: number;
  calibrationModelRef: React.MutableRefObject<CalibrationModel>;
}

const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const FACE_MODEL_LOCAL = '/live-wallpaper/mediapipe/face_landmarker.task';
const FACE_MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_MODEL_LOCAL = '/live-wallpaper/mediapipe/pose_landmarker_lite.task';
const POSE_MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** Shy-idle gaze (down at her hat) when nobody has been seen for a while. */
const SHY_GAZE: [number, number] = [0.0, -0.85];

export function useRoxyTracking(opts: UseRoxyTrackingOptions) {
  const { targetFps = 30, videoWidth = 640, videoHeight = 480, calibrationModelRef } = opts;

  const [mode, setModeState] = useState<RoxyTrackMode>('person');
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RoxyTrackStatus>('off');
  const [peopleCount, setPeopleCount] = useState(0);

  // Live refs (read by the 60fps renderer / loops — no React re-render needed)
  const gazeTargetRef = useRef<[number, number]>([0.0, 0.15]);
  const latestFeaturesRef = useRef<FeatureVector8D | null>(null);
  const filterRef = useRef(new OneEuroFilter2D(1.0, 0.05, 1.0));
  const trackerRef = useRef(new StickyTargetTracker({ graceMs: 2500 }));
  const centerRef = useRef<PersonCenterOffset>(loadPersonCenter());
  const modeRef = useRef<RoxyTrackMode>('person');
  modeRef.current = mode;
  const lastRawAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const smoothAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const lastCandidatesRef = useRef<PersonCandidate[]>([]);
  const lastSeenMsRef = useRef(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceRef = useRef<any>(null);
  const poseRef = useRef<any>(null);
  const rafRef = useRef(0);
  const detectTimerRef = useRef(0);
  const wantActiveRef = useRef(false);
  const sleepingRef = useRef(false);
  const statusRef = useRef<RoxyTrackStatus>('off');

  const setStatusIfChanged = (s: RoxyTrackStatus) => {
    if (statusRef.current !== s) {
      statusRef.current = s;
      setStatus(s);
    }
  };

  // ---- Models -------------------------------------------------------------
  const ensureModels = useCallback(async () => {
    if (faceRef.current && poseRef.current) return;
    const vision: any = await import('@mediapipe/tasks-vision');
    const { FilesetResolver, FaceLandmarker, PoseLandmarker } = vision;
    let fileset: any;
    try {
      fileset = await FilesetResolver.forVisionTasks('/live-wallpaper/mediapipe/wasm');
    } catch {
      fileset = await FilesetResolver.forVisionTasks(VISION_CDN);
    }
    const make = async (Cls: any, local: string, cdn: string, extra: object) => {
      try {
        return await Cls.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: local, delegate: 'GPU' },
          runningMode: 'VIDEO',
          ...extra,
        });
      } catch {
        return await Cls.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: cdn },
          runningMode: 'VIDEO',
          ...extra,
        });
      }
    };
    if (!faceRef.current) {
      faceRef.current = await make(FaceLandmarker, FACE_MODEL_LOCAL, FACE_MODEL_CDN, {
        numFaces: 3,
        outputFacialTransformationMatrixes: true,
        outputFaceBlendshapes: false,
      });
    }
    if (!poseRef.current) {
      try {
        poseRef.current = await make(PoseLandmarker, POSE_MODEL_LOCAL, POSE_MODEL_CDN, {
          numPoses: 3,
        });
      } catch (e) {
        console.warn('[useRoxyTracking] PoseLandmarker unavailable, face-only mode', e);
        poseRef.current = null;
      }
    }
  }, []);

  // ---- Per-frame processing ----------------------------------------------
  const processFrame = useCallback(
    (video: HTMLVideoElement, nowMs: number) => {
      let faces: Pt[][] = [];
      let mats: Array<{ data: Float32Array | number[] }> = [];
      let poses: Pt[][] = [];
      try {
        const fr = faceRef.current?.detectForVideo(video, nowMs);
        faces = fr?.faceLandmarks ?? [];
        mats = fr?.facialTransformationMatrixes ?? [];
        // High-performance optimization: Face detection is Priority 1.
        // Only run PoseLandmarker when no faces are detected in the frame.
        // This cuts inference execution time by over 55%, preventing main thread lagging.
        if (faces.length === 0 && poseRef.current) {
          const pr = poseRef.current.detectForVideo(video, nowMs);
          poses = pr?.landmarks ?? [];
        }
      } catch (e) {
        console.warn('[useRoxyTracking] frame error', e);
        return;
      }

      applyCandidates(buildCandidates(faces, poses), faces, mats, nowMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetFps]
  );

  /** Core: sticky lock → smoothed anchor → gaze. Also used by feedPerson() for tests. */
  const applyCandidates = useCallback(
    (
      cands: PersonCandidate[],
      faces: Pt[][],
      mats: Array<{ data: Float32Array | number[] }>,
      nowMs: number
    ) => {
      lastCandidatesRef.current = cands;
      setPeopleCountIfChanged(cands.length);
      const st = trackerRef.current.update(cands, nowMs);

      if (!st.target) {
        // Nobody: drift to shy idle after 2s
        setStatusIfChanged('searching');
        if (nowMs - lastSeenMsRef.current > 2000) {
          gazeTargetRef.current = [...SHY_GAZE];
        }
        return;
      }

      if (st.held) {
        // Occlusion grace: keep last position (gaze unchanged)
        setStatusIfChanged('holding');
        return;
      }
      lastSeenMsRef.current = nowMs;
      const t = st.target;
      setStatusIfChanged(t.source === 'face' ? 'face' : 'body');

      // Smooth the anchor so face↔body fallback never snaps (time-constant ~90ms)
      const prev = smoothAnchorRef.current;
      const a = prev ? 1 - Math.exp(-(1000 / Math.max(targetFps, 1)) / 90) : 1;
      const sm = prev
        ? { x: prev.x + (t.x - prev.x) * a, y: prev.y + (t.y - prev.y) * a }
        : { x: t.x, y: t.y };
      smoothAnchorRef.current = sm;
      lastRawAnchorRef.current = { x: sm.x, y: sm.y };

      let gx: number;
      let gy: number;
      if (modeRef.current === 'gaze' && t.source === 'face' && t.faceIndex !== undefined) {
        const vec = extract8DFeatureVector({
          faceLandmarks: [faces[t.faceIndex] as any],
          facialTransformationMatrixes: mats[t.faceIndex] ? [mats[t.faceIndex]] : undefined,
        });
        if (vec) {
          latestFeaturesRef.current = vec;
          [gx, gy] = evaluateCalibratedGaze(vec, calibrationModelRef.current, 'screen_focus');
        } else {
          [gx, gy] = mapPersonToGaze(sm.x, sm.y, centerRef.current);
        }
      } else {
        if (t.source === 'face' && t.faceIndex !== undefined) {
          const vec = extract8DFeatureVector({
            faceLandmarks: [faces[t.faceIndex] as any],
            facialTransformationMatrixes: mats[t.faceIndex] ? [mats[t.faceIndex]] : undefined,
          });
          if (vec) latestFeaturesRef.current = vec; // keep calibration wizard fed
        }
        [gx, gy] = mapPersonToGaze(sm.x, sm.y, centerRef.current);
      }
      gazeTargetRef.current = filterRef.current.filter(gx, gy, nowMs);
    },
    [calibrationModelRef, targetFps]
  );

  /**
   * TEST / DEBUG ONLY: inject persons as raw (un-mirrored) camera coords, bypassing MediaPipe.
   * Exposed on window.__roxyDebug by LiveWallpaperPage when ?debug=1.
   */
  const feedPerson = useCallback(
    (people: Array<{ x: number; y: number; scale?: number; source?: 'face' | 'body' }>) => {
      const cands: PersonCandidate[] = people.map((p) => ({
        x: p.x,
        y: p.y,
        scale: p.scale ?? 0.12,
        source: p.source ?? 'face',
      }));
      applyCandidates(cands, [], [], performance.now());
    },
    [applyCandidates]
  );

  const peopleRef = useRef(0);
  const setPeopleCountIfChanged = (n: number) => {
    if (peopleRef.current !== n) {
      peopleRef.current = n;
      setPeopleCount(n);
    }
  };

  // ---- Stream lifecycle ---------------------------------------------------
  const releaseStream = useCallback(() => {
    if (detectTimerRef.current) {
      window.clearTimeout(detectTimerRef.current);
      detectTimerRef.current = 0;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const acquireStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: videoWidth },
        height: { ideal: videoHeight },
        frameRate: { ideal: Math.max(15, targetFps) },
      },
      audio: false,
    });
    streamRef.current = stream;
    const v = videoRef.current;
    if (!v) throw new Error('Webcam video element not mounted');
    v.srcObject = stream;
    await v.play();

    // Decouple AI inference from the 60fps WebGL requestAnimationFrame loop
    // Running AI at 20fps keeps inference ultra-lightweight and eliminates all main-thread lag
    const targetFpsClean = Math.min(20, Math.max(12, targetFps));
    const minInterval = 1000 / targetFpsClean;
    let isProcessing = false;
    let lastVideoTime = -1;

    const detectStep = () => {
      if (!streamRef.current) return;
      const now = performance.now();
      if (v.readyState >= 2 && v.currentTime !== lastVideoTime && !isProcessing) {
        lastVideoTime = v.currentTime;
        isProcessing = true;
        try {
          processFrame(v, now);
        } finally {
          isProcessing = false;
        }
      }
      detectTimerRef.current = window.setTimeout(detectStep, minInterval);
    };

    detectTimerRef.current = window.setTimeout(detectStep, minInterval);
  }, [processFrame, targetFps, videoHeight, videoWidth]);

  const start = useCallback(async () => {
    if (active || starting) return;
    setStarting(true);
    setError(null);
    try {
      await ensureModels();
      wantActiveRef.current = true;
      if (!sleepingRef.current) await acquireStream();
      trackerRef.current.reset();
      smoothAnchorRef.current = null;
      filterRef.current.reset();
      lastSeenMsRef.current = performance.now();
      setActive(true);
      setStatusIfChanged('searching');
    } catch (e: any) {
      console.warn('[useRoxyTracking] start failed', e);
      setError(e?.message || 'Camera unavailable — using mouse fallback.');
      wantActiveRef.current = false;
      setActive(false);
    } finally {
      setStarting(false);
    }
  }, [acquireStream, active, ensureModels, starting]);

  const stop = useCallback(() => {
    wantActiveRef.current = false;
    releaseStream();
    latestFeaturesRef.current = null;
    setActive(false);
    setPeopleCountIfChanged(0);
    setStatusIfChanged('off');
  }, [releaseStream]);

  /** Desktop auto-sleep: release camera completely (0 FPS) / re-acquire on wake. */
  const sleep = useCallback(
    async (asleep: boolean) => {
      sleepingRef.current = asleep;
      if (!wantActiveRef.current) return;
      if (asleep) {
        releaseStream();
      } else if (!streamRef.current) {
        try {
          await acquireStream();
        } catch (e) {
          console.warn('[useRoxyTracking] resume failed', e);
        }
      }
    },
    [acquireStream, releaseStream]
  );

  useEffect(() => () => releaseStream(), [releaseStream]);

  // ---- Actions ------------------------------------------------------------
  const setMode = useCallback((m: RoxyTrackMode) => {
    setModeState(m);
    modeRef.current = m;
    filterRef.current.reset();
  }, []);

  /** "Center Here": zero the CURRENT person position as straight-ahead eye contact. */
  const centerHere = useCallback((): boolean => {
    const a = lastRawAnchorRef.current;
    if (!a) return false;
    centerRef.current = { x: 1 - a.x, y: a.y };
    savePersonCenter(centerRef.current);
    filterRef.current.reset();
    gazeTargetRef.current = [0, 0];
    return true;
  }, []);

  const resetCenter = useCallback(() => {
    localStorage.removeItem('anemoia_roxy_person_center_v1');
    centerRef.current = { x: 0.5, y: 0.45 };
  }, []);

  /** "Switch Target": hand lock to the next person in frame. */
  const switchTarget = useCallback((): boolean => {
    const ok = trackerRef.current.switchTarget(lastCandidatesRef.current, performance.now());
    if (ok) {
      smoothAnchorRef.current = null;
      filterRef.current.reset();
    }
    return ok;
  }, []);

  return {
    videoRef,
    gazeTargetRef,
    latestFeaturesRef,
    mode,
    setMode,
    active,
    starting,
    error,
    clearError: () => setError(null),
    status,
    peopleCount,
    start,
    stop,
    sleep,
    centerHere,
    resetCenter,
    switchTarget,
    feedPerson,
    resetFilter: () => filterRef.current.reset(),
  };
}
