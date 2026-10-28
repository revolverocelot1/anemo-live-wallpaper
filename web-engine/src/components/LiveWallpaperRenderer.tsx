import React, { useEffect, useRef, useState } from 'react';

export interface EyeSocketConfig {
  center: [number, number];
  downCenter: [number, number];
  centerPx: [number, number];
  irisRadii: [number, number];
  irisRadiiPx: [number, number];
  socketBounds: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    px: [number, number, number, number];
  };
  upperCurve: Array<[number, number]>;
  lowerCurve: Array<[number, number]>;
  specularPos: [number, number];
  maxShiftNormalized: [number, number];
  eyelidWarpWeights: {
    upperFollow: number;
    lowerFollow: number;
    blinkTravel: number;
  };
}

export interface RigConfig {
  version: string;
  resolution: { width: number; height: number };
  hasBgVideo: boolean;
  hasEyeVideo: boolean;
  eyeVideoMeta?: {
    ingested?: boolean;
    frameCount?: number;
    fps?: number;
    patchRectPx?: [number, number, number, number];
  };
  assets: {
    baseImage: string;
    scleraBase: string;
    irisLayer: string;
    bangsAndFrameMask: string;
    faceAnchor: string;
    windMask: string;
    bgVideo: string;
    eyeVideo: string;
    irisLayerV2?: string;
    [key: string]: string | undefined;
  };
  headBounds: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    px: [number, number, number, number];
  };
  leftEye: EyeSocketConfig;
  rightEye: EyeSocketConfig;
  gazeDefaults: {
    shyIdleGaze: [number, number];
    neutralEyeContactGaze: [number, number];
    blinkIntervalSec: [number, number];
    blinkDurationMs: number;
    bgPlaybackRate: number;
  };
  bgVideo?: string;
  [key: string]: any;
}

interface LiveWallpaperRendererProps {
  rigConfig: RigConfig;
  /** Live smoothed gaze target in [-1, 1]^2 (+X = viewer right, +Y = looking up) */
  gazeTargetRef: React.MutableRefObject<[number, number]>;
  /** Wind strength multiplier (default 1.0) */
  windIntensity?: number;
  /** Eyelid 30% anatomical follow-warp multiplier (default 1.0 => 30% follow) */
  eyelidFollowScale?: number;
  /** Fit mode for 2K viewport ('cover' | 'contain') */
  fitMode?: 'cover' | 'contain';
  /** External manual blink trigger counter */
  manualBlinkCounter?: number;
  /** When true the render loop + bg video fully sleep (~0% GPU). Used by desktop auto-sleep / pause. */
  paused?: boolean;
  /** Iris art variant: 'classic' (Set 1, default) or 'focused' (Set 2 with dark pupil & center gaze) */
  irisStyle?: 'classic' | 'focused';
  /** Callback reporting renderer status (FPS, active bg mode, current blink state) */
  onStatusUpdate?: (status: {
    fps: number;
    usingBgVideo: boolean;
    usingEyeVideo: boolean;
    isBlinking: boolean;
  }) => void;
}

const VERTEX_SHADER_SRC = `
attribute vec2 a_position;
varying vec2 v_screenUv;

void main() {
  // Map clip-space [-1, 1] to top-left UV [0, 1] matching image pixel coordinates
  v_screenUv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `
precision highp float;

varying vec2 v_screenUv;

uniform sampler2D u_baseTex;
uniform sampler2D u_scleraTex;
uniform sampler2D u_irisTex;
uniform sampler2D u_occluderTex;
uniform sampler2D u_faceAnchorTex;
uniform sampler2D u_windMaskTex;

uniform vec2 u_viewportSize;
uniform vec2 u_imageSize;
uniform float u_fitMode; // 0.0 = cover, 1.0 = contain
uniform float u_time;
uniform float u_hasBgVideo;
uniform float u_windIntensity;

uniform vec2 u_gaze;        // [-1.0, 1.0] (+x = right, +y = up)
uniform float u_blink;      // [0.0, 1.0] (0 = open, 1 = closed)
uniform float u_lidFollow;  // default 0.30 (30% anatomical eyelid follow)

// Left Eye Socket Uniforms
uniform vec4 u_leftBox;     // xMin, yMin, xMax, yMax (normalized)
uniform vec2 u_leftCenter;  // neutral iris center (normalized)
uniform vec2 u_leftRadii;   // iris radii (normalized)
uniform vec2 u_leftMaxShift;// max iris shift (normalized)
uniform float u_leftUpperY[6];
uniform float u_leftLowerY[6];

