/**
 * Left-Side Laptop Camera 3D Tracking & Ridge Regression Calibration Solver
 * =========================================================================
 * Designed specifically for a 27-inch 2K (2560x1440) external monitor directly in front
 * of the user while the webcam sits on a laptop ~30°–45° to the LEFT side.
 *
 * Extracts the mandatory 8D feature vector every frame:
 *   [metricX, metricY, metricZ, headYaw, headPitch, headRoll, irisOffsetX, irisOffsetY]
 *
 * Solves off-axis 3D-to-2D coupling via:
 *   1. Step 1 Center Eye-Contact Lock + Forward/Backward Depth-Lean Orthogonalization
 *   2. Step 2 9-Point Screen Focus & Head Motion Grid
 *   3. L2-Regularized Ridge Regression mapping matrix W -> [-1.0, 1.0]^2 saved to localStorage
 */

export type FeatureVector8D = [
  number, // 0: metricX (3D camera-space X translation, normalized)
  number, // 1: metricY (3D camera-space Y translation, normalized)
  number, // 2: metricZ (3D camera-space depth Z, normalized)
  number, // 3: headYaw (head yaw angle in radians)
  number, // 4: headPitch (head pitch angle in radians)
  number, // 5: headRoll (head roll angle in radians)
  number, // 6: irisOffsetX (local eyeball horizontal gaze offset in socket [-1, 1])
  number  // 7: irisOffsetY (local eyeball vertical gaze offset in socket [-1, 1])
];

export type TrackingMode = 'hybrid' | 'eye_contact' | 'screen_focus' | 'mouse';

export interface CalibrationSample {
  features: FeatureVector8D;
  target: [number, number]; // Normalized monitor coordinates [-1.0, 1.0]
  weight?: number;
}

export interface CalibrationModel {
  version: number;
  createdAt: string;
  /** Baseline 8D feature vector when looking straight into Roxy's eyes at monitor center (0,0) */
  centerBaseline: FeatureVector8D;
  /** Feature standard deviations for numerical conditioning */
  featureScale: FeatureVector8D;
  /**
   * Depth-coupling vector k_z: d(feature_i)/d(delta_metricZ) measured during Step 1 forward/back lean.
   * Subtracting k_z * (metricZ - centerBaseline[2]) decouples the ~35° left-laptop diagonal axis!
   */
  depthCoupling: FeatureVector8D;
  /**
   * 9x2 L2-regularized Ridge Regression weight matrix W (8 standardized features + 1 bias -> [gazeX, gazeY])
   * Stored as 9 rows of [wX, wY].
   */
  weightsGaze: Array<[number, number]>;
  /**
   * 9x2 weight matrix mapping 3D face position/pose to monitor coordinates for Eye Contact Mode
   */
  weightsFacePos: Array<[number, number]>;
  metrics: {
    centerSamples: number;
    gridSamples: number;
    rmseX: number;
    rmseY: number;
    estimatedCameraAngleDeg: number;
  };
}

export const CALIBRATION_STORAGE_KEY = 'anemoia_roxy_27in_calibration_v1';

export const NINE_POINT_TARGETS: Array<{ id: string; label: string; x: number; y: number }> = [
  { id: 'center', label: 'Center (Roxy Eyes)', x: 0.0, y: 0.0 },
  { id: 'top-left', label: 'Top Left Corner', x: -0.88, y: 0.85 },
  { id: 'top-center', label: 'Top Edge Midpoint', x: 0.0, y: 0.85 },
  { id: 'top-right', label: 'Top Right Corner', x: 0.88, y: 0.85 },
  { id: 'mid-right', label: 'Right Edge Midpoint', x: 0.88, y: 0.0 },
  { id: 'bottom-right', label: 'Bottom Right Corner', x: 0.88, y: -0.85 },
  { id: 'bottom-center', label: 'Bottom Edge Midpoint', x: 0.0, y: -0.85 },
  { id: 'bottom-left', label: 'Bottom Left Corner', x: -0.88, y: -0.85 },
  { id: 'mid-left', label: 'Left Edge Midpoint', x: -0.88, y: 0.0 },
];

