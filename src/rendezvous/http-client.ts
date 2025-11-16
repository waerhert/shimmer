import type { PeerInfo } from "@libp2p/interface";
import type { Tags } from "../sketcher/lsh.js";
import type { RendezVous, PeerDiscoveryResult } from "./interface.js";
import { encryptPeerInfo, decryptPeerInfo } from "./encryption.js";
import { peerIdFromString } from "@libp2p/peer-id";
import { multiaddr } from "@multiformats/multiaddr";

/**
 * HTTPEncryptedRendezVous - HTTP client implementing RendezVous with client-side encryption
 *
 * Connects to an HTTPRendezVousServer and handles encryption/decryption of PeerInfo.
 * The server only sees encrypted base64 blobs - all encryption happens client-side.
 */
export class HTTPEncryptedRendezVous implements RendezVous {
  private serverUrl: string;

  constructor(serverUrl: string) {
    // Remove trailing slash if present
    this.serverUrl = serverUrl.replace(/\/$/, "");
  }

  public async announce(
    tags: Tags,
    peerInfo: PeerInfo,
    expiresAt: number
  ): Promise<void> {
    // Encrypt peer info with each preImage and announce separately
    for (let i = 0; i < tags.publicTags.length; i++) {
      const publicTag = tags.publicTags[i]!;
      const preImage = tags.preImages[i];

      if (!preImage) {
        throw new Error(
          `HTTPEncryptedRendezVous requires preImage for tag ${publicTag}`
        );
      }

      // Encrypt PeerInfo using preImage
      const encrypted = await encryptPeerInfo(peerInfo, preImage);

      // Convert to base64 for HTTP transport
      const base64Data = uint8ArrayToBase64(encrypted);

      // Announce to server
      const response = await fetch(`${this.serverUrl}/announce`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tags: [publicTag],
          data: base64Data,
          expiresAt,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(`Failed to announce: ${error.error || response.statusText}`);
      }
    }
  }

  public async discover(tags: Tags): Promise<PeerDiscoveryResult[]> {
    const results: PeerDiscoveryResult[] = [];

    // Query server with all publicTags
    const response = await fetch(`${this.serverUrl}/discover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tags: tags.publicTags,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(`Failed to discover: ${error.error || response.statusText}`);
    }

    const result = await response.json();
    const rawResults: Array<{ publicTag: string; data: string }> = result.results || [];

    // Decrypt each result using the corresponding preImage
    for (const rawResult of rawResults) {
      const encrypted = base64ToUint8Array(rawResult.data);

      // Find the index of this tag in publicTags to get the corresponding preImage
      const tagIndex = tags.publicTags.indexOf(rawResult.publicTag);
      if (tagIndex === -1) continue; // Tag not in our list (shouldn't happen)

      const preImage = tags.preImages[tagIndex];
      if (!preImage) continue; // No preImage for this tag

      const decrypted = await decryptPeerInfo(encrypted, preImage);
      if (decrypted) {
        // Successfully decrypted - add every result even if same peer
        const peerInfo = await reconstructPeerInfo(decrypted);
        results.push({
          peerInfo,
          publicTag: rawResult.publicTag,
        });
      }
    }

    return results;
  }

  /**
   * Withdraw announcement for tags
   * No-op for HTTP - server handles expiry automatically
   */
  public async withdraw(_tags: Tags): Promise<void> {
    // HTTP server handles expiry based on expiresAt timestamp
    // No action needed on client side
  }
}

// Helper: Convert Uint8Array to base64
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary);
}

// Helper: Convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Helper: Reconstruct PeerInfo from decrypted JSON
async function reconstructPeerInfo(decrypted: PeerInfo | any): Promise<PeerInfo> {
  // If decryptPeerInfo already returned proper PeerInfo, use it
  if (decrypted.id && typeof decrypted.id !== "string") {
    return decrypted as PeerInfo;
  }

  // Otherwise reconstruct from JSON-decoded format
  return {
    id: peerIdFromString(decrypted.id),
    multiaddrs: decrypted.multiaddrs.map((addr: string) => multiaddr(addr)),
  };
}
