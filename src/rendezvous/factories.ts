/**
 * Convenient factory functions for creating rendezvous instances
 *
 * These helpers simplify the most common use cases for each rendezvous type.
 */

import { HTTPEncryptedRendezVous } from "./http-client.js";
import { InMemoryEncryptedRendezVous } from "./memory-encrypted.js";
import { InMemoryRendezVous } from "./memory.js";
import { DHTRendezVous, type DHTRendezVousConfig } from "./dht.js";
import type { RendezVous } from "./interface.js";
import type { KadDHTComponents } from "@libp2p/kad-dht";
import type { ShimmerComponents } from "../shimmer.js";

/**
 * Create an HTTP rendezvous client with encryption
 *
 * Uses client-side encryption - the server only sees encrypted blobs.
 * Suitable for centralized deployments or testing.
 *
 * @param serverUrl - HTTP server URL (e.g., 'http://localhost:8771')
 * @returns Pre-instantiated HTTPEncryptedRendezVous
 *
 * @example
 * ```typescript
 * import { shimmer, httpRendezvous } from '@shimmer/core';
 *
 * const node = await createLibp2p({
 *   services: {
 *     shimmer: shimmer({
 *       rendezvous: httpRendezvous('http://localhost:8771')
 *     })
 *   }
 * });
 * ```
 */
export function httpRendezvous(serverUrl: string): RendezVous {
  return new HTTPEncryptedRendezVous(serverUrl);
}

/**
 * Create an in-memory rendezvous with encryption
 *
 * Stores encrypted peer info in memory. Useful for testing or single-node scenarios.
 *
 * @returns Pre-instantiated InMemoryEncryptedRendezVous
 *
 * @example
 * ```typescript
 * import { shimmer, memoryRendezvous } from '@shimmer/core';
 *
 * const node = await createLibp2p({
 *   services: {
 *     shimmer: shimmer({
 *       rendezvous: memoryRendezvous()
 *     })
 *   }
 * });
 * ```
 */
export function memoryRendezvous(): RendezVous {
  return new InMemoryEncryptedRendezVous();
}

/**
 * Create an in-memory rendezvous WITHOUT encryption
 *
 * Stores plain peer info in memory. Only use for testing.
 *
 * @returns Pre-instantiated InMemoryRendezVous
 *
 * @example
 * ```typescript
 * import { shimmer, memoryRendezvousPlain } from '@shimmer/core';
 *
 * const node = await createLibp2p({
 *   services: {
 *     shimmer: shimmer({
 *       rendezvous: memoryRendezvousPlain()
 *     })
 *   }
 * });
 * ```
 */
export function memoryRendezvousPlain(): RendezVous {
  return new InMemoryRendezVous();
}

/**
 * Create a DHT-based rendezvous (factory function)
 *
 * Uses libp2p KadDHT for decentralized peer discovery.
 * Returns a factory because DHT needs libp2p components.
 *
 * Note: DHT provider records are PUBLIC (no encryption).
 * Privacy comes from LSH collision probability + PSI challenge protocol.
 *
 * @param config - DHT configuration (protocol, TTLs, etc.)
 * @returns Factory function that creates DHTRendezVous when given components
 *
 * @example
 * ```typescript
 * import { shimmer, dhtRendezvous } from '@shimmer/core';
 *
 * const node = await createLibp2p({
 *   services: {
 *     shimmer: shimmer({
 *       rendezvous: dhtRendezvous({
 *         protocol: '/myapp/kad/1.0.0',  // Custom protocol for isolation
 *         provideValidity: 300,          // 5 minutes (provider record expiry)
 *         refreshInterval: 240_000,      // 4 minutes (re-provide interval)
 *         cleanupInterval: 60            // 1 minute (cleanup interval)
 *       })
 *     })
 *   }
 * });
 * ```
 */
export function dhtRendezvous<T extends ShimmerComponents = ShimmerComponents>(
  config?: DHTRendezVousConfig
): (components: T) => RendezVous {
  return (components: T) => new DHTRendezVous(components, config);
}