export type CameraSetup = 'laptop_centered' | 'side_monitor';

/**
 * Default pre-calibrated model tailored for Laptop Screen (0° Centered Webcam directly above the screen).
 * Active by default out-of-the-box so the user can test on their laptop display with zero calibration needed.
 * Features 100% symmetric horizontal tracking with full travel to both left and right sides.
 */
export function createDefaultCenteredLaptopCalibration(): CalibrationModel {
  const centerBaseline: FeatureVector8D = [0.0, 0.0, -0.05, 0.0, -0.04, 0.0, 0.0, 0.02];
  const featureScale: FeatureVector8D = [0.18, 0.14, 0.16, 0.18, 0.14, 0.12, 0.16, 0.14];
  const depthCoupling: FeatureVector8D = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

  const weightsGaze: Array<[number, number]> = [
    [-0.45, 0.0],   // metricX (mirrored webcam face translation -> screen X)
    [0.0, -0.35],   // metricY -> screen Y
    [0.0, 0.0],     // metricZ
    [-0.55, 0.0],   // headYaw -> screen X
    [0.0, -0.45],   // headPitch -> screen Y
    [0.02, 0.01],   // headRoll
    [-0.60, 0.0],   // irisOffsetX -> screen X (full socket reach)
    [0.0, -0.50],   // irisOffsetY -> screen Y
    [0.0, 0.10],    // bias
  ];

  const weightsFacePos: Array<[number, number]> = [
    [-0.65, 0.0],   // metricX -> 3D face horizontal position
    [0.0, -0.55],   // metricY
    [0.0, 0.0],     // metricZ
    [-0.30, 0.0],   // headYaw
    [0.0, -0.28],   // headPitch
    [0.02, 0.0],    // headRoll
    [-0.15, 0.0],   // iris contribution
    [0.0, -0.15],
    [0.0, 0.12],    // bias
  ];

  return {
    version: 1,
    createdAt: new Date(0).toISOString(),
    centerBaseline,
    featureScale,
    depthCoupling,
    weightsGaze,
    weightsFacePos,
    metrics: {
      centerSamples: 0,
      gridSamples: 0,
      rmseX: 0,
      rmseY: 0,
      estimatedCameraAngleDeg: 0.0,
    },
  };
}

/**
 * Default pre-calibrated model tailored for a 27" monitor with the laptop webcam sitting ~35° to the LEFT.
 */
