import type { Tags } from "./crypto.js";

export interface SketchConfig {
  id: string;
  modality: string;
  epoch: string;
  expiresAt: number;
  tags: Tags;
  items: string[];
  signature: bigint[];
  createdAt: number;
}

export class Sketch {
  readonly id: string;
  readonly modality: string;
  readonly epoch: string;
  readonly expiresAt: number;
  readonly tags: Tags;
  readonly items: string[];
  readonly signature: bigint[];
  readonly createdAt: number;

  private expiryTimer?: ReturnType<typeof setTimeout>;

  constructor(config: SketchConfig) {
    this.id = config.id;
    this.modality = config.modality;
    this.epoch = config.epoch;
    this.expiresAt = config.expiresAt;
    this.tags = config.tags;
    this.items = config.items;
    this.signature = config.signature;
    this.createdAt = config.createdAt;
  }

  isValid(): boolean {
    return Date.now() < this.expiresAt;
  }

  setExpiryTimer(timer: ReturnType<typeof setTimeout>): void {
    this.expiryTimer = timer;
  }

  clearExpiryTimer(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
    }
  }
}