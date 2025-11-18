import type {
  PeerId,
  PeerInfo,
  Startable,
  PeerDiscovery,
  PeerDiscoveryEvents,
  PeerStore,
  ComponentLogger,
  Libp2pEvents,
} from "@libp2p/interface";
import type {
  AddressManager,
  Registrar,
  ConnectionManager,
} from "@libp2p/interface-internal";
import type { TypedEventTarget } from "main-event";
import {
  peerDiscoverySymbol,
  serviceCapabilities,
  serviceDependencies,
} from "@libp2p/interface";
import type { RendezVous } from "./rendezvous/interface.js";
import { Sketcher, type SketcherConfig } from "./sketcher/sketcher.js";
import { PSIProtocol } from "./protocols/psi/psi.js";
import type { PSIResult } from "./protocols/psi/index.js";
import { Name } from "./protocols/name/name.js";
import type { NameInit } from "./protocols/name/index.js";
import { TypedEventEmitter } from "@libp2p/interface";
import { PeerRegistry } from "./peers/registry.js";
import { ProximityPeer } from "./peers/peer.js";
import type { Sketch } from "./sketcher/sketch.js";
import { WebRTC } from "@multiformats/multiaddr-matcher";
import type { Ping } from "@libp2p/ping";

/**
 * ShimmerComponents - Explicit libp2p components needed by Shimmer
 */
export interface ShimmerComponents {
  ping: Ping;
  peerId: PeerId;
  addressManager: AddressManager;
  peerStore: PeerStore;
  registrar: Registrar;
  connectionManager: ConnectionManager;
  events: TypedEventTarget<Libp2pEvents>;
  logger: ComponentLogger;
}

/**
 * RendezvousOption - Accept either a pre-instantiated RendezVous or a factory
 *
 * Pre-instantiated: For rendezvous that don't need libp2p components (memory, HTTP)
 * Factory: For rendezvous that need components (DHT)
 */
