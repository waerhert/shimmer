import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import type { Libp2p } from "libp2p";

/**
 * DHT-based peer discovery using rendezvous strings.
 * Equivalent to Go's drouting.NewRoutingDiscovery + dutil.Advertise
 */
export class DHTDiscovery {
  private rendezvousCID: CID | null = null;
  private advertiseInterval?: NodeJS.Timeout;
  private findPeersInterval?: NodeJS.Timeout;

  constructor(
    private node: Libp2p,
    private rendezvous: string
  ) {
    // CID will be initialized asynchronously
  }

  /**
   * Initialize the CID (must be called before other methods)
   */
  private async ensureInitialized(): Promise<CID> {
    if (!this.rendezvousCID) {
      // Create CID from rendezvous string (equivalent to Go's routing key)
      const rendezvousBytes = new TextEncoder().encode(this.rendezvous);
      const rendezvousHash = await sha256.digest(rendezvousBytes);
      this.rendezvousCID = CID.create(1, raw.code, rendezvousHash);
    }
    return this.rendezvousCID;
  }

  /**
   * Advertise this peer on the rendezvous namespace
   * Equivalent to Go's dutil.Advertise()
   */
  async advertise(): Promise<void> {
    const cid = await this.ensureInitialized();
    console.log('[DHTDiscovery] Starting advertise for CID:', cid.toString());
    try {
      let eventCount = 0;
      for await (const event of this.node.services.dht.provide(cid)) {
        eventCount++;
        console.log(`[DHTDiscovery] Provide event #${eventCount}:`, event.name);
      }
      console.log(`[DHTDiscovery] Advertise completed with ${eventCount} events`);
    } catch (err) {
      console.error('[DHTDiscovery] Failed to advertise on DHT:', err);
    }
  }

  /**
   * Find peers on the rendezvous namespace
   * Equivalent to Go's routingDiscovery.FindPeers()
   * Returns an async generator of peer IDs
   */
  async *findPeers(): AsyncGenerator<string> {
    const cid = await this.ensureInitialized();
    console.log('[DHTDiscovery] Finding providers for CID:', cid.toString());
    try {
      for await (const event of this.node.services.dht.findProviders(cid)) {
        if (event.name === 'PROVIDER') {
          console.log(`[DHTDiscovery] Found ${event.providers.length} providers`);
          for (const provider of event.providers) {
            if (!provider.id.equals(this.node.peerId)) {
              console.log('[DHTDiscovery] Discovered peer:', provider.id.toString());
              yield provider.id.toString();

              // Attempt to dial discovered peer
              try {
                await this.node.dial(provider.id);
              } catch (err) {
                console.log('[DHTDiscovery] Could not dial peer:', err);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[DHTDiscovery] Error during findPeers:', err);
    }
  }

  /**
   * Start periodic advertising and peer discovery
   * @param advertiseInterval - How often to re-advertise (milliseconds)
   * @param findPeersInterval - How often to search for peers (milliseconds)
   */
  async startPeriodicDiscovery(advertiseInterval = 60000, findPeersInterval = 15000): Promise<void> {
    // Ensure CID is initialized
    await this.ensureInitialized();

    console.log('[DHTDiscovery] Waiting for at least one connected peer...');
    // Wait for at least one peer before advertising (otherwise provide() yields no events)
    const waitForPeers = async () => {
      while (this.node.getPeers().length === 0) {
        console.log('[DHTDiscovery] No peers yet, waiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      console.log('[DHTDiscovery] Connected peers:', this.node.getPeers().length);
    };

    // Wait for peers, then do initial advertisement
    await waitForPeers();
    await this.advertise();

    // Periodic re-advertisement
    this.advertiseInterval = setInterval(() => {
      console.log('[DHTDiscovery] Periodic re-advertisement');
      this.advertise();
    }, advertiseInterval);

    // Periodic peer discovery
    const runFindPeers = async () => {
      console.log('[DHTDiscovery] Running periodic peer discovery');
      for await (const peerId of this.findPeers()) {
        console.log('[DHTDiscovery] Discovered peer via DHT:', peerId);
      }
    };

    // Initial peer search after short delay
    setTimeout(runFindPeers, 2000);

    // Periodic peer search
    this.findPeersInterval = setInterval(runFindPeers, findPeersInterval);
  }

  /**
   * Stop periodic discovery
   */
  stopPeriodicDiscovery(): void {
    if (this.advertiseInterval) {
      clearInterval(this.advertiseInterval);
      this.advertiseInterval = undefined;
    }
    if (this.findPeersInterval) {
      clearInterval(this.findPeersInterval);
      this.findPeersInterval = undefined;
    }
  }
}
