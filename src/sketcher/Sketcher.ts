import { EventEmitter } from "node:events";
import { lshTags, minHash, type Tags } from "./crypto.js";

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
  sketch: [data: { modality: string; modalityState: ModalityState }];
  expire: [data: { modality: string; oldTags: Tags; oldEpoch: string }];
}

export class Sketcher<T extends string = DefaultModalities> extends EventEmitter<SketcherEventMap> {
  private config: SketcherConfig<T>;
  private modalityState = new Map<T, ModalityState>();

  constructor(config?: SketcherConfig<T>) {
    super();
    this.config = config ?? DEFAULTCONFIG as SketcherConfig<T>;
  }

  public async sketch(modality: T, items: string[]) {
    const modalityConfig = this.config[modality];
    const epoch = this.calculateEpoch(modalityConfig.epochInterval);

    // If there's existing state for this modality, emit expire event for old tags
    // (they're being replaced by new sketch)
    const existingState = this.modalityState.get(modality);
    if (existingState) {
      // Clear old expiry timer
      if (existingState.expiryTimer) {
        clearTimeout(existingState.expiryTimer);
      }

      // Emit expire event for old tags
      this.emit('expire', {
        modality,
        oldTags: existingState.tags,
        oldEpoch: existingState.epoch
      });
    }

    // Calculate when tags expire (next epoch boundary)
    const intervalSeconds = this.parseIntervalSeconds(modalityConfig.epochInterval);
    const expiresAt = (parseInt(epoch) + intervalSeconds) * 1000;

    const salt = `${modality}:${epoch}`;
    const signature = await minHash(items, modalityConfig.k, salt);
    const tags = await lshTags(signature, modalityConfig.bands, salt, expiresAt);

    // Set timeout for exact expiry time
    const timeUntilExpiry = expiresAt - Date.now();
    const expiryTimer = setTimeout(() => {
      // Emit expire event and clean up
      const state = this.modalityState.get(modality);
      if (state && state.epoch === epoch) {
        this.emit('expire', {
          modality,
          oldTags: state.tags,
          oldEpoch: state.epoch
        });
        this.modalityState.delete(modality);
      }
    }, timeUntilExpiry);

    this.modalityState.set(modality, {
      signature,
      tags,
      epoch: epoch,
      items,
      expiryTimer
    });

    this.emit('sketch', {
      modality,
      modalityState: this.modalityState.get(modality)!
    });
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
    return parseInt(amount!) * SECONDS_PER_UNIT[unit as keyof typeof SECONDS_PER_UNIT];
  }

  public getTags(modality: T): Tags | undefined {
    const state = this.modalityState.get(modality);
    if (!state) return undefined;

    const currentEpoch = this.calculateEpoch(
      this.config[modality].epochInterval
    );
    if (state.epoch !== currentEpoch) return undefined;

    return state.tags;
  }

  public getSignature(modality: T): bigint[] | undefined {
    const state = this.modalityState.get(modality);
    if (!state) return undefined;

    const currentEpoch = this.calculateEpoch(
      this.config[modality].epochInterval
    );
    if (state.epoch !== currentEpoch) return undefined;

    return state.signature;
  }

  public getModalityState(modality: T): ModalityState | undefined {
    const state = this.modalityState.get(modality);
    if (!state) return undefined;

    const currentEpoch = this.calculateEpoch(
      this.config[modality].epochInterval
    );
    if (state.epoch !== currentEpoch) return undefined;

    return state;
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

  /**
   * Clean up all timers and resources
   * Should be called when Sketcher is no longer needed
   */
  public destroy(): void {
    // Clear all expiry timers
    for (const state of this.modalityState.values()) {
      if (state.expiryTimer) {
        clearTimeout(state.expiryTimer);
      }
    }
    // Clear all state
    this.modalityState.clear();
  }
}
