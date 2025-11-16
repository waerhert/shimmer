import type { PeerInfo } from "@libp2p/interface";
import type { Tags } from "../sketcher/lsh.js";

export interface PeerDiscoveryResult {
  peerInfo: PeerInfo;
  publicTag: string; // Which publicTag matched
}

export interface RawPeerDiscoveryResult {
  publicTag: string;  // Which tag this data was found under
  data: string; // The opaque data (base64 encoded)
}

export interface RendezVous {
  /**
   * Announce peer info under tags
   * @param tags - Tags object containing publicTags and preImages from crypto.js
   * @param peerInfo - This peer's info (id + multiaddrs)
   * @param expiresAt - Unix timestamp (ms) when announcement expires
   */
  announce(
    tags: Tags,
    peerInfo: PeerInfo,
    expiresAt: number
  ): Promise<void>;

  /**
   * Discover peers by tags
   * @param tags - Tags object containing publicTags and preImages for decryption
   * @returns Peers found + which publicTag matched
   */
  discover(tags: Tags): Promise<PeerDiscoveryResult[]>;

  /**
   * Withdraw announcement for tags (stop being discoverable)
   * Call this when epoch expires or content changes
   *
   * For HTTP/memory: No-op (server handles expiry)
   * For DHT: Cancels provider records to stop re-announcing
   *
   * @param tags - The tags to withdraw announcement for
   */
  withdraw(tags: Tags): Promise<void>;
}

/**
 * RawRendezVous - Low-level rendezvous interface for opaque data storage
 *
 * This interface is designed for server implementations that store arbitrary data
 * without knowledge of its content or encryption. Clients handle serialization
 * and encryption, servers just store and retrieve based on tags.
 */
export interface RawRendezVous {
  /**
   * Announce data under tags
   * @param publicTags - Array of tag strings to announce under
   * @param data - Opaque data string (typically base64-encoded encrypted PeerInfo)
   * @param expiresAt - Unix timestamp (ms) when announcement expires
   */
  announce(publicTags: string[], data: string, expiresAt: number): Promise<void>;

  /**
   * Discover data by tags
   * @param publicTags - Array of tag strings to search for
   * @returns Array of results with tag+data pairs found under the tags
   */
  discover(publicTags: string[]): Promise<RawPeerDiscoveryResult[]>;
}