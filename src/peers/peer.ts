import type { PeerInfo } from '@libp2p/interface';
import type { PSIResult } from '../protocols/psi/index.js';
import type { Sketch } from '../sketcher/sketch.js';


export class ProximityPeer {
  readonly peerInfo: PeerInfo;

  // Map: sketchId → PSI result
  private psiResults = new Map<string, PSIResult>();

  // Map: sketchId → Sketch reference
  private sketches = new Map<string, Sketch>();

  // Generic metadata storage for protocol-specific data
  private metadata = new Map<string, any>();

  constructor(peerInfo: PeerInfo) {
    this.peerInfo = peerInfo;
  }

  /**
   * Set arbitrary metadata for this peer
   * @param key - Metadata key (e.g., "name", "avatar", etc.)
   * @param value - Metadata value
   */
  setMetadata(key: string, value: any): void {
    this.metadata.set(key, value);
  }

  /**
   * Get metadata by key
   * @param key - Metadata key
   * @returns The metadata value, or undefined if not set
   */
  getMetadata<T = any>(key: string): T | undefined {
    return this.metadata.get(key);
  }

  /**
   * Get all metadata as a plain object
   * @returns Record of all metadata key-value pairs
   */
  getAllMetadata(): Record<string, any> {
    return Object.fromEntries(this.metadata);
  }

  /**
   * Check if metadata exists for a key
   * @param key - Metadata key
   * @returns true if the key exists
   */
  hasMetadata(key: string): boolean {
    return this.metadata.has(key);
  }

  /**
   * Delete metadata by key
   * @param key - Metadata key
   * @returns true if deleted, false if key didn't exist
   */
  deleteMetadata(key: string): boolean {
    return this.metadata.delete(key);
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