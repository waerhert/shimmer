import type { PeerInfo } from '@libp2p/interface';
import type { PSIResult } from '../psi/protocol.js';
import type { Sketch } from '../sketcher/sketch.js';


export class ProximityPeer {
  readonly peerInfo: PeerInfo;

  // Map: sketchId → PSI result
  private psiResults = new Map<string, PSIResult>();

  // Map: sketchId → Sketch reference
  private sketches = new Map<string, Sketch>();

  constructor(peerInfo: PeerInfo) {
    this.peerInfo = peerInfo;
  }

  addSketch(sketch: Sketch): void {
    this.sketches.set(sketch.id, sketch);
    this.cleanupOldSketches();  // Prevent unbounded growth
  }

  setPSIResult(sketch: Sketch, result: PSIResult): void {
    this.psiResults.set(sketch.id, result);
  }

  hasPSIFor(sketch: Sketch): boolean {
    return this.psiResults.has(sketch.id);
  }

  isClose(gracePeriodMs: number = 60000): boolean {
    // Close if discovered in ANY valid sketch OR recently expired sketch
    for (const sketch of this.sketches.values()) {
      if (sketch.isValid()) {
        return true;  // Valid sketch = definitely close
      }

      // Grace period: sketch expired recently?
      const timeSinceExpiry = Date.now() - sketch.expiresAt;
      if (timeSinceExpiry < gracePeriodMs) {
        return true;  // Within grace period (prevents flicker during re-sketching)
      }
    }
    return false;
  }

  private cleanupOldSketches(
    gracePeriodMs: number = 60000,
    maxSketches: number = 10
  ): void {
    const now = Date.now();

    // First pass: remove sketches expired beyond grace period
    for (const [id, sketch] of this.sketches) {
      const timeSinceExpiry = now - sketch.expiresAt;
      if (timeSinceExpiry > gracePeriodMs) {
        this.sketches.delete(id);
        this.psiResults.delete(id);
      }
    }

    // Second pass: if still too many, keep newest N
    if (this.sketches.size > maxSketches) {
      const sorted = Array.from(this.sketches.entries())
        .sort(([, a], [, b]) => b.expiresAt - a.expiresAt);

      // Remove oldest beyond limit
      for (let i = maxSketches; i < sorted.length; i++) {
        const [id] = sorted[i]!;  // Safe: i < sorted.length
        this.sketches.delete(id);
        this.psiResults.delete(id);
      }
    }
  }
}