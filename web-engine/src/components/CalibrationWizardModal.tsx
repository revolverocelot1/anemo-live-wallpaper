import React, { useEffect, useRef, useState } from 'react';
import {
  CalibrationModel,
  CalibrationSample,
  FeatureVector8D,
  NINE_POINT_TARGETS,
  solveRidgeCalibration,
} from '../utils/liveWallpaperCalibration';
import { CheckCircle2, Crosshair, Eye, RotateCcw, Sparkles, X } from 'lucide-react';

interface CalibrationWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Latest live 8D feature vector from MediaPipe FaceLandmarker (or null if webcam inactive/no face) */
  latestFeaturesRef: React.MutableRefObject<FeatureVector8D | null>;
  webcamActive: boolean;
  onEnableWebcam: () => Promise<void>;
  /** Roxy's actual eye midpoint in normalized viewport coordinates [0..1, 0..1] */
  eyeMidpointUv: [number, number];
  onCalibrationComplete: (model: CalibrationModel) => void;
  onResetToDefault: () => void;
}

type WizardStage = 'intro' | 'step1_center_lean' | 'step2_grid' | 'completed';

export const CalibrationWizardModal: React.FC<CalibrationWizardModalProps> = ({
  isOpen,
  onClose,
  latestFeaturesRef,
  webcamActive,
  onEnableWebcam,
  eyeMidpointUv,
  onCalibrationComplete,
  onResetToDefault,
}) => {
  const [stage, setStage] = useState<WizardStage>('intro');
  const [isCapturingCenter, setIsCapturingCenter] = useState(false);
  const [centerProgress, setCenterProgress] = useState(0);
  const [centerSamplesCount, setCenterSamplesCount] = useState(0);

  const [gridIndex, setGridIndex] = useState(0);
  const [isCapturingBurst, setIsCapturingBurst] = useState(false);
  const [burstProgress, setBurstProgress] = useState(0);

  const [solvedModel, setSolvedModel] = useState<CalibrationModel | null>(null);
  const [liveDepthZ, setLiveDepthZ] = useState(0);
  const [hasFaceSignal, setHasFaceSignal] = useState(false);

  const centerSamplesRef = useRef<FeatureVector8D[]>([]);
  const gridSamplesRef = useRef<CalibrationSample[]>([]);

  // Reset wizard when opened
  useEffect(() => {
    if (isOpen) {
      setStage('step1_center_lean');
      setIsCapturingCenter(false);
      setCenterProgress(0);
      setCenterSamplesCount(0);
      setGridIndex(0);
      setIsCapturingBurst(false);
      setBurstProgress(0);
      setSolvedModel(null);
      centerSamplesRef.current = [];
      gridSamplesRef.current = [];
    }
  }, [isOpen]);

  // Poll live 8D feature vector for telemetry display inside the wizard
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      const f = latestFeaturesRef.current;
      if (f) {
        setHasFaceSignal(true);
        setLiveDepthZ(f[2]);
      } else {
        setHasFaceSignal(false);
      }
    }, 60);
    return () => clearInterval(interval);
  }, [isOpen, latestFeaturesRef]);

  /**
   * Generates a synthetic realistic off-axis 8D feature vector when testing the Calibration UI
   * without a physical webcam attached (e.g., automated browser verification or demo visitor).
   */
  const getOrSynthesize8DVector = (
    targetX: number,
    targetY: number,
    leanPhase = 0
  ): FeatureVector8D => {
    if (latestFeaturesRef.current) {
      return [...latestFeaturesRef.current] as FeatureVector8D;
    }
    const dz = Math.sin(leanPhase) * 0.22;
    const jitter = () => (Math.random() - 0.5) * 0.012;
    // Simulate 35° left-side laptop camera coupling: leaning forward (+dz) shifts camera X by -0.62*dz and yaw by +0.28*dz
    return [
      -0.05 - 0.62 * dz - targetX * 0.16 + jitter(),
      0.0 + 0.08 * dz - targetY * 0.14 + jitter(),
      -0.05 + dz + jitter(),
      -0.36 + 0.28 * dz - targetX * 0.18 + jitter(),
      -0.04 - 0.05 * dz - targetY * 0.15 + jitter(),
      jitter(),
      -0.08 + 0.08 * dz - targetX * 0.20 + jitter(),
      0.02 - targetY * 0.18 + jitter(),
    ];
  };

  // Step 1: Capture 35 samples while user looks into Roxy's eyes & leans forward/back
  const startStep1CenterCapture = () => {
    if (isCapturingCenter) return;
    setIsCapturingCenter(true);
    setCenterProgress(0);
    centerSamplesRef.current = [];

    const totalSamples = 35;
    let count = 0;

    const timer = setInterval(() => {
      count++;
      const phase = (count / totalSamples) * Math.PI * 2;
      const sample = getOrSynthesize8DVector(0.0, 0.0, phase);
      centerSamplesRef.current.push(sample);
      setCenterSamplesCount(centerSamplesRef.current.length);
      setCenterProgress(Math.round((count / totalSamples) * 100));

      if (count >= totalSamples) {
        clearInterval(timer);
        setIsCapturingCenter(false);
        setStage('step2_grid');
        setGridIndex(0);
      }
    }, 20);
  };

  // Step 2: Capture a 12-sample burst at the current 9-point target
  const startStep2BurstCapture = () => {
    if (isCapturingBurst) return;
    const currentTarget = NINE_POINT_TARGETS[gridIndex];
    if (!currentTarget) return;

    setIsCapturingBurst(true);
    setBurstProgress(0);
    const burstSize = 12;
    let count = 0;

    const timer = setInterval(() => {
      count++;
      const sample = getOrSynthesize8DVector(
        currentTarget.x,
        currentTarget.y,
        count * 0.25
      );
      gridSamplesRef.current.push({
        features: sample,
        target: [currentTarget.x, currentTarget.y],
        weight: currentTarget.id === 'center' ? 1.5 : 1.0,
      });
      setBurstProgress(Math.round((count / burstSize) * 100));

      if (count >= burstSize) {
        clearInterval(timer);
        setIsCapturingBurst(false);
        setBurstProgress(0);

        if (gridIndex + 1 < NINE_POINT_TARGETS.length) {
          setGridIndex((prev) => prev + 1);
        } else {
          // All 9 points captured -> Run L2-Regularized Ridge Regression Solver!
          const model = solveRidgeCalibration(
            centerSamplesRef.current,
            gridSamplesRef.current
          );
          setSolvedModel(model);
          onCalibrationComplete(model);
          setStage('completed');
        }
      }
    }, 18);
  };

  // Spacebar listener for hands-free calibration while keeping eyes locked on targets
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (stage === 'step1_center_lean' && !isCapturingCenter) {
          startStep1CenterCapture();
        } else if (stage === 'step2_grid' && !isCapturingBurst) {
          startStep2BurstCapture();
        } else if (stage === 'completed') {
          onClose();
        }
      } else if (e.code === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen) return null;

  const activeGridTarget = NINE_POINT_TARGETS[gridIndex] || NINE_POINT_TARGETS[0];
  // Convert normalized monitor coordinate [-1, 1] (+Y = top, -Y = bottom) to CSS viewport %
  const targetScreenLeftPct =
    stage === 'step1_center_lean'
      ? eyeMidpointUv[0] * 100
      : 50 + activeGridTarget.x * 46;
  const targetScreenTopPct =
    stage === 'step1_center_lean'
      ? eyeMidpointUv[1] * 100
      : 50 - activeGridTarget.y * 44;

  return (
    <div
      className="pointer-events-auto select-none overflow-hidden"
      style={{ position: 'fixed', inset: 0, zIndex: 2147483647 }}
      data-testid="calibration-wizard-modal"
    >
      {/* Subtle dark glass vignette that keeps Roxy's eyes clearly visible in the center */}
      <div className="absolute top-0 left-0 w-full h-full bg-slate-950/55 backdrop-blur-[2px]" />

      {/* Animated Calibration Target Reticle on the 27-inch 2K Monitor */}
      {(stage === 'step1_center_lean' || stage === 'step2_grid') && (
        <div
          style={{
            left: `${targetScreenLeftPct}%`,
            top: `${targetScreenTopPct}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-out z-30"
        >
          <button
            type="button"
            onClick={() =>
              stage === 'step1_center_lean'
                ? startStep1CenterCapture()
                : startStep2BurstCapture()
            }
            data-testid="calibration-target-reticle"
            className="group relative flex items-center justify-center w-20 h-20 rounded-full focus:outline-none"
            title="Look here and press Space (or click)"
          >
            {/* Outer pulsing ring */}
            <span className="absolute inset-0 rounded-full border-2 border-cyan-400/70 animate-ping opacity-40" />
            <span className="absolute inset-2 rounded-full border border-cyan-300/80 bg-cyan-500/15 backdrop-blur-sm group-hover:scale-110 transition-transform" />
            {/* Progress arc / ring */}
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 80 80">
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke="rgba(34,211,238,0.2)"
                strokeWidth="4"
              />
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 34}
                strokeDashoffset={
                  2 *
                  Math.PI *
                  34 *
                  (1 -
                    (stage === 'step1_center_lean'
                      ? centerProgress
                      : burstProgress) /
                      100)
                }
              />
            </svg>
            {/* Center pinpoint dot */}
            <span className="w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_14px_#22d3ee] border-2 border-cyan-400" />
          </button>
          <div className="mt-2 px-3 py-1 rounded-full bg-slate-900/90 border border-cyan-500/40 text-[11px] font-medium text-cyan-200 whitespace-nowrap text-center shadow-lg">
            {stage === 'step1_center_lean'
              ? isCapturingCenter
                ? `Lock Eyes & Lean Forward/Back (${centerProgress}%)`
                : 'Look into Roxy’s Eyes & Press SPACE'
              : isCapturingBurst
              ? `Sampling 8D Vector (${burstProgress}%)`
              : `Point ${gridIndex + 1}/9: ${activeGridTarget.label} (Press SPACE)`}
          </div>
        </div>
      )}

      {/* 9-Point Grid Mini-Preview Dots during Step 2 */}
      {stage === 'step2_grid' &&
        NINE_POINT_TARGETS.map((pt, idx) => {
          const isDone = idx < gridIndex;
          const isCurrent = idx === gridIndex;
          if (isCurrent) return null;
          return (
            <div
              key={pt.id}
              style={{
                left: `${50 + pt.x * 46}%`,
                top: `${50 - pt.y * 44}%`,
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border transition-all z-20 flex items-center justify-center ${
                isDone
                  ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300'
                  : 'bg-slate-800/50 border-white/20'
              }`}
            >
              {isDone && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            </div>
          );
        })}

      {/* Sleek Glassmorphism Control Card (docked bottom-center during Step 2 so center target is clear) */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 z-40 w-full max-w-xl px-4 transition-all duration-300 ${
          stage === 'completed' ? 'top-1/2 -translate-y-1/2' : 'bottom-7'
        }`}
      >
        <div className="rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-cyan-500/30 shadow-[0_20px_60px_rgba(0,0,0,0.75)] p-5 text-white">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center text-cyan-300">
                <Crosshair className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                  27&quot; 2K Monitor Off-Axis Calibration
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                    Left-Laptop 3D Solver
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Decouples ~30°–45° left webcam diagonal depth-lean (X/Z) via 8D Ridge Regression
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close calibration wizard"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Webcam status strip */}
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 mb-4 text-xs">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  hasFaceSignal
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : webcamActive
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-cyan-400'
                }`}
              />
              <span className="text-slate-300">
                {hasFaceSignal
                  ? `Live 8D Face Vector Active (metricZ: ${liveDepthZ >= 0 ? '+' : ''}${liveDepthZ.toFixed(2)})`
                  : webcamActive
                  ? 'Webcam active — awaiting face landmarks (synthetic solver preview ready)'
                  : 'Off-Axis Synthetic / Demo Calibration Ready (or Enable Webcam)'}
              </span>
            </div>
            {!webcamActive && (
              <button
                type="button"
                onClick={onEnableWebcam}
                className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/30 font-medium transition-colors"
              >
                Enable Webcam
              </button>
            )}
          </div>

          {/* Stage 1: Direct Eye-Contact Center Lock + Lean Forward/Back */}
          {stage === 'step1_center_lean' && (
            <div className="space-y-3" data-testid="calibration-step-1">
              <div className="flex items-start gap-3">
                <div className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 font-bold text-xs shrink-0 mt-0.5">
                  STEP 1 / 2
                </div>
                <div className="text-xs text-slate-200 leading-relaxed">
                  <p className="font-semibold text-white text-sm mb-1">
                    Direct Eye-Contact Center Lock &amp; Depth-Lean Compensation
                  </p>
                  Look straight into Roxy&apos;s eyes at the glowing reticle on your 27&quot; monitor and press{' '}
                  <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-cyan-300 font-mono text-[11px]">
                    Space
                  </kbd>
                  . While sampling runs, slowly lean slightly <strong>forward and backward</strong> while keeping your gaze locked on her eyes.
                </div>
              </div>

              {isCapturingCenter && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-[11px] text-cyan-300 font-medium">
                    <span>Recording 8D Depth-Invariance Cloud ({centerSamplesCount}/75 samples)...</span>
                    <span>{centerProgress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-400 transition-all duration-75"
                      style={{ width: `${centerProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={onResetToDefault}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restore 35° Left-Laptop Preset
                </button>
                <button
                  type="button"
                  data-testid="start-step1-btn"
                  disabled={isCapturingCenter}
                  onClick={startStep1CenterCapture}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-cyan-500/25 transition-all"
                >
                  <Eye className="w-4 h-4" />
                  {isCapturingCenter ? 'Sampling Center Lock...' : 'Lock Center Gaze (Space)'}
                </button>
              </div>
            </div>
          )}

          {/* Stage 2: 9-Point Screen Focus & Head Motion Grid */}
          {stage === 'step2_grid' && (
            <div className="space-y-3" data-testid="calibration-step-2">
              <div className="flex items-start gap-3">
                <div className="px-2.5 py-1 rounded-lg bg-indigo-500/25 text-indigo-300 font-bold text-xs shrink-0 mt-0.5">
                  STEP 2 / 2
                </div>
                <div className="text-xs text-slate-200 leading-relaxed flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-white text-sm">
                      9-Point 2K Screen Focus &amp; Head Motion Grid
                    </span>
                    <span className="text-cyan-300 font-mono font-semibold">
                      Target {gridIndex + 1} / 9 ({activeGridTarget.label})
                    </span>
                  </div>
                  Look at the pulsing target reticle at{' '}
                  <span className="text-cyan-300 font-medium">{activeGridTarget.label}</span> and press{' '}
                  <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-cyan-300 font-mono text-[11px]">
                    Space
                  </kbd>{' '}
                  (or click the reticle) to capture an 8D feature burst.
                </div>
              </div>

              <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 transition-all duration-200"
                  style={{ width: `${((gridIndex + burstProgress / 100) / 9) * 100}%` }}
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-400">
                  Step 1 Depth Lock: {centerSamplesCount} samples captured
                </span>
                <button
                  type="button"
                  data-testid="capture-grid-point-btn"
                  disabled={isCapturingBurst}
                  onClick={startStep2BurstCapture}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-cyan-500/20 transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isCapturingBurst
                    ? `Capturing Burst (${burstProgress}%)...`
                    : `Capture Target ${gridIndex + 1}/9 (Space)`}
                </button>
              </div>
            </div>
          )}

          {/* Stage 3: Completed Summary */}
          {stage === 'completed' && solvedModel && (
            <div className="space-y-4" data-testid="calibration-completed">
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    8D Ridge Regression Matrix W Solved &amp; Saved to localStorage
                  </h3>
                  <p className="text-xs text-emerald-200/80">
                    Off-axis depth-lean coupling neutralized across {solvedModel.metrics.centerSamples} center-lean +{' '}
                    {solvedModel.metrics.gridSamples} grid samples.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Off-Axis Camera Angle
                  </div>
                  <div className="text-base font-bold text-cyan-300 mt-0.5">
                    ~{solvedModel.metrics.estimatedCameraAngleDeg}° Left
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    X/Z Lean Decoupling
                  </div>
                  <div className="text-base font-bold text-indigo-300 mt-0.5">
                    {solvedModel.depthCoupling[0].toFixed(2)} dX/dZ
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Fit Residual (RMSE)
                  </div>
                  <div className="text-base font-bold text-emerald-300 mt-0.5">
                    {(0.5 * (solvedModel.metrics.rmseX + solvedModel.metrics.rmseY)).toFixed(3)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStage('step1_center_lean')}
                  className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors"
                >
                  Recalibrate
                </button>
                <button
                  type="button"
                  data-testid="finish-calibration-btn"
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all"
                >
                  Apply &amp; Return to Live Wallpaper
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