export function createDefaultLeftLaptopCalibration(): CalibrationModel {
  // When laptop is ~35° to the left of the 27" monitor and user looks at monitor center:
  // User's head appears turned ~0.42 rad (~24°) to the right in the laptop camera frame,
  // and leaning forward (+deltaZ) shifts camera-space X positively by tan(35°) * deltaZ.
  const centerBaseline: FeatureVector8D = [-0.05, 0.0, -0.05, -0.36, -0.04, 0.0, -0.08, 0.02];
  const featureScale: FeatureVector8D = [0.18, 0.14, 0.16, 0.18, 0.14, 0.12, 0.16, 0.14];
  const depthCoupling: FeatureVector8D = [-0.62, 0.08, 0.0, 0.28, -0.05, 0.0, 0.08, 0.0];

  // Standardized feature weights: [metricX, metricY, metricZ, headYaw, headPitch, headRoll, irisX, irisY, bias]
  const weightsGaze: Array<[number, number]> = [
    [-0.25, 0.0],   // metricX (mirrored webcam X -> screen X)
    [0.0, -0.22],   // metricY -> screen Y
    [0.0, 0.0],     // metricZ (already decoupled via depthCoupling)
    [-0.45, 0.0],   // headYaw -> screen X
    [0.0, -0.42],   // headPitch -> screen Y
    [0.04, 0.02],   // headRoll
    [-0.48, 0.0],   // irisOffsetX -> screen X
    [0.0, -0.45],   // irisOffsetY -> screen Y
    [0.0, 0.12],    // bias (slight upward eye-contact lift at neutral)
  ];

  const weightsFacePos: Array<[number, number]> = [
    [-0.58, 0.0],   // metricX -> 3D face horizontal position in front of monitor
    [0.0, -0.52],   // metricY -> 3D face vertical position in front of monitor
    [0.0, 0.0],     // metricZ (depth-compensated)
    [-0.28, 0.0],   // headYaw contribution
    [0.0, -0.24],   // headPitch contribution
    [0.02, 0.0],    // headRoll
    [-0.10, 0.0],   // subtle iris contribution
    [0.0, -0.10],
    [0.0, 0.15],    // bias
  ];

  return {
    version: 1,
    createdAt: new Date(0).toISOString(),
    centerBaseline,
    featureScale,
    depthCoupling,
    weightsGaze,
    weightsFacePos,
    metrics: {
      centerSamples: 0,
      gridSamples: 0,
      rmseX: 0,
      rmseY: 0,
      estimatedCameraAngleDeg: 35.0,
    },
  };
}

export function createDefaultCalibration(setup: CameraSetup = 'laptop_centered'): CalibrationModel {
  return setup === 'laptop_centered'
    ? createDefaultCenteredLaptopCalibration()
    : createDefaultLeftLaptopCalibration();
}

/**
 * Extracts the 8D feature vector `[metricX, metricY, metricZ, headYaw, headPitch, headRoll, irisOffsetX, irisOffsetY]`
 * from MediaPipe `FaceLandmarkerResult`.
 */
