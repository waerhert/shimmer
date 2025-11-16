import type { PeerId, PeerInfo } from '@libp2p/interface';
import type { Sketch } from '../sketcher/sketch.js';
import { ProximityPeer } from './peer.js';

export class PeerRegistry {
  private peers = new Map<string, ProximityPeer>();

  addPeer(peerInfo: PeerInfo, sketch: Sketch): ProximityPeer {
    const key = peerInfo.id.toString();

    let peer = this.peers.get(key);
    if (!peer) {
      peer = new ProximityPeer(peerInfo);
      this.peers.set(key, peer);
    }

    peer.addSketch(sketch);
    return peer;
  }

  getPeer(peerId: PeerId): ProximityPeer | undefined {
    return this.peers.get(peerId.toString());
  }

  getPeers(): ProximityPeer[] {
    return Array.from(this.peers.values());
  }

  cleanup(): void {
    // Remove peers with no valid sketches (respects grace period in isClose())
    for (const [key, peer] of this.peers) {
      if (!peer.isClose()) {  // Uses 60s grace period by default
        this.peers.delete(key);
      }
    }
  }

  clear(): void {
    this.peers.clear();
  }
}