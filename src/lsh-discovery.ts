import type { Libp2p } from "libp2p";
import { Sketcher } from "./sketcher.js";
import type { ModalityState } from "./sketcher.js";
import { tagToCID } from "./p2p.js";

export interface LSHDiscoveryOptions {
  autoAnnounce?: boolean; // Default: true
  autoDiscover?: boolean; // Default: true
  announceInterval?: number; // Re-announce interval (ms), default: 60000
  discoverInterval?: number; // Discovery interval (ms), default: 15000
  onPeerDiscovered?: (peer: PeerDiscovery) => void; // Callback for discovered peers
}

export interface PeerDiscovery {
  peerId: string;
  modality: string;
  tag: string;
  timestamp: number;
}

interface ModalityDiscoveryState {
  modality: string;
  tagCIDs: Array<{ tag: string; cid: any }>;
  epoch: string;
  lastAnnounced?: number;
  lastDiscovered?: number;
}

/**
 * LSHDiscovery - Automatic DHT-based peer discovery using LSH tags from Sketcher
 *
 * Listens to Sketcher events and automatically announces/discovers peers based on LSH tags.
 * Provides both automatic and manual control over announcement and discovery.
 */
export class LSHDiscovery {
  private node: Libp2p;
  private sketcher: Sketcher;
  private options: Required<LSHDiscoveryOptions>;
  private modalityStates = new Map<string, ModalityDiscoveryState>();
  private announceInterval?: ReturnType<typeof setTimeout>;
  private discoverInterval?: ReturnType<typeof setTimeout>;
  private isStarted = false;

  constructor(
    node: Libp2p,
    sketcher: Sketcher,
    options: LSHDiscoveryOptions = {}
  ) {
    this.node = node;
    this.sketcher = sketcher;
    this.options = {
      autoAnnounce: options.autoAnnounce ?? true,
      autoDiscover: options.autoDiscover ?? true,
      announceInterval: options.announceInterval ?? 60000,
      discoverInterval: options.discoverInterval ?? 15000,
      onPeerDiscovered: options.onPeerDiscovered ?? (() => {}),
    };

    // Listen to Sketcher events
    if (this.options.autoAnnounce || this.options.autoDiscover) {
      this.sketcher.on("sketch", this.handleSketchEvent.bind(this));
    }
  }

  private async handleSketchEvent({
    modality,
    modalityState,
  }: {
    modality: string;
    modalityState: ModalityState;
  }): Promise<void> {
    // Convert tags to CIDs
    const tagCIDs = await Promise.all(
      modalityState.tags.publicTags.map(async (tag) => ({
        tag,
        cid: await tagToCID(tag),
      }))
    );

    // Store discovery state
    this.modalityStates.set(modality, {
      modality,
      tagCIDs,
      epoch: modalityState.epoch,
    });

    // Auto-announce if enabled and started
    if (this.options.autoAnnounce && this.isStarted) {
      await this.announceModality(modality);
    }
  }

  private async announceModality(modality: string): Promise<void> {
    const state = this.modalityStates.get(modality);
    if (!state) return;

    // Check if this modality's epoch is still current
    const currentEpoch = this.sketcher.calculateEpoch(
      (this.sketcher as any).config[modality].epochInterval
    );

    if (state.epoch !== currentEpoch) {
      // Epoch has rotated - remove this stale state
      this.modalityStates.delete(modality);
      console.log(`[LSHDiscovery] Removed stale epoch state for ${modality}`);
      return;
    }

    // Announce all tags in parallel
    await Promise.allSettled(
      state.tagCIDs.map(async ({ tag, cid }) => {
        try {
          for await (const _ of (this.node.services.dht as any).provide(cid)) {
            // Consume events to complete announcement
          }
          console.log(`[LSHDiscovery] Announced tag for ${modality}: ${tag}`);
        } catch (err) {
          console.error(`[LSHDiscovery] Failed to announce ${tag}:`, err);
        }
      })
    );

    state.lastAnnounced = Date.now();
  }

  private async discoverPeers(): Promise<void> {
    for (const [modality, state] of this.modalityStates) {
      // Check if this modality's epoch is still current
      const currentEpoch = this.sketcher.calculateEpoch(
        (this.sketcher as any).config[modality].epochInterval
      );

      if (state.epoch !== currentEpoch) {
        // Epoch has rotated - remove this stale state
        this.modalityStates.delete(modality);
        console.log(`[LSHDiscovery] Removed stale epoch state for ${modality} during discovery`);
        continue;
      }

      // Fire-and-forget parallel searches for all tags
      state.tagCIDs.forEach(({ tag, cid }) => {
        (async () => {
          try {
            for await (const event of (
              this.node.services.dht as any
            ).findProviders(cid)) {
              if (event.name === "PROVIDER") {
                for (const provider of event.providers) {
                  if (!provider.id.equals(this.node.peerId)) {
                    const discovery: PeerDiscovery = {
                      peerId: provider.id.toString(),
                      modality,
                      tag,
                      timestamp: Date.now(),
                    };
                    this.options.onPeerDiscovered(discovery);
                  }
                }
              }
            }
          } catch (err) {
            // Timeout or error - that's fine, tag wasn't found
          }
        })();
      });

      state.lastDiscovered = Date.now();
    }
  }

  /**
   * Start automatic announcement and discovery
   * Waits for at least one peer connection before beginning
   */
  public async start(): Promise<void> {
    if (this.isStarted) {
      console.warn("[LSHDiscovery] Already started");
      return;
    }

    // Wait for peers before starting
    while (this.node.getPeers().length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.isStarted = true;

    // Announce all existing modalities
    if (this.options.autoAnnounce) {
      for (const modality of this.modalityStates.keys()) {
        await this.announceModality(modality);
      }

      // Periodic re-announcement
      this.announceInterval = setInterval(() => {
        for (const modality of this.modalityStates.keys()) {
          this.announceModality(modality);
        }
      }, this.options.announceInterval);
    }

    // Start periodic discovery
    if (this.options.autoDiscover) {
      setTimeout(() => this.discoverPeers(), 2000);
      this.discoverInterval = setInterval(
        () => this.discoverPeers(),
        this.options.discoverInterval
      );
    }
  }

  /**
   * Stop automatic announcement and discovery
   */
  public stop(): void {
    this.isStarted = false;

    if (this.announceInterval) {
      clearInterval(this.announceInterval);
      delete this.announceInterval;
    }
    if (this.discoverInterval) {
      clearInterval(this.discoverInterval);
      delete this.discoverInterval;
    }
  }

  /**
   * Manually announce all modalities (regardless of autoAnnounce setting)
   */
  public async announceAll(): Promise<void> {
    for (const modality of this.modalityStates.keys()) {
      await this.announceModality(modality);
    }
  }
}
