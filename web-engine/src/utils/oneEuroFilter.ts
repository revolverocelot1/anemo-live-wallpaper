/**
 * 1€ Filter (One-Euro Filter) for Adaptive Low-Latency Signal Smoothing
 * Reference: Casiez, Roussel, Vogel (CHI 2012) "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems"
 *
 * Eliminates webcam landmark micro-jitter at rest while keeping fast eye/head saccades responsive.
 */

class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;

  public filter(value: number, alpha: number): number {
    if (this.y === null || this.s === null) {
      this.s = value;
      this.y = value;
      return value;
    }
    this.s = alpha * value + (1.0 - alpha) * this.s;
    this.y = value;
    return this.s;
  }

  public hasLastRawValue(): boolean {
    return this.y !== null;
  }

  public lastRawValue(): number {
    return this.y ?? 0;
  }

  public reset(): void {
    this.y = null;
    this.s = null;
  }
}

export class OneEuroFilter1D {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xFilter: LowPassFilter;
  private dxFilter: LowPassFilter;
  private lastTimeMs: number | null = null;

  constructor(minCutoff = 1.15, beta = 0.045, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
  }

  private computeAlpha(cutoffHz: number, dtSec: number): number {
    const tau = 1.0 / (2.0 * Math.PI * cutoffHz);
    return 1.0 / (1.0 + tau / Math.max(1e-4, dtSec));
  }

  public filter(value: number, timestampMs: number): number {
    if (this.lastTimeMs === null) {
      this.lastTimeMs = timestampMs;
      this.dxFilter.filter(0, 1);
      return this.xFilter.filter(value, 1);
    }

    const dtSec = Math.max(0.001, Math.min(0.25, (timestampMs - this.lastTimeMs) / 1000.0));
    this.lastTimeMs = timestampMs;

    const dx = this.xFilter.hasLastRawValue()
      ? (value - this.xFilter.lastRawValue()) / dtSec
      : 0.0;

    const edx = this.dxFilter.filter(dx, this.computeAlpha(this.dCutoff, dtSec));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);

    return this.xFilter.filter(value, this.computeAlpha(cutoff, dtSec));
  }

  public reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTimeMs = null;
  }
}

export class OneEuroFilter2D {
  private filterX: OneEuroFilter1D;
  private filterY: OneEuroFilter1D;

  constructor(minCutoff = 1.15, beta = 0.045, dCutoff = 1.0) {
    this.filterX = new OneEuroFilter1D(minCutoff, beta, dCutoff);
    this.filterY = new OneEuroFilter1D(minCutoff, beta, dCutoff);
  }

  public filter(x: number, y: number, timestampMs: number): [number, number] {
    return [
      this.filterX.filter(x, timestampMs),
      this.filterY.filter(y, timestampMs),
    ];
  }

  public reset(): void {
    this.filterX.reset();
    this.filterY.reset();
  }
}
