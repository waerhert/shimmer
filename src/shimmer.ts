import type {
  PeerId,
  PeerInfo,
  Startable,
  PeerDiscovery,
  PeerDiscoveryEvents,
  Libp2p,
} from "@libp2p/interface";
import {
  peerDiscoverySymbol,
  serviceCapabilities,
  serviceDependencies,
} from "@libp2p/interface";
import type { RendezVous } from "./rendezvous/interface.js";
import { Sketcher, type SketcherConfig } from "./sketcher/Sketcher.js";
import { PSIProtocol } from "./psi/protocol.js";
import { TypedEventEmitter } from "@libp2p/interface";

// ShimmerComponents accepts any libp2p components
// This allows different rendezvous implementations to access what they need
export interface ShimmerComponents extends Record<string, any> {
  peerId: PeerId;
}

/**
 * PSI metadata stored in peerStore to track PSI completion state
 */
interface PSIMetadata {
  modality: string;
  epoch: string;
  timestamp: number;
  similarity: number;
  intersectionSize: number;
  totalItems: number;
  completed: boolean;
}

/**
 * RendezvousOption - Accept either a pre-instantiated RendezVous or a factory
 *
 * Pre-instantiated: For rendezvous that don't need libp2p components (memory, HTTP)
 * Factory: For rendezvous that need components (DHT)
 */
export type RendezvousOption = RendezVous | ((components: any) => RendezVous);

export interface ShimmerInit<T extends string = string> {
  /**
   * Rendezvous implementation - either instance or factory
   *
   * @example Pre-instantiated (memory)
   * rendezvous: new InMemoryEncryptedRendezVous()
   *
   * @example Pre-instantiated (HTTP)
   * rendezvous: new HTTPEncryptedRendezVous('http://localhost:8771')
   *
   * @example Factory (DHT - needs components)
   * rendezvous: (components) => new DHTRendezVous(components, { protocol: '/myapp/kad/1.0.0' })
   */
  rendezvous: RendezvousOption;

  /**
   * Sketcher configuration for different modalities
   *
   * @example
   * sketcherConfig: {
   *   words: { k: 128, bands: 16, epochInterval: '5m' },
   *   location: { k: 64, bands: 8, epochInterval: '10m' }
   * }
   */
  sketcherConfig?: SketcherConfig<T>;

  /**
   * Auto-announce on sketch events (default: true)
   * If true, automatically announces to rendezvous when sketch() is called
   */
  autoAnnounce?: boolean;

  /**
   * Auto-discover interval in milliseconds (default: undefined - no auto-discovery)
   * If set, periodically discovers peers for all active modalities
   */
  autoDiscoverInterval?: number;
}

export interface ShimmerEvents extends PeerDiscoveryEvents {
  "peer:discovered": CustomEvent<{
    peerInfo: PeerInfo;
    publicTag: string;
    modality: string;
  }>;
  "sketch:created": CustomEvent<{ modality: string }>;
  "announce:complete": CustomEvent<{ modality: string; tagCount: number }>;
}

/**
 * Shimmer - Privacy-preserving peer discovery service
 *
 * Uses locality-sensitive hashing (LSH) and epoch-based tags to enable
 * peers with similar content to discover each other without revealing
 * exact content to rendezvous servers or other peers.
 *
 * Integrates with libp2p as a pluggable service:
 *
 * @example Usage with libp2p
 * ```typescript
 * import { shimmer, httpRendezvous } from '@shimmer/core';
 * import { createLibp2p } from 'libp2p';
 *
 * const node = await createLibp2p({
 *   services: {
 *     shimmer: shimmer({
 *       rendezvous: httpRendezvous('http://localhost:8771')
 *     })
 *   }
 * });
 *
 * // Use shimmer
 * await node.services.shimmer.sketch('interests', ['music', 'art', 'coding']);
 * const peers = await node.services.shimmer.discover('interests');
 * ```
 */
