import type { PeerInfo } from "@libp2p/interface";
import type { Tags } from "../sketcher/crypto.js";
import type { RendezVous, PeerDiscoveryResult } from "./interface.js";
import { encryptPeerInfo, decryptPeerInfo } from "./encryption.js";

/**
 * Encrypted in-memory rendezvous implementation
 *
 * Stores peer info encrypted using AES-256-GCM derived from preImages via HKDF.
 * Only peers with matching preImages can decrypt and discover each other.
 *
 * Use this when you want privacy-preserving rendezvous where the server
 * (or in this case, the shared memory) cannot see peer multiaddrs.
 */

export class InMemoryEncryptedRendezVous implements RendezVous {
  private registry: Record<string, { encryptedPeerInfo: Uint8Array; expiresAt: number; }[]> = {};
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => { this.cleanup(); }, 30000);
  }

  async announce(
    tags: Tags,
    peerInfo: PeerInfo,
    expiresAt: number
  ): Promise<void> {
    // Announce to all publicTags, encrypting with corresponding preImages
    for (let i = 0; i < tags.publicTags.length; i++) {
      const publicTag = tags.publicTags[i]!;
      const preImage = tags.preImages[i];

      if (!preImage) {
        throw new Error(`InMemoryEncryptedRendezVous requires preImage for tag ${publicTag}`);
      }

      const encryptedPeerInfo = await encryptPeerInfo(peerInfo, preImage);

      if (!this.registry[publicTag]) {
        this.registry[publicTag] = [];
      }
      this.registry[publicTag].push({ encryptedPeerInfo, expiresAt });
    }
  }

  /**
   * Discover peers by decrypting with provided preImages
   * Only returns peers that can be successfully decrypted
   */
  async discover(tags: Tags): Promise<PeerDiscoveryResult[]> {
    const results: PeerDiscoveryResult[] = [];
    const now = Date.now();

    // Search by publicTags, decrypting with corresponding preImages
    for (let i = 0; i < tags.publicTags.length; i++) {
      const publicTag = tags.publicTags[i]!;
      const preImage = tags.preImages[i];

      if (!preImage) {
        console.warn(`[InMemoryEncryptedRendezVous] Skipping tag ${publicTag} - no preImage provided for decryption`);
        continue;
      }

      const entries = this.registry[publicTag];
      if (!entries) continue;

      for (const { encryptedPeerInfo, expiresAt } of entries) {
        if (expiresAt <= now) continue;

        // Try to decrypt with this preImage
        const decrypted = await decryptPeerInfo(encryptedPeerInfo, preImage);
        if (decrypted) {
          results.push({
            peerInfo: decrypted,
            publicTag: publicTag
          });
        }
      }
    }

    return results;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const tag in this.registry) {
      this.registry[tag] = this.registry[tag]!.filter(
        ({ expiresAt }) => expiresAt > now
      );
      if (this.registry[tag]!.length === 0) {
        delete this.registry[tag];
      }
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}
