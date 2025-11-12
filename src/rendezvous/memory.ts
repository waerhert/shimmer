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
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    // Cleanup expired entries every 30 seconds
    this.cleanupTimer = setInterval(() => this.cleanup(), 30000);
  }

  public async announce(
    tags: Tags,
    peerInfo: PeerInfo,
    ttlSeconds: number
  ): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
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
    const found = new Map<string, PeerDiscoveryResult>();
    const now = Date.now();

    // Search by publicTags (ignore preImages - no decryption needed)
    for (const tag of tags.publicTags) {
      const entries = this.registry.get(tag);
      if (entries) {
        for (const [peerId, { peerInfo, expiresAt }] of entries) {
          if (expiresAt > now && !found.has(peerId)) {
            found.set(peerId, {
              peerInfo,
              matchedTag: tag,
            });
          }
        }
      }
    }

    return Array.from(found.values());
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
