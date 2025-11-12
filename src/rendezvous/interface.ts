import type { PeerInfo } from "@libp2p/interface";
import type { Tags } from "../sketcher/crypto.js";

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