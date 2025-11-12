import type { PeerInfo } from "@libp2p/interface";
import type { Tags } from "./crypto.js";

export interface PeerDiscoveryResult {
  peerInfo: PeerInfo;
  matchedTag: string; // Which publicTag matched
}

export interface RendezVous {
  /**
   * Announce peer info under tags
   * @param tags - Tags object containing publicTags and preImages from crypto.js
   * @param peerInfo - This peer's info (id + multiaddrs)
   * @param ttlSeconds - How long announcement is valid
   */
  announce(
    tags: Tags,
    peerInfo: PeerInfo,
    ttlSeconds: number
  ): Promise<void>;

  /**
   * Discover peers by tags
   * @param tags - Tags object containing publicTags and preImages for decryption
   * @returns Peers found + which publicTag matched
   */
  discover(tags: Tags): Promise<PeerDiscoveryResult[]>;
}

export class InMemoryRendezVous implements RendezVous {
  // tag → peerId → {peerInfo, expiresAt}
  private registry = new Map<
    string,
    Map<
      string,
      {
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
  private registry: Record<string, { encryptedPeerInfo: Uint8Array, expiresAt: number }[]> = {}
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => { this.cleanup() }, 30000);
  }

  async announce(
    tags: Tags,
    peerInfo: PeerInfo,
    ttlSeconds: number
  ): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;

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
    const found = new Map<string, PeerDiscoveryResult>();
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
          const peerId = decrypted.id.toString();
          if (!found.has(peerId)) {
            found.set(peerId, {
              peerInfo: decrypted,
              matchedTag: publicTag
            });
          }
        }
      }
    }

    return Array.from(found.values());
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

async function deriveEncryptionKey(preImage: string): Promise<CryptoKey> {
  // Step 1: Import preImage as raw key material for HKDF
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(preImage),
    'HKDF',
    false,  // Not extractable
    ['deriveKey']
  );
  
  // Step 2: Derive AES-GCM key from the key material
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),  // Optional: add salt for more security
      info: new TextEncoder().encode('shimmer-rendezvous-encryption')  // Context string
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256  // 256-bit key
    },
    false,  // Not extractable
    ['encrypt', 'decrypt']
  );
  
  return aesKey;  // Returns CryptoKey ready for AES-GCM
}

async function encryptPeerInfo(peerInfo: PeerInfo, preImage: string): Promise<Uint8Array> {
  const key = await deriveEncryptionKey(preImage);
  const iv = crypto.getRandomValues(new Uint8Array(12));  // 96-bit IV for GCM
  
  const plaintext = new TextEncoder().encode(JSON.stringify({
    id: peerInfo.id.toString(),
    multiaddrs: peerInfo.multiaddrs.map(ma => ma.toString())
  }));
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  
  // Prepend IV to ciphertext for decryption
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  
  return result;
}

async function decryptPeerInfo(encrypted: Uint8Array, preImage: string): Promise<PeerInfo | null> {
  try {
    const key = await deriveEncryptionKey(preImage);
    const iv = encrypted.slice(0, 12);
    const ciphertext = encrypted.slice(12);
    
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    
    const json = new TextDecoder().decode(plaintext);
    return JSON.parse(json);
  } catch {
    return null;  // Decryption failed = wrong preImage
  }
}