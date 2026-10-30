/**
 * Roxy 2.5D AI Live Wallpaper — page shell.
 *
 * Layout rules (see HANDOFF in desktop-wallpaper/README.md):
 *  - NOTHING lives in the top corners.
 *  - All controls live in ONE bottom-centred visionOS glass capsule (<SpatialCapsule/>).
 *  - While calibrating, every HUD element is hidden (`hudHidden`) and the wizard is z-index 2147483647.
 *  - `?desktop=1` (native wallpaper host): no capsule at all, 15fps/320x240 tracking,
 *    controlled through host messages (see handleHostMessage).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LiveWallpaperRenderer, RigConfig } from './components/LiveWallpaperRenderer';
import { CalibrationWizardModal } from './components/CalibrationWizardModal';
import { SpatialCapsule } from './components/SpatialCapsule';
import { FALLBACK_RIG_CONFIG } from './components/fallbackRigConfig';
import {
  CalibrationModel,
  clearCalibrationFromStorage,
  createDefaultCalibration,
  createDefaultCenteredLaptopCalibration,
  loadCalibrationFromStorage,
  saveCalibrationToStorage,
} from './utils/liveWallpaperCalibration';
import { OneEuroFilter2D } from './utils/oneEuroFilter';
import { RoxyTrackMode, useRoxyTracking } from './hooks/useRoxyTracking';

const App: React.FC = () => {
  const isDesktopHost = useMemo(() => new URLSearchParams(window.location.search).get('desktop') === '1', []);

  const [rigConfig, setRigConfig] = useState<RigConfig>(FALLBACK_RIG_CONFIG);
  const [calibrationModel, setCalibrationModel] = useState<CalibrationModel>(
    () => loadCalibrationFromStorage('laptop_centered') || createDefaultCenteredLaptopCalibration()
  );
  const calibrationModelRef = useRef<CalibrationModel>(calibrationModel);
  calibrationModelRef.current = calibrationModel;

  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  const [windIntensity, setWindIntensity] = useState(1.0);
  const [eyelidFollowScale, setEyelidFollowScale] = useState(1.0);
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');
  const [manualBlinkCounter, setManualBlinkCounter] = useState(0);
  const [paused, setPaused] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const noteTimerRef = useRef(0);

  const flashNote = useCallback((msg: string) => {
    setStatusNote(msg);
    window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => setStatusNote(null), 2200);
  }, []);

  // Fullscreen browser state
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
    }
  }, []);

  // Iris style: Classic (Set 1, default) vs Focused (Set 2, small pupil & catchlight)
  const [irisStyle, setIrisStyle] = useState<'classic' | 'focused'>(() => {
    try {
      const saved = localStorage.getItem('anemoia_roxy_iris_style');
      if (saved === 'classic' || saved === 'focused') return saved;
    } catch {}
    return 'classic';
  });

  const handleIrisStyleChange = useCallback((style: 'classic' | 'focused') => {
    setIrisStyle(style);
    try {
      localStorage.setItem('anemoia_roxy_iris_style', style);
    } catch {}
    flashNote(style === 'focused' ? 'Iris: Focused (Set 2)' : 'Iris: Classic (Set 1)');
  }, [flashNote]);

  // Ambient Music (BGM) state — OFF by default
  const [bgmEnabled, setBgmEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('anemoia_roxy_bgm_enabled') === '1';
    } catch {
      return false;
    }
  });

  const [bgmVolume, setBgmVolume] = useState<number>(() => {
    try {
      const v = localStorage.getItem('anemoia_roxy_bgm_volume');
      if (v !== null) {
        const parsed = parseFloat(v);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
      }
    } catch {}
    return 0.4;
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio('/live-wallpaper/bgm.mp3');
    audio.loop = true;
    audio.volume = bgmVolume;
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  const handleBgmVolumeChange = useCallback((vol: number) => {
    setBgmVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, vol));
    }
    try {
      localStorage.setItem('anemoia_roxy_bgm_volume', vol.toString());
    } catch {}
  }, []);

  const handleToggleBgm = useCallback((targetEnabled?: boolean) => {
    setBgmEnabled((prev) => {
      const next = typeof targetEnabled === 'boolean' ? targetEnabled : !prev;
      try {
        localStorage.setItem('anemoia_roxy_bgm_enabled', next ? '1' : '0');
      } catch {}

      const audio = audioRef.current;
      if (audio) {
        if (next) {
          // USER REQUIREMENT: Start from a RANDOM POINT of the ~1-hour music, and loop if it ends
          const startPlayback = () => {
            const dur = audio.duration;
            if (dur && !isNaN(dur) && dur > 10) {
              audio.currentTime = Math.random() * (dur - 10);
            } else {
              audio.currentTime = Math.random() * 3500;
            }
            audio.play().catch((err) => console.warn('BGM play failed:', err));
          };

          if (audio.readyState >= 1) {
            startPlayback();
          } else {
            audio.addEventListener('loadedmetadata', startPlayback, { once: true });
            audio.load();
          }
          flashNote('Ambient Music: Playing (random start)');
        } else {
          audio.pause();
          flashNote('Ambient Music: Off');
        }
      }
      return next;
    });
  }, [flashNote]);

  // Pause BGM when wallpaper sleeps / pauses
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (paused) {
      audio.pause();
    } else if (bgmEnabled) {
      audio.play().catch(() => {});
    }
  }, [paused, bgmEnabled]);

  const tracking = useRoxyTracking({
    targetFps: isDesktopHost ? 15 : 30,
    videoWidth: isDesktopHost ? 320 : 640,
    videoHeight: isDesktopHost ? 240 : 480,
    calibrationModelRef,
  });
  const { gazeTargetRef, latestFeaturesRef, active: webcamActive } = tracking;

  // ---- rig config -----------------------------------------------------------
  const reloadRigConfig = useCallback(async () => {
    try {
      const res = await fetch(`/live-wallpaper/rig_config.json?t=${Date.now()}`);
      if (res.ok) {
        const data = (await res.json()) as RigConfig;
        if (data && data.leftEye && data.rightEye) {
          setRigConfig((prev) => (JSON.stringify(prev) === JSON.stringify(data) ? prev : data));
        }
      }
    } catch {
      /* fallback config already active */
    }
  }, []);
  useEffect(() => {
    reloadRigConfig();
  }, [reloadRigConfig]);

  // ---- hidden gaze readout for automated tests (no React re-render) ----------
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const [x, y] = gazeTargetRef.current;
      if (readoutRef.current) readoutRef.current.textContent = `Gaze (${x.toFixed(2)}, ${y.toFixed(2)})`;
    }, 120);
    return () => clearInterval(t);
  }, [gazeTargetRef]);

  // ---- mouse / touch fallback (webcam off) -------------------------------------
  const mouseFilterRef = useRef(new OneEuroFilter2D(1.15, 0.045, 1.0));
  const webcamActiveRef = useRef(webcamActive);
  webcamActiveRef.current = webcamActive;
  const debugFeedRef = useRef(false);
  const applyPointer = useCallback(
    (nx: number, ny: number) => {
      // nx, ny in [0,1] of the viewport/monitor
      if (webcamActiveRef.current || debugFeedRef.current) return;
      const eyeX = 0.5 * (rigConfig.leftEye.center[0] + rigConfig.rightEye.center[0]);
      const eyeY = 0.5 * (rigConfig.leftEye.center[1] + rigConfig.rightEye.center[1]);
      const rawX = Math.max(-1, Math.min(1, (nx - eyeX) / 0.36));
      const rawY = Math.max(-1, Math.min(1, (eyeY - ny) / 0.36)); // +Y = looking up
      gazeTargetRef.current = mouseFilterRef.current.filter(rawX, rawY, performance.now());
    },
    [gazeTargetRef, rigConfig]
  );
  useEffect(() => {
    const onMove = (e: MouseEvent) => applyPointer(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    const onTouch = (e: TouchEvent) => {
      if (e.touches[0]) applyPointer(e.touches[0].clientX / window.innerWidth, e.touches[0].clientY / window.innerHeight);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onTouch);
    };
  }, [applyPointer]);

  // ---- actions ----------------------------------------------------------------
  const toggleWebcam = useCallback(() => (webcamActive ? tracking.stop() : tracking.start()), [webcamActive, tracking]);

  const centerHere = useCallback(() => {
    if (!webcamActiveRef.current) {
      flashNote('Turn the camera on first');
      return;
    }
    flashNote(tracking.centerHere() ? 'Centered — that is now straight ahead' : 'I can not see you yet');
  }, [flashNote, tracking]);

  const switchTarget = useCallback(() => {
    flashNote(tracking.switchTarget() ? 'Now following someone else' : 'Only one person in view');
  }, [flashNote, tracking]);

  const setMode = useCallback((m: RoxyTrackMode) => tracking.setMode(m), [tracking]);

  const handleCalibrationComplete = (model: CalibrationModel) => {
    setCalibrationModel(model);
    saveCalibrationToStorage(model, 'laptop_centered');
    tracking.resetFilter();
  };
  const handleResetCalibration = () => {
    clearCalibrationFromStorage('laptop_centered');
    setCalibrationModel(createDefaultCalibration('laptop_centered'));
    tracking.resetFilter();
  };

  // Keyboard: C = Center Here, B = blink, F = fullscreen, Shift+C = full calibration
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCalibrationOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'c' && e.shiftKey) setIsCalibrationOpen(true);
      else if (k === 'c') centerHere();
      else if (k === 'b') setManualBlinkCounter((c) => c + 1);
      else if (k === 'f') toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCalibrationOpen, centerHere, toggleFullscreen]);

  // ---- native host (desktop-wallpaper/) messaging -------------------------------
  // Messages are JSON objects: {type:'cursor',x,y} (0..1 of monitor) | 'mode' value | 'center' |
  // 'calibrate' (3s countdown then center) | 'switchTarget' | 'pause' value | 'camera' value
  const handleHostMessage = useCallback(
    (msg: any) => {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'cursor':
          applyPointer(msg.x, msg.y);
          break;
        case 'mode': {
          const val = msg.value;
          if (val === 'mouse') {
            tracking.stop();
          } else if (val === 'gaze') {
            setMode('gaze');
            tracking.start();
          } else if (val === 'person') {
            setMode('person');
            tracking.start();
          }
          break;
        }
        case 'center':
          centerHere();
          break;
        case 'calibrate':
          window.setTimeout(centerHere, 3000);
          break;
        case 'switchTarget':
          switchTarget();
          break;
        case 'pause': {
          const asleep = !!msg.value;
          setPaused(asleep);
          tracking.sleep(asleep); // 0 FPS camera while asleep
          break;
        }
        case 'camera':
          msg.value ? tracking.start() : tracking.stop();
          break;
        case 'irisStyle':
          handleIrisStyleChange(msg.value === 'focused' ? 'focused' : 'classic');
          break;
        case 'music': {
          const enable = typeof msg.value === 'boolean' ? msg.value : !!msg.value;
          handleToggleBgm(enable);
          break;
        }
        case 'musicVolume': {
          const vol = parseFloat(msg.value);
          if (!isNaN(vol)) handleBgmVolumeChange(vol);
          break;
        }
        case 'eyelid': {
          const val = parseFloat(msg.value);
          if (!isNaN(val)) {
            setEyelidFollowScale(Math.max(0, Math.min(2, val)));
            flashNote(`Eyelid Follow: ${Math.round(val * 100)}%`);
          }
          break;
        }
      }
    },
    [
      applyPointer,
      centerHere,
      handleBgmVolumeChange,
      handleIrisStyleChange,
      handleToggleBgm,
      setMode,
      switchTarget,
      tracking,
      setEyelidFollowScale,
      flashNote,
    ]
  );
  const hostHandlerRef = useRef(handleHostMessage);
  hostHandlerRef.current = handleHostMessage;
  useEffect(() => {
    const wv = (window as any).chrome?.webview;
    const onWv = (e: any) => {
      try {
        hostHandlerRef.current(typeof e.data === 'string' ? JSON.parse(e.data) : e.data);
      } catch {
        /* ignore */
      }
    };
    const onWin = (e: MessageEvent) => hostHandlerRef.current(e.data);
    wv?.addEventListener('message', onWv);
    window.addEventListener('message', onWin);
    wv?.postMessage(JSON.stringify({ type: 'ready' }));
    return () => {
      wv?.removeEventListener('message', onWv);
      window.removeEventListener('message', onWin);
    };
  }, []);

  // ?debug=1 → window.__roxyDebug.feedPerson([{x,y,scale,source}]) for Puppeteer verification.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('debug') !== '1') return;
    (window as any).__roxyDebug = {
      feedPerson: (people: any[]) => {
        debugFeedRef.current = true; // suppresses the mouse fallback
        tracking.feedPerson(people);
      },
      centerHere: () => tracking.centerHere(),
      switchTarget: () => tracking.switchTarget(),
      openCalibration: () => setIsCalibrationOpen(true),
    };
    return () => {
      delete (window as any).__roxyDebug;
    };
  }, [tracking]);



  const eyeMidpointUv: [number, number] = [
    0.5 * (rigConfig.leftEye.center[0] + rigConfig.rightEye.center[0]),
    0.5 * (rigConfig.leftEye.center[1] + rigConfig.rightEye.center[1]),
  ];

  return (
    <div
      className="fixed top-0 left-0 w-screen h-screen bg-black overflow-hidden select-none z-20"
      data-testid="live-wallpaper-page"
      data-calibrating={isCalibrationOpen ? 'true' : 'false'}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#000000',
        userSelect: 'none',
        zIndex: 20,
        cursor: isDesktopHost ? 'none' : undefined,
      }}
    >
      {/* Hidden webcam feed for MediaPipe - strictly offscreen & invisible */}
      <video
        ref={tracking.videoRef}
        playsInline
        muted
        className="hidden"
        width={1}
        height={1}
        style={{
          display: 'none',
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      <LiveWallpaperRenderer
        rigConfig={rigConfig}
        gazeTargetRef={gazeTargetRef}
        windIntensity={windIntensity}
        eyelidFollowScale={eyelidFollowScale}
        fitMode={fitMode}
        manualBlinkCounter={manualBlinkCounter}
        paused={paused}
        irisStyle={irisStyle}
      />

      {/* Test-only gaze readout (never visible) */}
      <span ref={readoutRef} data-testid="gaze-readout" style={{ display: 'none' }} />

      {/* The ONE capsule. Not rendered at all in the desktop wallpaper host. */}
      {!isDesktopHost && (
        <SpatialCapsule
          hidden={isCalibrationOpen}
          trackMode={tracking.mode}
          onTrackMode={setMode}
          webcamActive={webcamActive}
          webcamStarting={tracking.starting}
          onToggleWebcam={toggleWebcam}
          onCenterHere={centerHere}
          onCalibrate={() => setIsCalibrationOpen(true)}
          onSwitchTarget={switchTarget}
          peopleCount={tracking.peopleCount}
          trackStatus={tracking.status}
          statusNote={statusNote}
          windIntensity={windIntensity}
          onWind={setWindIntensity}
          eyelidFollow={eyelidFollowScale}
          onEyelid={setEyelidFollowScale}
          fitMode={fitMode}
          onFit={() => setFitMode((f) => (f === 'cover' ? 'contain' : 'cover'))}
          onBlink={() => setManualBlinkCounter((c) => c + 1)}
          webcamError={tracking.error}
          irisStyle={irisStyle}
          onIrisStyle={handleIrisStyleChange}
          bgmEnabled={bgmEnabled}
          onToggleBgm={handleToggleBgm}
          bgmVolume={bgmVolume}
          onChangeBgmVolume={handleBgmVolumeChange}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      )}

      <CalibrationWizardModal
        isOpen={isCalibrationOpen}
        onClose={() => setIsCalibrationOpen(false)}
        latestFeaturesRef={latestFeaturesRef}
        webcamActive={webcamActive}
        onEnableWebcam={tracking.start}
        eyeMidpointUv={eyeMidpointUv}
        onCalibrationComplete={handleCalibrationComplete}
        onResetToDefault={handleResetCalibration}
      />
    </div>
  );
};

export default App;