export function extract8DFeatureVector(result: {
  faceLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
  facialTransformationMatrixes?: Array<{ data: Float32Array | number[] }>;
}): FeatureVector8D | null {
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks || landmarks.length < 478) {
    return null;
  }

  let metricX = 0;
  let metricY = 0;
  let metricZ = 0;
  let headYaw = 0;
  let headPitch = 0;
  let headRoll = 0;

  const matData = result.facialTransformationMatrixes?.[0]?.data;
  if (matData && matData.length >= 16) {
    // MediaPipe 4x4 column-major facial transformation matrix (units: cm in camera space)
    // Column 0: m[0..3], Column 1: m[4..7], Column 2: m[8..11], Column 3 (translation): m[12..15]
    const r00 = matData[0], r10 = matData[1], r20 = matData[2];
    const r01 = matData[4], r11 = matData[5], r21 = matData[6];
    const r02 = matData[8], r12 = matData[9], r22 = matData[10];
    const tx = matData[12], ty = matData[13], tz = matData[14];

    // Normalize metric translation (typical desktop viewing distance ~45-65 cm)
    metricX = tx / 40.0;
    metricY = ty / 40.0;
    metricZ = (tz + 52.0) / 35.0;

    // Extract Euler angles (Yaw, Pitch, Roll) from rotation matrix
    const sy = Math.hypot(r02, r22);
    headPitch = Math.atan2(-r12, Math.max(1e-6, sy));
    headYaw = Math.atan2(r02, r22);
    headRoll = Math.atan2(r10, r11);
  } else {
    // Fallback geometric 3D pose estimation from landmarks if matrix unavailable
    const nose = landmarks[1];
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];
    const forehead = landmarks[10];
    const chin = landmarks[152];

    const midX = 0.5 * (leftEyeOuter.x + rightEyeOuter.x);
    const midY = 0.5 * (leftEyeOuter.y + rightEyeOuter.y);
    const interOcularDist = Math.hypot(
      rightEyeOuter.x - leftEyeOuter.x,
      rightEyeOuter.y - leftEyeOuter.y,
      rightEyeOuter.z - leftEyeOuter.z
    );

    metricX = (midX - 0.5) * 2.0;
    metricY = -(midY - 0.5) * 2.0;
    // Larger interOcularDist = closer to camera (smaller negative Z)
    metricZ = (0.16 - interOcularDist) * 8.0;

    headYaw = (nose.x - midX) / Math.max(0.04, interOcularDist) * 1.8;
    headPitch = ((nose.y - 0.5 * (forehead.y + chin.y)) / Math.max(0.08, Math.abs(chin.y - forehead.y))) * 2.2;
    headRoll = Math.atan2(rightEyeOuter.y - leftEyeOuter.y, rightEyeOuter.x - leftEyeOuter.x);
  }

  // Extract sub-socket Iris offsets using landmarks 468..477 relative to eye corners & eyelids
  // Left eye: outer=33, inner=133, top=159, bottom=145, irisCenter=468
  // Right eye: inner=362, outer=263, top=386, bottom=374, irisCenter=473
  const computeSocketIrisOffset = (
    cornerA: { x: number; y: number },
    cornerB: { x: number; y: number },
    lidTop: { x: number; y: number },
    lidBot: { x: number; y: number },
    irisCenter: { x: number; y: number }
  ): [number, number] => {
    const ux = cornerB.x - cornerA.x;
    const uy = cornerB.y - cornerA.y;
    const eyeWidth = Math.max(1e-5, Math.hypot(ux, uy));
    const ex = ux / eyeWidth;
    const ey = uy / eyeWidth;

    const midX = 0.5 * (cornerA.x + cornerB.x);
    const midY = 0.5 * (cornerA.y + cornerB.y);
    const dx = irisCenter.x - midX;
    const dy = irisCenter.y - midY;

    // Project along eye horizontal axis and perpendicular vertical axis
    const projX = (dx * ex + dy * ey) / (0.5 * eyeWidth);

    const lidMidY = 0.5 * (lidTop.y + lidBot.y);
    const lidMidX = 0.5 * (lidTop.x + lidBot.x);
    const eyeHeight = Math.max(1e-5, Math.hypot(lidBot.x - lidTop.x, lidBot.y - lidTop.y));
    const vdx = irisCenter.x - lidMidX;
    const vdy = irisCenter.y - lidMidY;
    const projY = (-vdx * ey + vdy * ex) / (0.5 * eyeHeight + 0.12 * eyeWidth);

    return [projX, projY];
  };

  const [lIrisX, lIrisY] = computeSocketIrisOffset(
    landmarks[33],
    landmarks[133],
    landmarks[159],
    landmarks[145],
    landmarks[468]
  );
  const [rIrisX, rIrisY] = computeSocketIrisOffset(
    landmarks[362],
    landmarks[263],
    landmarks[386],
    landmarks[374],
    landmarks[473]
  );

  const irisOffsetX = 0.5 * (lIrisX + rIrisX);
  const irisOffsetY = 0.5 * (lIrisY + rIrisY);

  return [
    metricX,
    metricY,
    metricZ,
    headYaw,
    headPitch,
    headRoll,
    irisOffsetX,
    irisOffsetY,
  ];
}

/**
 * Solves a linear system A * x = b using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(M[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }
    if (maxRow !== col) {
      const tmp = M[col];
      M[col] = M[maxRow];
      M[maxRow] = tmp;
    }

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-10) continue;

    for (let j = col; j <= n; j++) {
      M[col][j] /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Computes the complete Depth-Compensated L2-Regularized Ridge Regression Calibration Model
 * from Step 1 (Direct Eye-Contact Center Lock + Lean In/Out) and Step 2 (9-Point Monitor Grid).
 */