export class Shimmer<T extends string = string>
  extends TypedEventEmitter<ShimmerEvents>
  implements Startable, PeerDiscovery
{
  private readonly components: ShimmerComponents;
  private readonly rendezvous: RendezVous;
  private readonly sketcher: Sketcher<T>;
  private readonly psiProtocol: PSIProtocol<T>;
  private readonly autoAnnounce: boolean;
  private readonly autoDiscoverInterval: number | undefined;
  private started = false;
  private discoveryTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    components: ShimmerComponents,
    init: Omit<ShimmerInit<T>, "rendezvous"> & { rendezvous: RendezVous }
  ) {
    super();

    this.components = components;
    this.rendezvous = init.rendezvous;
    this.sketcher = new Sketcher<T>(init.sketcherConfig);
    this.autoAnnounce = init.autoAnnounce ?? true;
    this.autoDiscoverInterval = init.autoDiscoverInterval;

    // Components is the libp2p instance - cast it to access protocol methods
    const node = components as unknown as Libp2p;
    this.psiProtocol = new PSIProtocol(node, this.sketcher);

    if (this.autoAnnounce) {
      this.sketcher.on("sketch", (event) => {
        const modality = event.modality as T;
        this.announce(modality).catch((err) => {
          console.error(
            `Auto-announce failed for modality '${modality}':`,
            err
          );
        });
      });
    }

    // Listen for epoch expiry to withdraw provider records and clean up PSI metadata
    this.sketcher.on("expire", (event) => {
      this.rendezvous.withdraw(event.oldTags).catch((err: any) => {
        console.error(
          `Failed to withdraw expired epoch '${event.oldEpoch}' in modality '${event.modality}':`,
          err
        );
      });

      // Clean up expired PSI metadata
      /*
      this.cleanupExpiredPSIMetadata(event.modality as T, event.oldEpoch).catch((err) => {
        console.error(`Failed to cleanup PSI metadata for ${event.modality}:`, err);
      });
      */
    });
  }

  readonly [Symbol.toStringTag] = "@shimmer/core";

  readonly [serviceCapabilities]: string[] = ["@libp2p/peer-discovery"];

  readonly [serviceDependencies]: string[] = [];

  get [peerDiscoverySymbol](): PeerDiscovery {
    return this;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    // Start rendezvous if it has a start method (e.g., DHTRendezVous)
    if (
      "start" in this.rendezvous &&
      typeof (this.rendezvous as any).start === "function"
    ) {
      await (this.rendezvous as any).start();
    }

    // Start auto-discovery timer if configured
    if (this.autoDiscoverInterval) {
      this.discoveryTimer = setInterval(() => {
        this.autoDiscover().catch((err) => {
          console.error("Error during auto-discovery:", err);
        });
      }, this.autoDiscoverInterval);
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    // Clear auto-discovery timer
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }

    // Stop rendezvous if it has a stop method
    if (
      "stop" in this.rendezvous &&
      typeof (this.rendezvous as any).stop === "function"
    ) {
      await (this.rendezvous as any).stop();
    }

    // Cleanup sketcher expiry timer
    this.sketcher.destroy();

    this.started = false;
  }

  /**
   * Create a sketch for a modality
   * Generates LSH tags from items for privacy-preserving similarity matching
   *
   * @param modality - The type of content (e.g., 'interests', 'location', 'playlist')
   * @param items - Array of items to sketch (e.g., ['music', 'art', 'coding'])
   *
   * @example
   * await shimmer.sketch('interests', ['music', 'art', 'coding']);
   */
  async sketch(modality: T, items: string[]): Promise<void> {
    await this.sketcher.sketch(modality, items);
    this.dispatchEvent(
      new CustomEvent("sketch:created", { detail: { modality } })
    );
  }

  /**
   * Manually announce current tags for a modality to rendezvous
   * Note: This happens automatically if autoAnnounce is true (default)
   *
   * @param modality - The modality to announce
   */
  async announce(modality: T): Promise<void> {
    const tags = this.sketcher.getTags(modality);
    if (!tags) {
      throw new Error(
        `No valid tags for modality ${modality}. Call sketch() first or check epoch expiry.`
      );
    }

    const peerInfo: PeerInfo = {
      id: this.components.peerId,
      multiaddrs: [], // TODO: Get from address manager
    };

    await this.rendezvous.announce(tags, peerInfo, tags.expiresAt);
    this.dispatchEvent(
      new CustomEvent("announce:complete", {
        detail: { modality, tagCount: tags.publicTags.length },
      })
    );
  }

  /**
   * Discover peers with similar content for a modality
   *
   * @param modality - The modality to discover peers for
   * @returns Array of discovered peers with their matching tags
   *
   * @example
   * const peers = await shimmer.discover('interests');
   * console.log(`Found ${peers.length} similar peers`);
   */
  async discover(
    modality: T
  ): Promise<Array<{ peerInfo: PeerInfo; publicTag: string }>> {
    const tags = this.sketcher.getTags(modality);
    if (!tags) {
      throw new Error(
        `No valid tags for modality ${modality}. Call sketch() first or check epoch expiry.`
      );
    }

    // Get current epoch for PSI metadata checking
    const currentEpoch = this.sketcher.getModalityState(modality)?.epoch;

    // dedup results, todo improve
    const seen: string[] = [];
    const results = await (await this.rendezvous.discover(tags)).filter(v => {
      if (seen.includes(v.peerInfo.id.toString())) {
        return false;
      }
      seen.push(v.peerInfo.id.toString());
      return true;
    })


    for (const result of results) {
      if (result.peerInfo.id.equals(this.components.peerId)) {
        continue;
      }

      // Merge peer into peerStore (handles deduplication and multiaddr merging)
      if (this.components.peerStore && result.peerInfo.multiaddrs.length > 0) {
        await this.components.peerStore.merge(result.peerInfo.id, {
          multiaddrs: result.peerInfo.multiaddrs,
        });
      }

      // Check if PSI should be initiated (checks peerStore metadata)
      const shouldInitiate = await this.shouldInitiatePSI(
        result.peerInfo.id,
        modality,
        currentEpoch
      );

      if (shouldInitiate) {
        // Emit 'peer' event - libp2p wires PeerDiscovery services to discovery system
        // Following libp2p convention: emit liberally, peerStore handles deduplication
        this.dispatchEvent(
          new CustomEvent("peer", {
            detail: result.peerInfo,
          })
        );

        // Emit Shimmer-specific event with additional metadata for PSI context
        this.dispatchEvent(
          new CustomEvent("peer:discovered", {
            detail: {
              peerInfo: result.peerInfo,
              publicTag: result.publicTag,
              modality,
            },
          })
        );

        // Initiate PSI with discovered peer
        this.initiatePSIWithPeer(result.peerInfo, modality).catch((err) => {
          console.error(
            `Failed to initiate PSI with ${result.peerInfo.id.toString()}:`,
            err
          );
        });
      }
    }

    return results;
  }

  /**
   * Initiate PSI handshake with a discovered peer
   * This is called automatically when peers are discovered
   */
  private async initiatePSIWithPeer(
    peerInfo: PeerInfo,
    modality: T
  ): Promise<void> {
    const psiResult = await this.psiProtocol.initiatePSI(peerInfo, modality);
  }

  /**
   * Check if PSI should be initiated with a peer
   * Returns false if PSI already completed for this peer/modality/epoch
   */
  private async shouldInitiatePSI(
    peerId: PeerId,
    modality: T,
    currentEpoch?: string
  ): Promise<boolean> {
    if (!this.components.peerStore) {
      return true; // No peerStore = always initiate
    }
    try {
      const peer = await this.components.peerStore.get(peerId);
      const metadataKey = `shimmer:psi:${modality}`;
      const metadataBytes = peer.metadata.get(metadataKey);

      if (!metadataBytes) {
        return true; // No metadata = never done PSI
      }

      // Decode metadata
      const metadataJson = new TextDecoder().decode(metadataBytes);
      const psiMetadata: PSIMetadata = JSON.parse(metadataJson);

      // Check if epoch matches (if epoch changed, we should redo PSI)
      if (currentEpoch && psiMetadata.epoch !== currentEpoch) {
        console.log(
          `[Shimmer] Epoch changed for ${peerId.toString()} (${
            psiMetadata.epoch
          } → ${currentEpoch}), re-running PSI`
        );
        return true;
      }

      // PSI already completed for this peer/modality/epoch
      console.log(
        `[Shimmer] PSI already completed with ${peerId.toString()} for ${modality} (${psiMetadata.similarity.toFixed(
          1
        )}%)`
      );
      return false;
    } catch (err) {
      // Peer not in store or metadata corrupted = initiate PSI
      return true;
    }
  }

  /**
   * Clean up expired PSI metadata when epoch changes
   */
  /*
  private async cleanupExpiredPSIMetadata(modality: T, expiredEpoch: string): Promise<void> {
    if (!this.components.peerStore) {
      return;
    }

    const metadataKey = `shimmer:psi:${modality}`;
    let cleanedCount = 0;

    try {
      // Iterate through all peers in the peerStore
      for await (const peer of this.components.peerStore.all()) {
        const metadataBytes = peer.metadata.get(metadataKey);
        if (!metadataBytes) continue;

        try {
          const metadata: PSIMetadata = JSON.parse(new TextDecoder().decode(metadataBytes));

          // If this metadata is for the expired epoch, remove it
          if (metadata.epoch === expiredEpoch) {
            await this.components.peerStore.merge(peer.id, {
              metadata: { [metadataKey]: undefined } // undefined removes the key
            });
            cleanedCount++;
          }
        } catch (err) {
          // Ignore parse errors for individual entries
        }
      }

      if (cleanedCount > 0) {
        console.log(`[Shimmer] Cleaned up ${cleanedCount} expired PSI metadata entries for ${modality}`);
      }
    } catch (err) {
      console.error(`[Shimmer] Failed to cleanup PSI metadata:`, err);
    }
  }
  */

  private async autoDiscover(): Promise<void> {
    const modalities = this.sketcher.getModalities() as T[];

    for (const modality of modalities) {
      try {
        await this.discover(modality);
      } catch (err) {
        // console.error(`Auto-discover failed for ${modality}:`, err);
      }
    }
  }
}

/**
 * Create a Shimmer service factory for libp2p
 *
 * @param init - Shimmer configuration
 * @returns Factory function that accepts libp2p components
 *
 * @example
 * ```typescript
 * const node = await createLibp2p({
 *   services: {
 *     shimmer: shimmer({
 *       rendezvous: httpRendezvous('http://localhost:8771'),
 *       sketcherConfig: {
 *         interests: { k: 128, bands: 16, epochInterval: '5m' }
 *       }
 *     })
 *   }
 * });
 * ```
 */
export function shimmer<T extends string = string>(init: ShimmerInit<T>) {
  return (components: ShimmerComponents): Shimmer<T> => {
    // Resolve rendezvous (call factory if needed, use instance otherwise)
    const rendezvous =
      typeof init.rendezvous === "function"
        ? init.rendezvous(components)
        : init.rendezvous;

    return new Shimmer(components, { ...init, rendezvous });
  };
}
