import { TypedEventEmitter } from "main-event";
import { LSH, minHash, type Tags } from "./lsh.js";
import { Sketch } from "./sketch.js";

export interface ModalityConfig {
  k: number; // number of hashfunctions in minhash
  bands: number; // number of bands in LSH
  epochInterval: string; // '5m'
}

export type DefaultModalities = "wifi" | "words" | "bluetooth";
export type SketcherConfig<T extends string = DefaultModalities> = Record<
  T,
  ModalityConfig
>;

export const DEFAULTCONFIG = {
  wifi: { k: 128, bands: 32, epochInterval: "5m" },
  words: { k: 64, bands: 32, epochInterval: "10m" },
  bluetooth: { k: 96, bands: 32, epochInterval: "5m" },
} as SketcherConfig;

/**
 * Optional improvements:
Validation: Add check that k is divisible by bands in constructor
Empty items: Consider behavior when items array is empty (currently would produce signature of all max values)
 */

export interface ModalityState {
  signature: bigint[];
  tags: Tags;
  epoch: string;
  items: string[];
  expiryTimer?: ReturnType<typeof setTimeout>;
}

interface SketcherEventMap {
  sketch: CustomEvent<{ modality: string; sketch: Sketch }>;
  expire: CustomEvent<{ modality: string; sketch: Sketch }>;
}

export class Sketcher<
  T extends string = DefaultModalities
> extends TypedEventEmitter<SketcherEventMap> {
  private config: SketcherConfig<T>;
  private sketches = new Map<T, Sketch>(); // Changed

  constructor(config?: SketcherConfig<T>) {
    super();
    this.config = config ?? (DEFAULTCONFIG as SketcherConfig<T>);


  }

  public async sketch(modality: T, items: string[]) {
    const existing = this.sketches.get(modality);
    if (existing) {
      this.dispatchEvent(
        new CustomEvent("expire", { detail: { modality, sketch: existing } })
      );
      existing.clearExpiryTimer();
    }

    const modalityConfig = this.config[modality];
    const epoch = this.calculateEpoch(modalityConfig.epochInterval);

    // Calculate when tags expire (next epoch boundary)
    const intervalSeconds = this.parseIntervalSeconds(
      modalityConfig.epochInterval
    );
    const expiresAt = (parseInt(epoch) + intervalSeconds) * 1000;
    const salt = `${modality}:${epoch}`;
    const signature = await minHash(items, modalityConfig.k, salt);
    const tags = await LSH(
      signature,
      modalityConfig.bands,
      salt,
      expiresAt
    );

    // Create Sketch
    const sketch = new Sketch({
      id: crypto.randomUUID(),
      modality,
      epoch,
      expiresAt,
      tags,
      items,
      signature,
      createdAt: Date.now(),
    });

    // Timer
    const timer = setTimeout(() => {
      const current = this.sketches.get(modality);
      if (current === sketch) {
        this.dispatchEvent(
          new CustomEvent("expire", { detail: { modality, sketch } })
        );
        this.sketches.delete(modality);
      }
    }, expiresAt - Date.now());

    sketch.setExpiryTimer(timer);
    this.sketches.set(modality, sketch);
    this.dispatchEvent(
      new CustomEvent("sketch", { detail: { modality, sketch } })
    );

    return sketch;
  }

  private parseIntervalSeconds(interval: string): number {
    const SECONDS_PER_UNIT = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    } as const;

    const regex = /^(\d+)(s|m|h|d)$/;
    const match = regex.exec(interval);

    if (!match) {
      throw new Error(
        `Invalid interval format. Expected format like '5m' or '30s', but got '${interval}'`
      );
    }

    const [, amount, unit] = match;
    return (
      parseInt(amount!) *
      SECONDS_PER_UNIT[unit as keyof typeof SECONDS_PER_UNIT]
    );
  }

  getCurrentSketch(modality: T): Sketch | undefined {
    const sketch = this.sketches.get(modality);
    return sketch?.isValid() ? sketch : undefined;
  }

  public calculateEpoch(interval: string): string {
    const SECONDS_PER_UNIT = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    } as const;

    const regex = /^(\d+)(s|m|h|d)$/;
    const match = regex.exec(interval);

    if (!match) {
      throw new Error(
        `Invalid interval format. Expected format like '5m' or '30s', but got '${interval}'`
      );
    }

    const [, amount, unit] = match;
    const intervalSeconds =
      parseInt(amount!) *
      SECONDS_PER_UNIT[unit as keyof typeof SECONDS_PER_UNIT];

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const remainder = currentTimestamp % intervalSeconds;
    const alignedEpoch = currentTimestamp - remainder;

    return alignedEpoch.toString();
  }

  public getModalities() {
    return Object.keys(this.config);
  }

  public destroy(): void {
    // Clear all expiry timers from sketches
    for (const sketch of this.sketches.values()) {
      sketch.clearExpiryTimer();
    }
    this.sketches.clear();
  }
}