export function solveRidgeCalibration(
  centerLeanSamples: FeatureVector8D[],
  gridSamples: CalibrationSample[],
  lambdaGaze = 0.08,
  lambdaPos = 0.14
): CalibrationModel {
  const fallback = createDefaultLeftLaptopCalibration();
  if (centerLeanSamples.length === 0 && gridSamples.length === 0) {
    return fallback;
  }

  // 1. Compute Center Eye-Contact Baseline from Step 1 samples
  const centerPool =
    centerLeanSamples.length > 0
      ? centerLeanSamples
      : gridSamples
          .filter((s) => Math.hypot(s.target[0], s.target[1]) < 0.15)
          .map((s) => s.features);

  const centerBaseline: FeatureVector8D = [0, 0, 0, 0, 0, 0, 0, 0];
  if (centerPool.length > 0) {
    for (const f of centerPool) {
      for (let d = 0; d < 8; d++) centerBaseline[d] += f[d] / centerPool.length;
    }
  } else {
    for (let d = 0; d < 8; d++) centerBaseline[d] = fallback.centerBaseline[d];
  }

  // 2. Estimate Step 1 Forward/Backward Depth-Lean Coupling Vector k_z = Cov(f_d, dZ) / (Var(dZ) + eps)
  // This explicitly isolates how leaning toward/away from the 27" monitor couples into X and Yaw
  // on the left-side laptop camera.
  const depthCoupling: FeatureVector8D = [0, 0, 0, 0, 0, 0, 0, 0];
  if (centerLeanSamples.length >= 6) {
    let varZ = 0;
    const covF = new Array(8).fill(0);
    for (const f of centerLeanSamples) {
      const dz = f[2] - centerBaseline[2];
      varZ += dz * dz;
      for (let d = 0; d < 8; d++) {
        if (d !== 2) {
          covF[d] += (f[d] - centerBaseline[d]) * dz;
        }
      }
    }
    varZ /= centerLeanSamples.length;
    for (let d = 0; d < 8; d++) {
      if (d !== 2) {
        covF[d] /= centerLeanSamples.length;
        // Damped slope estimate so even mild leans calibrate cleanly
        depthCoupling[d] = covF[d] / (varZ + 0.004);
      }
    }
  } else {
    for (let d = 0; d < 8; d++) depthCoupling[d] = fallback.depthCoupling[d];
  }

  // Helper to apply depth decoupling relative to centerBaseline
  const decoupleFeatures = (f: FeatureVector8D): FeatureVector8D => {
    const dz = f[2] - centerBaseline[2];
    return [
      f[0] - centerBaseline[0] - depthCoupling[0] * dz,
      f[1] - centerBaseline[1] - depthCoupling[1] * dz,
      dz,
      f[3] - centerBaseline[3] - depthCoupling[3] * dz,
      f[4] - centerBaseline[4] - depthCoupling[4] * dz,
      f[5] - centerBaseline[5] - depthCoupling[5] * dz,
      f[6] - centerBaseline[6] - depthCoupling[6] * dz,
      f[7] - centerBaseline[7] - depthCoupling[7] * dz,
    ];
  };

  // Combine Step 1 center-lock samples (target = [0, 0], high weight for rock-solid center eye contact)
  // and Step 2 9-point grid samples
  const allSamples: CalibrationSample[] = [
    ...centerLeanSamples.map((f) => ({
      features: f,
      target: [0.0, 0.0] as [number, number],
      weight: 1.6,
    })),
    ...gridSamples.map((s) => ({
      features: s.features,
      target: s.target,
      weight: s.weight ?? 1.0,
    })),
  ];

  // Compute feature standard deviations for numerical conditioning
  const featureScale: FeatureVector8D = [0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12];
  if (allSamples.length >= 9) {
    const sqSum = new Array(8).fill(0);
    for (const s of allSamples) {
      const df = decoupleFeatures(s.features);
      for (let d = 0; d < 8; d++) {
        sqSum[d] += df[d] * df[d];
      }
    }
    for (let d = 0; d < 8; d++) {
      featureScale[d] = Math.max(0.035, Math.sqrt(sqSum[d] / allSamples.length));
    }
  }

  // Solve L2-regularized Ridge Regression: (X^T W X + lambda * I + Prior) w = X^T W y + Prior * w_0
  const fitWeights = (
    featureMask: number[],
    priorWeights: Array<[number, number]>,
    lambda: number
  ): Array<[number, number]> => {
    const dim = 9; // 8 standardized features + 1 bias
    const XtX: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
    const XtYx: number[] = new Array(dim).fill(0);
    const XtYy: number[] = new Array(dim).fill(0);

    // Soft Bayesian prior toward anatomically valid off-axis weights so ill-conditioned axes never explode
    for (let i = 0; i < dim; i++) {
      const reg = i === 8 ? lambda * 0.25 : lambda;
      XtX[i][i] += reg;
      XtYx[i] += reg * priorWeights[i][0];
      XtYy[i] += reg * priorWeights[i][1];
    }

    const nSamples = Math.max(1, allSamples.length);
    for (const s of allSamples) {
      const df = decoupleFeatures(s.features);
      const xVec = new Array(dim).fill(1.0);
      for (let d = 0; d < 8; d++) {
        xVec[d] = (df[d] / featureScale[d]) * featureMask[d];
      }

      const w = (s.weight ?? 1.0) / (nSamples / 18.0);
      for (let i = 0; i < dim; i++) {
        XtYx[i] += w * xVec[i] * s.target[0];
        XtYy[i] += w * xVec[i] * s.target[1];
        for (let j = 0; j < dim; j++) {
          XtX[i][j] += w * xVec[i] * xVec[j];
        }
      }
    }

    const wx = solveLinearSystem(XtX, XtYx);
    const wy = solveLinearSystem(XtX, XtYy);
    return wx.map((vx, i) => [vx, wy[i]]);
  };

  // Screen Focus uses all 8 features (3D pose + iris gaze)
  const weightsGaze = fitWeights(
    [1.0, 1.0, 1.0, 1.0, 1.0, 0.5, 1.0, 1.0],
    fallback.weightsGaze,
    lambdaGaze
  );

  // Eye Contact Mode focuses on 3D head position & orientation in front of the 27" monitor
  const weightsFacePos = fitWeights(
    [1.0, 1.0, 1.0, 0.85, 0.85, 0.35, 0.35, 0.35],
    fallback.weightsFacePos,
    lambdaPos
  );

  // Compute training RMSE and estimated off-axis camera angle
  let errSqX = 0;
  let errSqY = 0;
  const tempModel: CalibrationModel = {
    version: 1,
    createdAt: new Date().toISOString(),
    centerBaseline,
    featureScale,
    depthCoupling,
    weightsGaze,
    weightsFacePos,
    metrics: {
      centerSamples: centerLeanSamples.length,
      gridSamples: gridSamples.length,
      rmseX: 0,
      rmseY: 0,
      estimatedCameraAngleDeg: 35.0,
    },
  };

  for (const s of allSamples) {
    const [px, py] = evaluateCalibratedGaze(s.features, tempModel, 'screen_focus');
    errSqX += (px - s.target[0]) ** 2;
    errSqY += (py - s.target[1]) ** 2;
  }

  const rmseX = Math.sqrt(errSqX / Math.max(1, allSamples.length));
  const rmseY = Math.sqrt(errSqY / Math.max(1, allSamples.length));
  const estAngleRad = Math.max(
    0.25,
    Math.min(0.95, Math.abs(centerBaseline[3]) + Math.abs(Math.atan(depthCoupling[0])) * 0.5)
  );

  tempModel.metrics.rmseX = Number(rmseX.toFixed(4));
  tempModel.metrics.rmseY = Number(rmseY.toFixed(4));
  tempModel.metrics.estimatedCameraAngleDeg = Number(((estAngleRad * 180) / Math.PI).toFixed(1));

  return tempModel;
}

