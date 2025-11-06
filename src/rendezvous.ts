/**
 * peerInfo is a string here, we'll let others worry about serialization of a
 * more complex peerInfo object which may contain ip address, pubkey, port, etc
 * also
 */
export interface RendezVous {
  announce(tags: string[], peerInfo: string, ttlSeconds: number): Promise<void>;
  discover(tags: string[]): Promise<string[]>;
}

export class InMemoryRendezVous implements RendezVous {
  // tag -> peerInfo -> ttl
  private registry = new Map<string, Map<string, number>>();

  public async announce(
    tags: string[],
    peerInfo: string,
    ttlSeconds: number
  ): Promise<void> {
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    for (const tag of tags) {
      let map = this.registry.get(tag);
      if (!map) {
        map = new Map();
        this.registry.set(tag, map);
      }

      map.set(peerInfo, expiresAt);
    }
  }

  public async discover(tags: string[]): Promise<string[]> {
    const peers = new Set<string>();
    const now = Date.now();
    for (const tag of tags) {
      const entries = this.registry.get(tag);
      if (entries) {
        for (const [peerInfo, expiresAt] of entries) {
          if (expiresAt > now) {
            peers.add(peerInfo);
          }
        }
      }
    }

    return Array.from(peers);
  }
}
