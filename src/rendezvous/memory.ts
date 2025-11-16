import type { PeerInfo } from "@libp2p/interface";
import type { Tags } from "../sketcher/crypto.js";
import type { RendezVous, PeerDiscoveryResult } from "./interface.js";


export class InMemoryRendezVous implements RendezVous {
  // tag → peerId → {peerInfo, expiresAt}
  private registry = new Map<
    string,
    Map<
      string, {
        peerInfo: PeerInfo;
        expiresAt: number;
      }
    >
  >();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Cleanup expired entries every 30 seconds
    this.cleanupTimer = setInterval(() => this.cleanup(), 30000);
  }

  public async announce(
    tags: Tags,
    peerInfo: PeerInfo,
    expiresAt: number
  ): Promise<void> {
    const peerId = peerInfo.id.toString();

    // Announce to all publicTags (ignore preImages - no encryption)
    for (const tag of tags.publicTags) {
      if (!this.registry.has(tag)) {
        this.registry.set(tag, new Map());
      }

      this.registry.get(tag)!.set(peerId, {
        peerInfo,
        expiresAt,
      });
    }
  }

  public async discover(tags: Tags): Promise<PeerDiscoveryResult[]> {
    const results: PeerDiscoveryResult[] = [];
    const now = Date.now();

    // Search by publicTags (ignore preImages - no decryption needed)
    for (const tag of tags.publicTags) {
      const entries = this.registry.get(tag);
      if (entries) {
        for (const [, { peerInfo, expiresAt }] of entries) {
          if (expiresAt > now) {
            results.push({
              peerInfo,
              publicTag: tag,
            });
          }
        }
      }
    }

    return results;
  }

  public async withdraw(_tags: Tags): Promise<void> {
    // Cleanup timer handles expiry based on expiresAt timestamp
    // No action needed
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [tag, entries] of this.registry) {
      for (const [peerId, { expiresAt }] of entries) {
        if (expiresAt <= now) {
          entries.delete(peerId);
        }
      }
      if (entries.size === 0) {
        this.registry.delete(tag);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}