/**
 * Evaluates the calibrated mapping on a live 8D feature vector according to the active tracking mode:
 *   - 'eye_contact': Locks Roxy's gaze onto the user's 3D face position in front of the 27" monitor
 *   - 'screen_focus': Tracks the exact spot on the 27" monitor the user is looking at
 *   - 'hybrid': 70% Face Position + 30% Gaze Direction (Default)
 */
export function evaluateCalibratedGaze(
  features: FeatureVector8D,
  model: CalibrationModel,
  mode: Exclude<TrackingMode, 'mouse'>
): [number, number] {
  const { centerBaseline, featureScale, depthCoupling, weightsGaze, weightsFacePos } = model;
  const dz = features[2] - centerBaseline[2];

  const stdFeatures = new Array(8).fill(0);
  for (let d = 0; d < 8; d++) {
    const decoupled =
      d === 2
        ? dz
        : features[d] - centerBaseline[d] - depthCoupling[d] * dz;
    stdFeatures[d] = decoupled / Math.max(0.02, featureScale[d]);
  }

  let gazeX = weightsGaze[8][0];
  let gazeY = weightsGaze[8][1];
  let posX = weightsFacePos[8][0];
  let posY = weightsFacePos[8][1];

  for (let d = 0; d < 8; d++) {
    gazeX += stdFeatures[d] * weightsGaze[d][0];
    gazeY += stdFeatures[d] * weightsGaze[d][1];
    posX += stdFeatures[d] * weightsFacePos[d][0];
    posY += stdFeatures[d] * weightsFacePos[d][1];
  }

  let outX = 0;
  let outY = 0;
  if (mode === 'eye_contact') {
    outX = posX;
    outY = posY;
  } else if (mode === 'screen_focus') {
    outX = gazeX;
    outY = gazeY;
  } else {
    // Hybrid Mode (Default): 70% Face Position + 30% Gaze Direction
    outX = 0.70 * posX + 0.30 * gazeX;
    outY = 0.70 * posY + 0.30 * gazeY;
  }

  // Soft hyperbolic tangent saturation inside [-1.0, 1.0] so extreme angles never snap harshly
  const clampSoft = (v: number) => Math.tanh(v * 0.95) / Math.tanh(0.95);
  return [
    Math.max(-1.0, Math.min(1.0, clampSoft(outX))),
    Math.max(-1.0, Math.min(1.0, clampSoft(outY))),
  ];
}