// Right Eye Socket Uniforms
uniform vec4 u_rightBox;    // xMin, yMin, xMax, yMax (normalized)
uniform vec2 u_rightCenter; // neutral iris center (normalized)
uniform vec2 u_rightRadii;  // iris radii (normalized)
uniform vec2 u_rightMaxShift;// max iris shift (normalized)
uniform float u_rightUpperY[6];
uniform float u_rightLowerY[6];

// Evaluates a 6-point piecewise cubic-style curve along x in [xMin, xMax]
float evalCurve6(float x, float xMin, float xMax, float c0, float c1, float c2, float c3, float c4, float c5) {
  float t = clamp((x - xMin) / max(1e-5, xMax - xMin), 0.0, 1.0) * 5.0;
  float idx = floor(t);
  float f = t - idx;
  if (idx < 0.5) return mix(c0, c1, f);
  if (idx < 1.5) return mix(c1, c2, f);
  if (idx < 2.5) return mix(c2, c3, f);
  if (idx < 3.5) return mix(c3, c4, f);
  return mix(c4, c5, clamp(t - 4.0, 0.0, 1.0));
}

// Evaluates 2.5D Parametric Eye + Eyelid Warp + Blink for a single eye socket
vec3 renderEyeSocket(
  vec2 uv,
  vec3 baseColor,
  vec4 box,
  vec2 irisCenter,
  vec2 irisRadii,
  vec2 maxShift,
  float u0, float u1, float u2, float u3, float u4, float u5,
  float l0, float l1, float l2, float l3, float l4, float l5,
  float isLeftEye
) {
  float padX = 14.0 / u_imageSize.x;
  float padY = 14.0 / u_imageSize.y;
  if (uv.x < box.x - padX || uv.x > box.z + padX || uv.y < box.y - padY || uv.y > box.w + padY) {
    return baseColor;
  }

  float yUp = evalCurve6(uv.x, box.x, box.z, u0, u1, u2, u3, u4, u5);
  float yLo = evalCurve6(uv.x, box.x, box.z, l0, l1, l2, l3, l4, l5);

  // 1. Clean Shaded Sclera Base inside the socket
  vec3 scleraCol = texture2D(u_scleraTex, uv).rgb;

  // 2. Sub-pixel 2D Iris Shift + Corneal Specular Parallax
  vec2 clampedGaze = clamp(u_gaze, vec2(-1.05), vec2(1.05));
  float rightBoost = clampedGaze.x > 0.0 ? 1.12 : 1.0;
  vec2 irisShift = vec2(clampedGaze.x * maxShift.x * rightBoost, -clampedGaze.y * maxShift.y);

  // Subtle eyeball spherical compression near socket horizontal corners
  vec2 irisSampleUv = uv - irisShift;
  vec4 irisSample = texture2D(u_irisTex, irisSampleUv);

  // Dynamic corneal specular highlight with 15% extra 3D parallax over the iris
  vec2 movedIrisCenter = irisCenter + irisShift;
  vec2 specCenter = movedIrisCenter + vec2(-0.24 * irisRadii.x, -0.30 * irisRadii.y) + irisShift * 0.16;
  vec2 specDelta = (uv - specCenter) / vec2(2.1 / u_imageSize.x, 1.6 / u_imageSize.y);
  float specGleam = exp(-0.5 * dot(specDelta, specDelta)) * irisSample.a;
  vec3 irisRgb = mix(irisSample.rgb, vec3(0.95, 0.98, 1.0), specGleam * 0.45);

  // Anatomical eyelid follow-warp & upper-eyelid depth shadow
  float lidFollowDeltaY = -clampedGaze.y * (u_lidFollow * maxShift.y * 3.4);
  float tx = clamp((uv.x - box.x) / max(1e-5, box.z - box.x), 0.0, 1.0);
  float bellX = sin(tx * 3.14159265);
  float yUpWarped = yUp + lidFollowDeltaY * bellX;
  float yLoWarped = yLo + lidFollowDeltaY * 0.45 * bellX;

  float distFromUpperLid = (uv.y - yUpWarped) / max(1e-5, yLoWarped - yUpWarped);
  float upperAo = clamp((0.35 - distFromUpperLid) / 0.35, 0.0, 1.0);
  irisRgb *= (1.0 - 0.36 * upperAo * upperAo);

  vec3 eyeballCol = mix(scleraCol, irisRgb, irisSample.a);

  // 3. Anatomical Eyelid Follow-Warp + Locked Cyan Hair Bangs Occluder
  float midY = 0.5 * (yUp + yLo);
  float sigmaY = 22.0 / u_imageSize.y;
  float bellY = exp(-0.5 * pow((uv.y - midY) / sigmaY, 2.0));
  float localFollowDy = lidFollowDeltaY * bellX * bellY;

  vec2 occSampleUv = vec2(uv.x, uv.y - localFollowDy);
  vec4 occSample = texture2D(u_occluderTex, occSampleUv);

  // Composite warped eyelid/frame occluder over eyeball
  vec3 eyeComp = mix(eyeballCol, occSample.rgb, occSample.a);

  // 4. Organic Procedural Blink Controller (150ms smooth closure every 4-7s)
  if (u_blink > 0.005) {
    float yBlink = mix(yUpWarped, yLoWarped, u_blink);
    float pxX = 1.0 / u_imageSize.x;
    float pxY = 1.0 / u_imageSize.y;

    float inX = clamp(min(uv.x - box.x + 1.0 * pxX, box.z - uv.x + 1.0 * pxX) / (2.5 * pxX), 0.0, 1.0);
    float inTop = clamp((uv.y - (yUpWarped - 4.5 * pxY)) / (2.0 * pxY), 0.0, 1.0);
    float inBot = clamp(((yBlink + 1.0 * pxY) - uv.y) / (1.5 * pxY), 0.0, 1.0);
    float lidCov = inX * inTop * inBot * min(1.0, u_blink * 3.0);

    vec3 skinTop = isLeftEye > 0.5 ? vec3(130.0, 136.0, 158.0) / 255.0 : vec3(108.0, 116.0, 144.0) / 255.0;
    vec3 skinBot = isLeftEye > 0.5 ? vec3(114.0, 116.0, 138.0) / 255.0 : vec3(92.0, 98.0, 126.0) / 255.0;
    vec3 lashCol = isLeftEye > 0.5 ? vec3(38.0, 44.0, 68.0) / 255.0 : vec3(26.0, 32.0, 56.0) / 255.0;

    float tLid = clamp((uv.y - (yUpWarped - 4.0 * pxY)) / max(1e-5, yBlink - (yUpWarped - 4.0 * pxY)), 0.0, 1.0);
    vec3 lidSkin = mix(skinTop, skinBot, tLid);

    float distToLash = abs(uv.y - (yBlink - 0.8 * pxY));
    float lashW = exp(-0.5 * pow(distToLash / (1.25 * pxY), 2.0));
    vec3 closedLidRgb = mix(lidSkin, lashCol, 0.90 * lashW);

    // Keep overlapping cyan hair strands locked in front of the blinking eyelid
    vec4 rawOcc = texture2D(u_occluderTex, uv);
    float blueBang = clamp((rawOcc.b - rawOcc.r - (42.0 / 255.0)) / (20.0 / 255.0), 0.0, 1.0)
                   * clamp((rawOcc.b - (95.0 / 255.0)) / (30.0 / 255.0), 0.0, 1.0)
                   * rawOcc.a;
    closedLidRgb = mix(closedLidRgb, rawOcc.rgb, blueBang);

    eyeComp = mix(eyeComp, closedLidRgb, lidCov);
  }

  // Smooth sub-pixel box border feather
  float edgeDist = min(
    min(uv.x - (box.x - padX), (box.z + padX) - uv.x),
    min(uv.y - (box.y - padY), (box.w + padY) - uv.y)
  );
  float boxFade = clamp(edgeDist / (3.5 / u_imageSize.x), 0.0, 1.0);
  return mix(baseColor, eyeComp, boxFade);
}

