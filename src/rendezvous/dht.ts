import type { PeerInfo } from "@libp2p/interface";
import type { Tags } from "../sketcher/crypto.js";
import type { RendezVous, PeerDiscoveryResult } from "./interface.js";
import { kadDHT } from "@libp2p/kad-dht";
import type { KadDHT, KadDHTComponents } from "@libp2p/kad-dht";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";

/**
 * Wait until a condition function returns true
 * @param func - Function to poll (should return boolean)
 * @param interval - Polling interval in milliseconds
 * @param timeout - Maximum time to wait in milliseconds
 * @throws Error if timeout is reached
 */
async function waitUntil(
  func: () => boolean,
  interval: number,
  timeout: number
): Promise<void> {
  const startTime = Date.now();

  while (!func()) {
    if (Date.now() - startTime >= timeout) {
      throw new Error(`waitUntil timeout after ${timeout}ms`);
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

export interface DHTRendezVousConfig {
  /**
   * DHT protocol prefix (default: '/shimmer/kad/1.0.0')
   * Use a custom prefix to create an isolated DHT network
   */
  protocol?: string;

  /**
   * How long provider records are valid in seconds (default: 300 = 5 minutes)
   *
   * Provider records older than this will be automatically cleaned up by the DHT.
   * Should match your epoch interval to ensure old tags expire naturally.
   *
   * Recommended: Match your epoch duration (300s for 5-minute epochs)
   */
  provideValidity?: number;

  /**
   * How often to re-announce provider records (default: 4 minutes = 240,000ms)
   *
   * Re-providing keeps current epoch tags fresh in the DHT.
   * Should be less than provideValidity to ensure records don't expire.
   *
   * Recommended: Set to slightly less than your epoch interval (e.g., 4 min for 5 min epochs)
   */
  refreshInterval?: number;

  /**
   * How often the DHT cleans up expired provider records in seconds (default: 60 = 1 minute)
   *
   * More frequent cleanup means faster removal of expired tags, but higher CPU usage.
   */
  cleanupInterval?: number;

  /**
   * Enable client mode (default: false)
   * If true, DHT won't act as a server (won't store records for others)
   */
  clientMode?: boolean;

  /**
   * Allow queries even when routing table has zero peers (default: false)
   * If false, DHT operations block until initial self-query completes (~1-6 seconds)
   * This ensures announces actually reach peers via the DHT network
   */
  allowQueryWithZeroPeers?: boolean;

  /**
   * PeerInfoMapper
   */
  peerInfoMapper?: (peerInfo: PeerInfo) => PeerInfo;
}

/**
 * DHTRendezVous - DHT-based rendezvous implementation
 *
 * Uses KadDHT provider records for decentralized peer discovery.
 * Creates an isolated private DHT with tuned TTL parameters for Shimmer's
 * epoch-based tags (5-minute default).
 *
 * Key differences from other RendezVous implementations:
 * - No encryption: DHT provider records are public
 * - Decentralized: No central server required
 * - Tuned TTLs: Short-lived records (5 min) vs standard DHT (48 hours)
 * - Isolated: Uses custom protocol prefix to avoid polluting public DHT
 *
 * Privacy model:
 * - publicTags are visible in DHT queries
 * - PeerInfo (ID + multiaddrs) visible in provider records
 * - Privacy comes from LSH collision probability, not encryption
 * - Challenge protocol (PSI) provides authentication
 */
export class DHTRendezVous implements RendezVous {
  private dht: KadDHT;
  private started = false;
  private components: KadDHTComponents;

  constructor(components: KadDHTComponents, config?: DHTRendezVousConfig) {
    const mergedConfig = {
      protocol: config?.protocol ?? '/shimmer/kad/1.0.0',
      provideValidity: config?.provideValidity ?? 300,  // 5 minutes (in seconds)
      refreshInterval: config?.refreshInterval ?? 240_000,  // 4 minutes (in ms)
      cleanupInterval: config?.cleanupInterval ?? 60,  // 1 minute (in seconds)
      clientMode: config?.clientMode ?? false,
      allowQueryWithZeroPeers: config?.allowQueryWithZeroPeers ?? false,
      peerInfoMapper: config?.peerInfoMapper ?? ((peerInfo) => peerInfo),
    };

    // Create DHT with Shimmer-tuned parameters
    this.dht = kadDHT({
      protocol: mergedConfig.protocol,
      clientMode: mergedConfig.clientMode,
      allowQueryWithZeroPeers: mergedConfig.allowQueryWithZeroPeers,
      peerInfoMapper: mergedConfig.peerInfoMapper,  // Pass through peerInfoMapper!

      // Provider record settings - tuned for Shimmer's epoch system
      providers: {
        provideValidity: mergedConfig.provideValidity,  // How long records are valid (5 min)
        cleanupInterval: mergedConfig.cleanupInterval,  // How often to clean expired records (1 min)
      },

      // Provider record reproviding - DISABLED for epoch-based tags
      // Shimmer uses tag rotation: old tags should expire, not be kept alive
      // Sketcher manually provides NEW tags each epoch instead
      reprovide: {
        interval: 60_000,  // Check every minute (for manual re-provides)
        threshold: 0,      // Don't auto-reprovide (Sketcher does it manually per epoch)
      },

      // Network positioning - query for own ID to maintain routing table health
      querySelfInterval: 30_000,  // 30 seconds
    })(components);

    this.components = components;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    // KadDHT implements Startable interface
    await (this.dht as any).start();
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    // KadDHT implements Startable interface
    await (this.dht as any).stop();
    this.started = false;
  }

  /**
   * Withdraw announcement for tags (stop being discoverable)
   * Cancels DHT provider records to stop re-announcing expired tags
   *
   * @param tags - The expired tags to withdraw
   */
  async withdraw(tags: Tags): Promise<void> {
    if (!this.started) {
      throw new Error('DHTRendezVous not started. Call start() first.');
    }

    for (const publicTag of tags.publicTags) {
      const cid = await tagToCID(publicTag);

      try {
        await this.dht.cancelReprovide(cid);
      } catch (err) {
        console.error(`Failed to cancel reprovide for CID ${cid.toString()} (tag ${publicTag}):`, err);
        // Continue canceling other tags even if one fails
      }
    }
  }

  async announce(
    tags: Tags,
    peerInfo: PeerInfo,
    expiresAt: number
  ): Promise<void> {
    if (!this.started) {
      throw new Error('DHTRendezVous not started. Call start() first.');
    }

    // Wait for at least one connected peer (like DHTDiscovery does)
    // This is simpler and more reliable than waiting for routing table
    //console.log('[DHTRendezVous] Waiting for at least one connected peer...');
    const checkConnected = () => this.components.connectionManager.getConnections().length > 0;
    await waitUntil(checkConnected, 1000, 10000);

    //console.log('[DHTRendezVous] Connected! Starting announces...');

    // Announce to all publicTags (ignore preImages - DHT is public)
    for (const publicTag of tags.publicTags) {
      const cid = await tagToCID(publicTag);

      try {
        //console.log(`[DHTRendezVous] Starting provide for tag: ${publicTag}, CID: ${cid.toString()}`);

        // DHT automatically includes our PeerInfo (id + multiaddrs) in provider record
        // provide() returns an async iterator - we need to consume it with timeout
        const signal = AbortSignal.timeout(15000); // 15 second timeout
        let eventCount = 0;

        for await (const event of this.dht.provide(cid, { signal })) {
          eventCount++;
          //console.log(`[DHTRendezVous] Provide event #${eventCount} for ${publicTag}:`, event.name);
        }

        //console.log(`[DHTRendezVous] Announced ${publicTag} (${eventCount} events)`);
      } catch (err) {
        console.error(`Failed to provide CID ${cid.toString()} for tag ${publicTag}:`, err);
        throw err;
      }
    }
  }

  async discover(tags: Tags): Promise<PeerDiscoveryResult[]> {
    if (!this.started) {
      throw new Error('DHTRendezVous not started. Call start() first.');
    }

    const results: PeerDiscoveryResult[] = [];

    // Search by publicTags (ignore preImages - DHT has no encryption)
    for (const publicTag of tags.publicTags) {
      const cid = await tagToCID(publicTag);

      try {
        // findProviders returns async iterator of QueryEvents
        // Use AbortSignal for 10 second timeout
        const signal = AbortSignal.timeout(10_000);

        for await (const event of this.dht.findProviders(cid, { signal })) {
          if (event.name === 'PROVIDER') {
            for (const provider of event.providers) {
              results.push({
                peerInfo: {
                  id: provider.id,
                  multiaddrs: provider.multiaddrs,
                },
                publicTag,
              });
            }
          }
        }
      } catch (error) {
        // console.error(`Failed to find providers for CID ${cid.toString()} (tag ${publicTag}):`, error);
        // Continue discovering other tags
        continue;
      }
    }

    return results;
  }

  /**
   * Get the underlying DHT instance (for advanced use cases)
   *
   * Warning: Direct DHT manipulation may interfere with RendezVous behavior
   */
  public getDHT(): KadDHT {
    return this.dht;
  }
}

/**
 * Convert a tag string to a CID for DHT operations
 *
 * Uses SHA-256 hash of the tag string to create a deterministic CID.
 * All peers searching for the same tag will generate the same CID.
 *
 * @param tag - The tag string to convert
 * @returns CID v1 with raw codec
 */
async function tagToCID(tag: string): Promise<CID> {
  const bytes = new TextEncoder().encode(tag);
  const hash = await sha256.digest(bytes);

  // Create CID v1 with raw codec (0x55) and sha256 hash
  return CID.createV1(raw.code, hash);
}