export const CALIBRATION_STORAGE_KEY_LAPTOP = 'anemoia_roxy_laptop_calibration_v1';

export function getStorageKey(setup: CameraSetup = 'laptop_centered'): string {
  return setup === 'laptop_centered' ? CALIBRATION_STORAGE_KEY_LAPTOP : CALIBRATION_STORAGE_KEY;
}

export function loadCalibrationFromStorage(setup: CameraSetup = 'laptop_centered'): CalibrationModel | null {
  try {
    const raw = localStorage.getItem(getStorageKey(setup));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalibrationModel;
    if (
      parsed &&
      Array.isArray(parsed.centerBaseline) &&
      parsed.centerBaseline.length === 8 &&
      Array.isArray(parsed.weightsGaze) &&
      parsed.weightsGaze.length === 9
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCalibrationToStorage(model: CalibrationModel, setup: CameraSetup = 'laptop_centered'): void {
  try {
    localStorage.setItem(getStorageKey(setup), JSON.stringify(model));
  } catch (err) {
    console.warn('Could not save calibration model to localStorage:', err);
  }
}

export function clearCalibrationFromStorage(setup?: CameraSetup): void {
  try {
    if (setup) {
      localStorage.removeItem(getStorageKey(setup));
    } else {
      localStorage.removeItem(CALIBRATION_STORAGE_KEY);
      localStorage.removeItem(CALIBRATION_STORAGE_KEY_LAPTOP);
    }
  } catch {
    // ignore
  }
}
