import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Crosshair, Eye, Maximize2, Minimize2, SlidersHorizontal, Users } from 'lucide-react';
import './spatialCapsule.css';
import type { RoxyTrackMode, RoxyTrackStatus } from '../hooks/useRoxyTracking';

/** Seconds of no mouse movement before the capsule shrinks to the grabber bar. */
export const CAPSULE_IDLE_MS = 2500;
const COMPACT_HEIGHT = 56;

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
  testId?: string;
}

/** visionOS fluid slider: invisible native range input on top of a white pill fill. */
const GlassSlider: React.FC<SliderProps> = ({ label, value, min, max, step, display, onChange, testId }) => {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="vcap-slider-label">
        <span>{label}</span>
        <span>{display}</span>
      </div>
      <div className="vslider">
        <div className="vslider-fill" style={{ width: `${Math.max(pct, 8)}%` }} />
        <input
          type="range"
          aria-label={label}
          data-testid={testId}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
};

export interface SpatialCapsuleProps {
  /** Calibration (or any full-screen takeover) is active: hide EVERYTHING. */
  hidden: boolean;
  trackMode: RoxyTrackMode;
  onTrackMode: (m: RoxyTrackMode) => void;
  webcamActive: boolean;
  webcamStarting: boolean;
  onToggleWebcam: () => void;
  onCenterHere: () => void;
  onCalibrate: () => void;
  onSwitchTarget: () => void;
  peopleCount: number;
  trackStatus: RoxyTrackStatus;
  statusNote: string | null;
  windIntensity: number;
  onWind: (v: number) => void;
  eyelidFollow: number;
  onEyelid: (v: number) => void;
  fitMode: 'cover' | 'contain';
  onFit: () => void;
  onBlink: () => void;
  webcamError: string | null;
  irisStyle?: 'classic' | 'focused';
  onIrisStyle?: (style: 'classic' | 'focused') => void;
  bgmEnabled?: boolean;
  onToggleBgm?: (enabled: boolean) => void;
  bgmVolume?: number;
  onChangeBgmVolume?: (vol: number) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const STATUS_TEXT: Record<RoxyTrackStatus, string> = {
  off: 'Camera off · following your cursor',
  searching: 'Looking for you…',
  face: 'Following you',
  body: 'Following you (body)',
  holding: 'Holding your last position',
};

export const SpatialCapsule: React.FC<SpatialCapsuleProps> = (p) => {
  const [expanded, setExpanded] = useState(false);
  const [idle, setIdle] = useState(false);
  const [wake, setWake] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(260);
  const idleTimerRef = useRef<number>(0);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const capsuleRef = useRef<HTMLDivElement | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const idleRef = useRef(idle);
  idleRef.current = idle;

  const armIdleTimer = useCallback(() => {
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      if (!expandedRef.current) setIdle(true);
    }, CAPSULE_IDLE_MS);
  }, []);

  const wakeUp = useCallback(() => {
    if (idleRef.current) {
      setIdle(false);
      setWake(true);
      window.setTimeout(() => setWake(false), 750);
    }
    armIdleTimer();
  }, [armIdleTimer]);

  // Auto-hide: any mouse movement re-arms the timer; moving near the bottom wakes it.
  useEffect(() => {
    armIdleTimer();
    const onMove = (e: MouseEvent) => {
      const nearBottom = e.clientY > window.innerHeight - 170;
      if (idleRef.current) {
        if (nearBottom) wakeUp();
      } else {
        armIdleTimer();
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.clearTimeout(idleTimerRef.current);
    };
  }, [armIdleTimer, wakeUp]);

  // Measure natural content height so the capsule can spring between fixed heights.
  useLayoutEffect(() => {
    if (expanded && innerRef.current) {
      setExpandedHeight(innerRef.current.offsetHeight);
    }
  }, [expanded, p.webcamError, p.statusNote, p.trackStatus, p.bgmEnabled]);

  // Escape / click outside collapses the expanded panel.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    const onDown = (e: MouseEvent) => {
      if (capsuleRef.current && !capsuleRef.current.contains(e.target as Node)) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [expanded]);

  // Re-arm the idle timer when the panel closes.
  useEffect(() => {
    if (!expanded) armIdleTimer();
  }, [expanded, armIdleTimer]);

  const height = expanded ? expandedHeight : COMPACT_HEIGHT;
  const statusLine = p.webcamError
    ? p.webcamError
    : p.statusNote || (p.webcamActive ? STATUS_TEXT[p.trackStatus] : STATUS_TEXT.off);

  const cls = ['vcap', expanded ? 'vcap--expanded' : '', idle ? 'vcap--idle' : '', wake ? 'vcap--wake' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className="vcap-root" data-hidden={p.hidden ? 'true' : 'false'} data-testid="live-wallpaper-hud">
      <div
        ref={capsuleRef}
        className={cls}
        style={{ height }}
        onMouseEnter={wakeUp}
        onClick={() => idle && wakeUp()}
        data-state={idle ? 'idle' : expanded ? 'expanded' : 'compact'}
        data-testid="spatial-capsule"
      >
        <div className="vcap-inner" ref={innerRef}>
          {/* Expanded settings (grows upward because the capsule is bottom-anchored) */}
          <div className="vcap-panel" data-testid="advanced-tuning-panel">
            <GlassSlider
              label="Wind"
              value={p.windIntensity}
              min={0}
              max={2}
              step={0.05}
              display={`${Math.round(p.windIntensity * 100)}%`}
              onChange={p.onWind}
              testId="wind-slider"
            />
            <GlassSlider
              label="Eyelid follow"
              value={p.eyelidFollow}
              min={0}
              max={1.8}
              step={0.05}
              display={`${Math.round((p.eyelidFollow / 1.8) * 100)}%`}
              onChange={p.onEyelid}
              testId="eyelid-slider"
            />
            {/* Iris Style Selector: Classic (Set 1) vs Focused (Set 2) */}
            <div className="vcap-iris-row">
              <div className="vcap-slider-label">
                <span>Iris Style</span>
                <span>{p.irisStyle === 'focused' ? 'Focused (Set 2)' : 'Classic (Set 1)'}</span>
              </div>
              <div
                className="vseg vseg--iris"
                data-active={p.irisStyle === 'focused' ? '1' : '0'}
                role="group"
                aria-label="Iris Style"
              >
                <div className="vseg-indicator" />
                <button
                  type="button"
                  aria-pressed={p.irisStyle !== 'focused'}
                  onClick={() => p.onIrisStyle?.('classic')}
                  data-testid="iris-classic-btn"
                  title="Original classic iris"
                >
                  Classic
                </button>
                <button
                  type="button"
                  aria-pressed={p.irisStyle === 'focused'}
                  onClick={() => p.onIrisStyle?.('focused')}
                  data-testid="iris-focused-btn"
                  title="Focused pupil iris with direct eye contact"
                >
                  Focused
                </button>
              </div>
            </div>
            {/* Ambient Music Row (1-hour ambient loop, off by default, starts at random point) */}
            <div className="vcap-bgm-row">
              <div className="vcap-slider-label">
                <span>Ambient Music</span>
                <span>{p.bgmEnabled ? "don't think about it anymore" : 'Disabled'}</span>
              </div>
              <div
                className="vseg vseg--bgm"
                data-active={p.bgmEnabled ? '1' : '0'}
                role="group"
                aria-label="Ambient Music"
              >
                <div className="vseg-indicator" />
                <button
                  type="button"
                  aria-pressed={!p.bgmEnabled}
                  onClick={() => p.onToggleBgm?.(false)}
                  data-testid="bgm-off-btn"
                  title="Ambient music off"
                >
                  Off
                </button>
                <button
                  type="button"
                  aria-pressed={!!p.bgmEnabled}
                  onClick={() => p.onToggleBgm?.(true)}
                  data-testid="bgm-on-btn"
                  title="Play ambient music (random start)"
                >
                  On
                </button>
              </div>
            </div>
            {p.bgmEnabled && (
              <GlassSlider
                label="Music volume"
                value={p.bgmVolume ?? 0.4}
                min={0}
                max={1}
                step={0.05}
                display={`${Math.round((p.bgmVolume ?? 0.4) * 100)}%`}
                onChange={(v) => p.onChangeBgmVolume?.(v)}
                testId="bgm-volume-slider"
              />
            )}
            <div className="vcap-actions">
              <button type="button" className="vcap-chip" onClick={p.onCalibrate} data-testid="open-calibration-btn">
                <Crosshair size={14} /> Calibrate
              </button>
              <button
                type="button"
                className="vcap-chip"
                onClick={p.onSwitchTarget}
                disabled={p.peopleCount < 2}
                data-testid="switch-target-btn"
              >
                <Users size={14} /> Switch{p.peopleCount > 1 ? ` · ${p.peopleCount}` : ''}
              </button>
              <button type="button" className="vcap-chip" onClick={p.onBlink} data-testid="trigger-blink-btn">
                <Eye size={14} /> Blink
              </button>
              <button type="button" className="vcap-chip" onClick={p.onFit} data-testid="fit-toggle-btn">
                {p.fitMode === 'cover' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                {p.fitMode === 'cover' ? 'Fill' : 'Fit'}
              </button>
              {p.onToggleFullscreen && (
                <button
                  type="button"
                  className="vcap-chip"
                  onClick={p.onToggleFullscreen}
                  data-testid="fullscreen-toggle-btn"
                  title="Toggle Fullscreen (F)"
                >
                  {p.isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  {p.isFullscreen ? 'Window' : 'Full'}
                </button>
              )}
            </div>
            <div className="vcap-status" data-testid="capsule-status">
              {statusLine}
            </div>
          </div>

          {/* Compact pill row */}
          <div className="vcap-row">
            <div className="vseg" data-active={p.trackMode === 'gaze' ? '1' : '0'} role="group" aria-label="Tracking mode">
              <div className="vseg-indicator" />
              <button
                type="button"
                aria-pressed={p.trackMode === 'person'}
                onClick={() => p.onTrackMode('person')}
                data-testid="mode-person-btn"
                title="Follow where you are in the room"
              >
                Person
              </button>
              <button
                type="button"
                aria-pressed={p.trackMode === 'gaze'}
                onClick={() => p.onTrackMode('gaze')}
                data-testid="mode-gaze-btn"
                title="Follow where you are looking (desk use)"
              >
                Gaze
              </button>
            </div>
            <div className="vcap-divider" />
            <button
              type="button"
              className="vcap-icon-btn"
              data-on={p.webcamActive}
              disabled={p.webcamStarting}
              onClick={p.onToggleWebcam}
              data-testid="webcam-toggle-btn"
              title={p.webcamActive ? 'Turn camera off' : 'Turn camera on'}
              aria-label="Camera"
            >
              {p.webcamActive ? <Camera size={17} /> : <CameraOff size={17} />}
            </button>
            <button
              type="button"
              className="vcap-icon-btn"
              onClick={p.onCenterHere}
              data-testid="center-here-btn"
              title="Look at Roxy's eyes, then click (C)"
            >
              <Crosshair size={17} />
              <span>Center</span>
            </button>
            <button
              type="button"
              className="vcap-icon-btn"
              data-on={expanded}
              onClick={() => setExpanded((v) => !v)}
              data-testid="toggle-advanced-btn"
              title="Settings"
              aria-label="Settings"
            >
              <SlidersHorizontal size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