void main() {
  vec2 scale = vec2(1.0);
  float imgAspect = u_imageSize.x / u_imageSize.y;
  float viewAspect = u_viewportSize.x / u_viewportSize.y;

  if (u_fitMode < 0.5) {
    // Cover mode (full bleed 2K monitor)
    if (viewAspect > imgAspect) {
      scale.y = imgAspect / viewAspect;
    } else {
      scale.x = viewAspect / imgAspect;
    }
  } else {
    // Contain mode
    if (viewAspect > imgAspect) {
      scale.x = viewAspect / imgAspect;
    } else {
      scale.y = imgAspect / viewAspect;
    }
  }

  vec2 uv = (v_screenUv - 0.5) * scale + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec4 finalOutput;

  if (u_hasBgVideo > 0.5) {
    // Mode A: Hardware-accelerated background video is playing directly in the DOM underneath!
    // The WebGL canvas only renders face_anchor.png + the eye rig with transparent background.
    vec4 anchorSample = texture2D(u_faceAnchorTex, uv);
    vec3 color = anchorSample.rgb;
    float alpha = anchorSample.a;

    float padX = 14.0 / u_imageSize.x;
    float padY = 14.0 / u_imageSize.y;
    bool inLeft = (uv.x >= u_leftBox.x - padX && uv.x <= u_leftBox.z + padX && uv.y >= u_leftBox.y - padY && uv.y <= u_leftBox.w + padY);
    bool inRight = (uv.x >= u_rightBox.x - padX && uv.x <= u_rightBox.z + padX && uv.y >= u_rightBox.y - padY && uv.y <= u_rightBox.w + padY);

    if (inLeft) {
      color = renderEyeSocket(
        uv, color, u_leftBox, u_leftCenter, u_leftRadii, u_leftMaxShift,
        u_leftUpperY[0], u_leftUpperY[1], u_leftUpperY[2], u_leftUpperY[3], u_leftUpperY[4], u_leftUpperY[5],
        u_leftLowerY[0], u_leftLowerY[1], u_leftLowerY[2], u_leftLowerY[3], u_leftLowerY[4], u_leftLowerY[5],
        1.0
      );
      alpha = 1.0;
    } else if (inRight) {
      color = renderEyeSocket(
        uv, color, u_rightBox, u_rightCenter, u_rightRadii, u_rightMaxShift,
        u_rightUpperY[0], u_rightUpperY[1], u_rightUpperY[2], u_rightUpperY[3], u_rightUpperY[4], u_rightUpperY[5],
        u_rightLowerY[0], u_rightLowerY[1], u_rightLowerY[2], u_rightLowerY[3], u_rightLowerY[4], u_rightLowerY[5],
        0.0
      );
      alpha = 1.0;
    }

    finalOutput = vec4(color, alpha);
  } else {
    // Mode B: Static image fallback with WebGL wind shader
    vec3 windWeights = texture2D(u_windMaskTex, uv).rgb * u_windIntensity;
    float grassW = windWeights.r;
    float cloudW = windWeights.g;
    float hairW  = windWeights.b;

    float gustPhase1 = uv.x * 26.0 + uv.y * 14.0 - u_time * 2.35;
    float gustPhase2 = uv.x * 58.0 - uv.y * 22.0 - u_time * 4.10;
    float gustPhase3 = uv.x * 115.0 + uv.y * 38.0 - u_time * 6.20;
    float grassWaveX = (sin(gustPhase1) * 0.60 + sin(gustPhase2) * 0.28 + cos(gustPhase3) * 0.12);
    float grassWaveY = (cos(gustPhase1 * 0.85) * 0.30 + sin(gustPhase2 * 1.1) * 0.15);
    vec2 grassOffset = vec2(grassWaveX * 0.0042, grassWaveY * 0.0018) * grassW;

    float cloudWaveX = sin(uv.x * 10.0 - u_time * 0.38) * 0.0022 + mod(u_time * 0.00045, 0.012) * sin(u_time * 0.25);
    float cloudWaveY = cos(uv.x * 16.0 + u_time * 0.52) * 0.0007;
    vec2 cloudOffset = vec2(cloudWaveX, cloudWaveY) * cloudW;

    float hairWaveX = (sin(uv.y * 42.0 - u_time * 3.2 + uv.x * 18.0) * 0.65 + sin(uv.y * 85.0 - u_time * 5.4) * 0.35);
    float hairWaveY = cos(uv.x * 34.0 - u_time * 2.8) * 0.35;
    vec2 hairOffset = vec2(hairWaveX * 0.0020, hairWaveY * 0.0010) * hairW;

    vec2 displacedUv = clamp(uv + grassOffset + cloudOffset + hairOffset, vec2(0.001), vec2(0.999));
    vec3 bgColor = texture2D(u_baseTex, displacedUv).rgb;
    float sunGust = pow(max(0.0, sin(uv.x * 14.0 - u_time * 1.65 + uv.y * 6.0)), 3.0) * grassW;
    bgColor += vec3(0.028, 0.036, 0.012) * sunGust;

    vec3 finalColor = bgColor;
    finalColor = renderEyeSocket(
      uv, finalColor, u_leftBox, u_leftCenter, u_leftRadii, u_leftMaxShift,
      u_leftUpperY[0], u_leftUpperY[1], u_leftUpperY[2], u_leftUpperY[3], u_leftUpperY[4], u_leftUpperY[5],
      u_leftLowerY[0], u_leftLowerY[1], u_leftLowerY[2], u_leftLowerY[3], u_leftLowerY[4], u_leftLowerY[5],
      1.0
    );
    finalColor = renderEyeSocket(
      uv, finalColor, u_rightBox, u_rightCenter, u_rightRadii, u_rightMaxShift,
      u_rightUpperY[0], u_rightUpperY[1], u_rightUpperY[2], u_rightUpperY[3], u_rightUpperY[4], u_rightUpperY[5],
      u_rightLowerY[0], u_rightLowerY[1], u_rightLowerY[2], u_rightLowerY[3], u_rightLowerY[4], u_rightLowerY[5],
      0.0
    );
    finalOutput = vec4(finalColor, 1.0);
  }

  gl_FragColor = finalOutput;
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function createTextureFromSource(gl: WebGLRenderingContext, source: TexImageSource): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  return tex;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load asset: ${url}`));
    img.src = url;
  });
}

export const LiveWallpaperRenderer: React.FC<LiveWallpaperRendererProps> = ({
  rigConfig,
  gazeTargetRef,
  windIntensity = 1.0,
  eyelidFollowScale = 1.0,
  fitMode = 'cover',
  manualBlinkCounter = 0,
  paused = false,
  irisStyle = 'classic',
  onStatusUpdate,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const windIntensityRef = useRef(windIntensity);
  windIntensityRef.current = windIntensity;
  const eyelidFollowScaleRef = useRef(eyelidFollowScale);
  eyelidFollowScaleRef.current = eyelidFollowScale;
  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const irisStyleRef = useRef(irisStyle);
  irisStyleRef.current = irisStyle;
  const onStatusUpdateRef = useRef(onStatusUpdate);
  onStatusUpdateRef.current = onStatusUpdate;

  // Track manual external blink requests
  const blinkCountRef = useRef(manualBlinkCounter);
  const manualBlinkTriggerRef = useRef(false);
  useEffect(() => {
    if (manualBlinkCounter !== blinkCountRef.current) {
      blinkCountRef.current = manualBlinkCounter;
      manualBlinkTriggerRef.current = true;
    }
  }, [manualBlinkCounter]);

  // Ensure video element remains active and loaded so D3D11 surface is never evicted
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play().catch(() => {});
    }
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isCancelled = false;
    let rafId = 0;
    let sleepTimerCleanup = () => {};

    // Create high-performance WebGL context with transparent background
    const gl = (canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      }) ||
      canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      })) as WebGLRenderingContext | null;

    if (!gl) {
      setLoadError('WebGL is not supported in this browser context.');
      return;
    }

    let program: WebGLProgram | null = null;
    const textures: WebGLTexture[] = [];

    const initPipeline = async () => {
      try {
        // 1. Parallel texture loading
        const irisV2Src = (rigConfig.assets as any).irisLayerV2 || '/live-wallpaper/iris_layer_v2.png';
        const [baseImg, scleraImg, irisImg, irisImgV2, occluderImg, faceAnchorImg, windMaskImg] =
          await Promise.all([
            loadImageElement(rigConfig.assets.baseImage),
            loadImageElement(rigConfig.assets.scleraBase),
            loadImageElement(rigConfig.assets.irisLayer),
            loadImageElement(irisV2Src).catch(() => null),
            loadImageElement(rigConfig.assets.bangsAndFrameMask),
            loadImageElement(rigConfig.assets.faceAnchor),
            loadImageElement(rigConfig.assets.windMask),
          ]);

        if (isCancelled) return;

        // 2. Hardware background video layer
        const vid = videoRef.current;
        let activeBgVideo = false;
        if (vid) {
          activeBgVideo = true;
          vid.playbackRate = rigConfig.gazeDefaults.bgPlaybackRate || 0.75;
          vid.play().catch(() => {});
        }

        // 3. Compile WebGL Program
        const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
        program = gl.createProgram();
        if (!program) throw new Error('Failed to create WebGL program');
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error(`WebGL program link error: ${gl.getProgramInfoLog(program)}`);
        }
        gl.useProgram(program);

        // Fullscreen quad geometry
        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
          gl.STATIC_DRAW
        );
        const posLoc = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        // Upload static GPU textures once
        const baseTex = createTextureFromSource(gl, baseImg);
        const scleraTex = createTextureFromSource(gl, scleraImg);
        const irisTexClassic = createTextureFromSource(gl, irisImg);
        const irisTexV2 = irisImgV2 ? createTextureFromSource(gl, irisImgV2) : irisTexClassic;
        let activeIrisTex = irisStyleRef.current === 'focused' ? irisTexV2 : irisTexClassic;
        const occluderTex = createTextureFromSource(gl, occluderImg);
        const faceAnchorTex = createTextureFromSource(gl, faceAnchorImg);
        const windMaskTex = createTextureFromSource(gl, windMaskImg);
        textures.push(baseTex, scleraTex, irisTexClassic, irisTexV2, occluderTex, faceAnchorTex, windMaskTex);

        // Bind texture units
        const texMap: Record<string, WebGLTexture> = {
          u_baseTex: baseTex,
          u_scleraTex: scleraTex,
          u_irisTex: activeIrisTex,
          u_occluderTex: occluderTex,
          u_faceAnchorTex: faceAnchorTex,
          u_windMaskTex: windMaskTex,
        };
        const texNames = [
          'u_baseTex',
          'u_scleraTex',
          'u_irisTex',
          'u_occluderTex',
          'u_faceAnchorTex',
          'u_windMaskTex',
        ];
        texNames.forEach((name, unit) => {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, texMap[name]);
          gl.uniform1i(gl.getUniformLocation(program!, name), unit);
        });

        // Set static rig geometry uniforms
        const le = rigConfig.leftEye;
        const re = rigConfig.rightEye;
        gl.uniform2f(
          gl.getUniformLocation(program, 'u_imageSize'),
          rigConfig.resolution.width,
          rigConfig.resolution.height
        );
        gl.uniform4f(
          gl.getUniformLocation(program, 'u_leftBox'),
          le.socketBounds.xMin,
          le.socketBounds.yMin,
          le.socketBounds.xMax,
          le.socketBounds.yMax
        );
        gl.uniform2f(gl.getUniformLocation(program, 'u_leftCenter'), le.center[0], le.center[1]);
        gl.uniform2f(gl.getUniformLocation(program, 'u_leftRadii'), le.irisRadii[0], le.irisRadii[1]);
        gl.uniform2f(
          gl.getUniformLocation(program, 'u_leftMaxShift'),
          le.maxShiftNormalized[0],
          le.maxShiftNormalized[1]
        );
        for (let i = 0; i < 6; i++) {
          gl.uniform1f(gl.getUniformLocation(program, `u_leftUpperY[${i}]`), le.upperCurve[i][1]);
          gl.uniform1f(gl.getUniformLocation(program, `u_leftLowerY[${i}]`), le.lowerCurve[i][1]);
        }

        gl.uniform4f(
          gl.getUniformLocation(program, 'u_rightBox'),
          re.socketBounds.xMin,
          re.socketBounds.yMin,
          re.socketBounds.xMax,
          re.socketBounds.yMax
        );
        gl.uniform2f(gl.getUniformLocation(program, 'u_rightCenter'), re.center[0], re.center[1]);
        gl.uniform2f(gl.getUniformLocation(program, 'u_rightRadii'), re.irisRadii[0], re.irisRadii[1]);
        gl.uniform2f(
          gl.getUniformLocation(program, 'u_rightMaxShift'),
          re.maxShiftNormalized[0],
          re.maxShiftNormalized[1]
        );
        for (let i = 0; i < 6; i++) {
          gl.uniform1f(gl.getUniformLocation(program, `u_rightUpperY[${i}]`), re.upperCurve[i][1]);
          gl.uniform1f(gl.getUniformLocation(program, `u_rightLowerY[${i}]`), re.lowerCurve[i][1]);
        }

        // Cache dynamic uniform locations
        const uViewportLoc = gl.getUniformLocation(program, 'u_viewportSize');
        const uFitModeLoc = gl.getUniformLocation(program, 'u_fitMode');
        const uTimeLoc = gl.getUniformLocation(program, 'u_time');
        const uHasBgVideoLoc = gl.getUniformLocation(program, 'u_hasBgVideo');
        const uWindIntensityLoc = gl.getUniformLocation(program, 'u_windIntensity');
        const uGazeLoc = gl.getUniformLocation(program, 'u_gaze');
        const uBlinkLoc = gl.getUniformLocation(program, 'u_blink');
        const uLidFollowLoc = gl.getUniformLocation(program, 'u_lidFollow');

        setAssetsLoaded(true);

        // Smooth gaze state
        let currentGazeX = rigConfig.gazeDefaults.neutralEyeContactGaze[0];
        let currentGazeY = rigConfig.gazeDefaults.neutralEyeContactGaze[1];
        let sleepTimer = 0;
        sleepTimerCleanup = () => window.clearTimeout(sleepTimer);
        const startTimeMs = performance.now();
        let lastFrameTimeMs = startTimeMs;
        let frameCount = 0;
        let lastFpsReportMs = startTimeMs;

        // Autonomous organic blink controller
        const bState = {
          nextBlinkTimeMs: startTimeMs + 3200,
          blinkStartMs: 0,
          durationMs: rigConfig.gazeDefaults.blinkDurationMs || 150,
          inProgress: false,
          pendingDoubleBlink: false,
        };

        const renderLoop = (nowMs: number) => {
          if (isCancelled || !program) return;

          // Throttle when paused (locked screen / manual pause): reduce draw frequency but never blank out
          if (pausedRef.current) {
            lastFrameTimeMs = nowMs;
            sleepTimer = window.setTimeout(() => {
              rafId = requestAnimationFrame(renderLoop);
            }, 500);
            // Continue drawing frame so character and background never disappear
          } else if (vid && vid.paused) {
            vid.play().catch(() => {});
          }

          const dtSec = Math.min(0.1, Math.max(0.001, (nowMs - lastFrameTimeMs) / 1000.0));
          lastFrameTimeMs = nowMs;
          frameCount++;

          // Display resolution match
          const dpr = Math.min(2.5, Math.max(1.0, window.devicePixelRatio || 1.0));
          const displayW = Math.max(1, Math.round(canvas.clientWidth * dpr));
          const displayH = Math.max(1, Math.round(canvas.clientHeight * dpr));
          if (canvas.width !== displayW || canvas.height !== displayH) {
            canvas.width = displayW;
            canvas.height = displayH;
            gl.viewport(0, 0, displayW, displayH);
          }

          // Smooth gaze motion (60Hz exponential spring interpolation)
          const [targetGazeX, targetGazeY] = gazeTargetRef.current;
          const alpha = 1.0 - Math.exp(-14.0 * dtSec);
          currentGazeX += (targetGazeX - currentGazeX) * alpha;
          currentGazeY += (targetGazeY - currentGazeY) * alpha;

          // Organic Blink evaluation
          let blinkVal = 0.0;
          if (manualBlinkTriggerRef.current) {
            manualBlinkTriggerRef.current = false;
            bState.blinkStartMs = nowMs;
            bState.inProgress = true;
          } else if (!bState.inProgress && nowMs >= bState.nextBlinkTimeMs) {
            bState.blinkStartMs = nowMs;
            bState.inProgress = true;
          }

          if (bState.inProgress) {
            const elapsed = nowMs - bState.blinkStartMs;
            const dur = bState.durationMs;
            if (elapsed >= dur) {
              bState.inProgress = false;
              if (bState.pendingDoubleBlink) {
                bState.pendingDoubleBlink = false;
                bState.nextBlinkTimeMs = nowMs + 140;
              } else {
                const [minS, maxS] = rigConfig.gazeDefaults.blinkIntervalSec || [4.0, 7.0];
                const nextIntervalMs = (minS + Math.random() * (maxS - minS)) * 1000.0;
                bState.nextBlinkTimeMs = nowMs + nextIntervalMs;
                bState.pendingDoubleBlink = Math.random() < 0.16;
              }
              blinkVal = 0.0;
              bState.durationMs = rigConfig.gazeDefaults.blinkDurationMs || 150;
            } else {
              const phase = elapsed / dur;
              if (phase < 0.42) {
                const t = phase / 0.42;
                blinkVal = t * t * (3.0 - 2.0 * t);
              } else {
                const t = (phase - 0.42) / 0.58;
                const s = 1.0 - t;
                blinkVal = s * s * (3.0 - 2.0 * s);
              }
            }
          }

          // Dynamic Iris Style texture switch (Classic vs Focused)
          const desiredIrisTex = irisStyleRef.current === 'focused' ? irisTexV2 : irisTexClassic;
          if (activeIrisTex !== desiredIrisTex) {
            activeIrisTex = desiredIrisTex;
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, activeIrisTex);
          }

          // Clear transparent buffer for zero-overhead video passthrough
          gl.clearColor(0.0, 0.0, 0.0, 0.0);
          gl.clear(gl.COLOR_BUFFER_BIT);

          // Update dynamic uniforms
          gl.uniform2f(uViewportLoc, displayW, displayH);
          gl.uniform1f(uFitModeLoc, fitModeRef.current === 'contain' ? 1.0 : 0.0);
          gl.uniform1f(uTimeLoc, (nowMs - startTimeMs) / 1000.0);
          gl.uniform1f(uHasBgVideoLoc, activeBgVideo ? 1.0 : 0.0);
          gl.uniform1f(uWindIntensityLoc, windIntensityRef.current);
          gl.uniform2f(uGazeLoc, currentGazeX, currentGazeY);
          gl.uniform1f(uBlinkLoc, blinkVal);
          gl.uniform1f(
            uLidFollowLoc,
            (rigConfig.leftEye.eyelidWarpWeights.upperFollow || 0.30) * eyelidFollowScaleRef.current
          );

          // Render parametric eye rig
          gl.drawArrays(gl.TRIANGLES, 0, 6);

          // Status & telemetry updates
          if (nowMs - lastFpsReportMs >= 500) {
            const fps = Math.round((frameCount * 1000) / (nowMs - lastFpsReportMs));
            frameCount = 0;
            lastFpsReportMs = nowMs;
            onStatusUpdateRef.current?.({
              fps,
              usingBgVideo: activeBgVideo,
              usingEyeVideo: rigConfig.hasEyeVideo,
              isBlinking: blinkVal > 0.15,
            });
          }

          rafId = requestAnimationFrame(renderLoop);
        };

        rafId = requestAnimationFrame(renderLoop);
      } catch (err: any) {
        console.error('[LiveWallpaperRenderer] Initialization failed:', err);
        if (!isCancelled) {
          setLoadError(err?.message || 'Failed to initialize WebGL 2.5D Live Wallpaper');
        }
      }
    };

    initPipeline();

    return () => {
      isCancelled = true;
      sleepTimerCleanup();
      if (rafId) cancelAnimationFrame(rafId);
      textures.forEach((t) => gl.deleteTexture(t));
      if (program) gl.deleteProgram(program);
    };
  }, [rigConfig, gazeTargetRef]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden select-none">
      {/* Hardware-accelerated background video layer (D3D11 / NVDEC / QSV) */}
      <video
        ref={videoRef}
        src={rigConfig.assets.bgVideo}
        poster={rigConfig.assets.baseImage}
        loop
        muted
        playsInline
        autoPlay
        className="absolute inset-0 w-full h-full block pointer-events-none"
        style={{
          objectFit: fitMode === 'contain' ? 'contain' : 'cover',
        }}
      />

      {/* 2.5D WebGL Parametric Eye Rig Canvas */}
      <canvas
        ref={canvasRef}
        data-testid="live-wallpaper-canvas"
        className="absolute inset-0 w-full h-full block pointer-events-none"
        style={{
          objectFit: fitMode === 'contain' ? 'contain' : 'cover',
        }}
      />

      {/* Cinematic Artistic Intro Transition */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center bg-[#07090e] z-30 transition-all duration-700 pointer-events-none ${
          assetsLoaded ? 'opacity-0 scale-105' : 'opacity-100 scale-100'
        }`}
        style={{
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="flex flex-col items-center select-none">
          <div className="relative mb-4 flex items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500/20 via-blue-500/20 to-purple-500/20 border border-white/10 backdrop-blur-md flex items-center justify-center shadow-[0_0_30px_rgba(56,189,248,0.15)]">
              <span className="text-xl font-bold tracking-widest text-white/90 font-mono">A</span>
            </div>
            <div className="absolute inset-0 rounded-2xl border border-cyan-400/30 animate-pulse" />
          </div>
          <span className="text-white text-lg tracking-[0.35em] font-light uppercase font-['Space_Grotesk',sans-serif]">
            ANEMO
          </span>
          <div className="w-16 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent mt-2 mb-2" />
          <span className="text-[10px] tracking-[0.25em] text-white/40 uppercase font-mono">
            LIVE WALLPAPER
          </span>
        </div>
      </div>

      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-red-400 p-6 z-20">
          <p className="font-semibold text-base mb-1">Renderer Notice</p>
          <p className="text-xs text-gray-400 max-w-md text-center">{loadError}</p>
        </div>
      )}
    </div>
  );
};