export type RendezvousOption =
  | RendezVous
  | ((components: ShimmerComponents) => RendezVous);

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
   * Name protocol configuration
   * Enables peer name exchange
   *
   * @example
   * nameInit: { name: 'Alice', runOnConnectionOpen: true }
   */
  nameInit?: NameInit;

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
    peer: ProximityPeer;
    sketch: Sketch;
  }>;
  "peer:psi:complete": CustomEvent<{
    peer: ProximityPeer;
    sketch: Sketch;
    result: PSIResult;
  }>;
  "peer:name:discovered": CustomEvent<{
    peer: ProximityPeer;
    name: string;
  }>;
  "sketch:created": CustomEvent<{ modality: string; sketch: Sketch }>;
  "sketch:expired": CustomEvent<{ modality: string; sketch: Sketch }>;
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
  private readonly nameProtocol?: Name;
  private readonly peerRegistry: PeerRegistry;
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
    this.peerRegistry = new PeerRegistry();
    this.autoAnnounce = init.autoAnnounce ?? true;
    this.autoDiscoverInterval = init.autoDiscoverInterval;

    setInterval(() => {
      const peers = this.peerRegistry.getPeers();
      const loggable = peers.map((peer) => {
        const sketchesMap = (peer as any).sketches as Map<string, Sketch>;
        const psiResultsMap = (peer as any).psiResults as Map<string, any>;

        return {
          peerId: peer.peerInfo.id.toString(),
          multiaddrs: peer.peerInfo.multiaddrs.map((ma) => ma.toString()),
          isClose: peer.isClose(),
          name: peer.getMetadata('name'),
          sketches: Array.from(sketchesMap.entries()).map(([id, sketch]) => ({
            id,
            modality: sketch.modality,
            epoch: sketch.epoch,
            expiresAt: sketch.expiresAt,
            itemCount: sketch.items.length,
            isValid: sketch.isValid(),
          })),
          psiResults: Array.from(psiResultsMap.entries()).map(
            ([sketchId, result]) => ({
              sketchId,
              similarity: result.similarity,
              intersectionSize: result.intersectionSize,
              totalItems: result.totalItems,
              completedAt: result.completedAt,
            })
          ),
        };
      });
      console.log("[Shimmer] Peers:", JSON.stringify(loggable, null, 2));
    }, 4000);

    // Pass components directly to PSIProtocol
    this.psiProtocol = new PSIProtocol(components, this.sketcher);

    // Listen for PSI completion events
    this.psiProtocol.addEventListener("psi:complete", (event) => {
      const { peer, sketch, result } = event.detail;
      // Add peer to registry and store PSI result
      const registeredPeer = this.peerRegistry.addPeer(peer.peerInfo, sketch);
      registeredPeer.setPSIResult(sketch, result);

      // Emit public event for external consumers
      this.dispatchEvent(
        new CustomEvent("peer:psi:complete", {
          detail: { peer: registeredPeer, sketch, result },
        })
      );
    });

    // Initialize Name protocol if configured
    if (init.nameInit) {
      this.nameProtocol = new Name(this.components, init.nameInit);

      // Listen for name discovery events
      this.nameProtocol.addEventListener("name:discovered", async (event) => {
        const { peerInfo, name } = event.detail;

        // Get or create peer in registry
        let peer = this.peerRegistry.getPeer(peerInfo.id);
        if (!peer) {
          peer = this.peerRegistry.addPeer(peerInfo, undefined);
        }

        // Store name in peer metadata
        peer.setMetadata("name", name);

        // Emit Shimmer-level event
        this.dispatchEvent(
          new CustomEvent("peer:name:discovered", {
            detail: { peer, name },
          })
        );
      });
    }

    // Auto-announce when sketch is created
    if (this.autoAnnounce) {
      this.sketcher.addEventListener("sketch", (event) => {
        const { sketch } = event.detail;
        this.announceSketch(sketch).catch((err) => {
          console.error(`Auto-announce failed for sketch '${sketch.id}':`, err);
        });
      });
    }

    // Auto-withdraw when sketch expires
    this.sketcher.addEventListener("expire", (event) => {
      const { modality, sketch } = event.detail;
      this.rendezvous.withdraw(sketch.tags).catch((err: any) => {
        console.error(`Failed to withdraw expired sketch '${sketch.id}':`, err);
      });

      // Cleanup peers (respects 60s grace period)
      this.peerRegistry.cleanup();

      // Emit public event for external consumers
      this.dispatchEvent(
        new CustomEvent("sketch:expired", {
          detail: { modality, sketch },
        })
      );
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

    // Start PSI protocol
    await this.psiProtocol.start();

    // Start Name protocol if configured
    if (this.nameProtocol) {
      await this.nameProtocol.start();
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

    // Stop PSI protocol
    await this.psiProtocol.stop();

    // Stop Name protocol if configured
    if (this.nameProtocol) {
      await this.nameProtocol.stop();
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
  async sketch(modality: T, items: string[]): Promise<Sketch> {
    const sketch = await this.sketcher.sketch(modality, items);
    this.dispatchEvent(
      new CustomEvent("sketch:created", { detail: { modality, sketch } })
    );
    return sketch;
  }

  /**
   * Announce a sketch to the rendezvous
   * Internal helper used by auto-announce
   */
  private async announceSketch(sketch: Sketch): Promise<void> {
    const peerInfo: PeerInfo = {
      id: this.components.peerId,
      multiaddrs: this.components.addressManager.getAddresses(),
      //.filter((ma) => WebRTC.matches(ma)),
    };

    if (peerInfo.multiaddrs.length === 0) {
      throw new Error("Announcing ourself with empty multiaddrs!");
    }

    console.log("ANNONCING", sketch.tags.publicTags[0]);
    await this.rendezvous.announce(sketch.tags, peerInfo, sketch.expiresAt);
    this.dispatchEvent(
      new CustomEvent("announce:complete", {
        detail: {
          modality: sketch.modality,
          tagCount: sketch.tags.publicTags.length,
        },
      })
    );
  }

  /**
   * Manually announce current tags for a modality to rendezvous
   * Note: This happens automatically if autoAnnounce is true (default)
   *
   * @param modality - The modality to announce
   */
  async announce(modality: T): Promise<void> {
    const sketch = this.sketcher.getCurrentSketch(modality);
    if (!sketch) {
      throw new Error(
        `No valid sketch for modality ${modality}. Call sketch() first or check epoch expiry.`
      );
    }

    await this.announceSketch(sketch);
  }

  /**
   * Discover peers with similar content for a modality
   *
   * @param modality - The modality to discover peers for
   * @returns Array of discovered proximity peers
   *
   * @example
   * const peers = await shimmer.discover('interests');
   * console.log(`Found ${peers.length} similar peers`);
   */
  async discover(modality: T): Promise<ProximityPeer[]> {
    // SNAPSHOT: Get sketch once
    const sketch = this.sketcher.getCurrentSketch(modality);
    if (!sketch) {
      throw new Error(
        `No valid sketch for modality ${modality}. Call sketch() first or check epoch expiry.`
      );
    }

    // Discover peers using sketch tags
    const rawResults = await this.rendezvous.discover(sketch.tags);

    console.log("RAW", { rawResults: rawResults.length });

    const peers: ProximityPeer[] = [];
    const seen = new Set<string>();

    for (const result of rawResults) {
      // Validate results
      if (!result.peerInfo.id) {
        console.log("Found raw result but has no id");
        continue;
      }

      if (
        !result.peerInfo.multiaddrs ||
        !Array.isArray(result.peerInfo.multiaddrs)
      ) {
        console.log("Found raw result but has no multiaddrs");

        continue;
      }

      if (
        Array.isArray(result.peerInfo.multiaddrs) &&
        result.peerInfo.multiaddrs.length === 0
      ) {
        console.log("Found raw discovery result but multiaddrs is empty");
        continue;
      }

      // Skip self
      if (result.peerInfo.id.equals(this.components.peerId)) {
        continue;
      }

      // Deduplicate by peer ID
      const key = result.peerInfo.id.toString();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      // Merge into peerStore if available
      if (this.components.peerStore && result.peerInfo.multiaddrs.length > 0) {
        await this.components.peerStore.merge(result.peerInfo.id, {
          multiaddrs: result.peerInfo.multiaddrs,
        });
      }

      // Add to peer registry (creates or updates ProximityPeer)
      const peer = this.peerRegistry.addPeer(result.peerInfo, sketch);
      peers.push(peer);

      try {
        for (const addr of result.peerInfo.multiaddrs) {
          console.log("Pinging ", addr.toString());
          const signal = AbortSignal.timeout(10000);
          console.log(result.peerInfo.multiaddrs.map((x) => x.toString()));
          await this.components.ping
            .ping(addr, {
              signal,
            })
            .then((rtt) => {
              console.log(
                `[Shimmer] Pinged ${result.peerInfo.id.toString()} with RTT = ${rtt}`
              );
            });
        }
      } catch (err) {
        console.log(err);
        //throw err;
      }

      // Emit libp2p 'peer' event for discovery system
      this.dispatchEvent(
        new CustomEvent("peer", {
          detail: result.peerInfo,
        })
      );

      // Emit Shimmer-specific event
      this.dispatchEvent(
        new CustomEvent("peer:discovered", {
          detail: { peer, sketch },
        })
      );


      // TODO: Should we really do this on every discover ??
      // Maybe only do this is we dont have name or PSIresult anymore
      // or if their records ahve expired ??
      this.nameProtocol?.name(peer.peerInfo.id);

      // Initiate PSI if not already done for this sketch
      if (!peer.hasPSIFor(sketch)) {
        // First, ensure we're connected to the peer (dial if needed)
        // This will establish the relay connection and trigger WebRTC upgrade
        this.ensureConnectionAndPSI(peer, sketch).catch((err: any) => {
          console.error(
            `Failed to initiate PSI with ${result.peerInfo.id.toString()}:`,
            err
          );
        });
      }
    }

    return peers;
  }

  // TODO REVIEW THIS
  /**
   * Ensure we're connected to the peer, then initiate PSI
   * This dials the peer first to establish connection and trigger WebRTC upgrade
   */
  private async ensureConnectionAndPSI(
    peer: ProximityPeer,
    sketch: Sketch
  ): Promise<void> {
    const peerId = peer.peerInfo.id;

    const signal = AbortSignal.timeout(5000);
    const rtt = await this.components.ping.ping(peer.peerInfo.multiaddrs, {
      signal,
    });

    console.log(`[Shimmer] Pinged ${peerId.toString()} with RTT = ${rtt}`);

    // Check if we already have a connection
    const existingConns =
      this.components.connectionManager.getConnections(peerId);

    if (existingConns.length === 0) {
      console.log(
        `[Shimmer] Dialing ${peerId.toString()} to establish connection...`
      );

      try {
        // Dial the peer using their multiaddrs from peerInfo
        // This will establish the relay connection first
        await this.components.connectionManager.openConnection(
          peer.peerInfo.multiaddrs
        );
        console.log(
          `[Shimmer] Relay connection established to ${peerId.toString()}`
        );
      } catch (err) {
        console.log("[Shimmer] Failed to dial peer");
      }
    }

    // Now initiate PSI - the waitForDirectConnection in PSI protocol will handle WebRTC upgrade
    await this.psiProtocol.initiatePSI(peer, sketch);
  }

  /**
   * Check if a peer is currently considered close
   * Uses 60s grace period to prevent flickering
   */
  isPeerClose(peerId: PeerId): boolean {
    return this.peerRegistry.getPeer(peerId)?.isClose() ?? false;
  }

  /**
   * Get a proximity peer by ID
   */
  getPeer(peerId: PeerId): ProximityPeer | undefined {
    return this.peerRegistry.getPeer(peerId);
  }

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
