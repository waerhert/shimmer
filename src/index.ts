/**
 * @shimmer/core - Privacy-preserving peer discovery for libp2p
 *
 * Enables peers with similar content to discover each other without revealing
 * exact content to rendezvous servers or other peers.
 *
 * Uses locality-sensitive hashing (LSH) with epoch-based tags for privacy.
 */

// Main service
export { shimmer, Shimmer, type ShimmerInit, type ShimmerComponents, type ShimmerEvents } from "./shimmer.js";

// Sketcher
export { Sketcher, type SketcherConfig, type ModalityConfig } from "./sketcher/Sketcher.js";
export { type Tags } from "./sketcher/crypto.js";

// Rendezvous interface
export { type RendezVous, type PeerDiscoveryResult } from "./rendezvous/interface.js";

// Rendezvous implementations
export { HTTPEncryptedRendezVous } from "./rendezvous/http-client.js";
export { HTTPRendezVousServer } from "./rendezvous/http-server.js";
export { InMemoryEncryptedRendezVous } from "./rendezvous/memory-encrypted.js";
export { InMemoryRendezVous } from "./rendezvous/memory.js";
export { DHTRendezVous, type DHTRendezVousConfig } from "./rendezvous/dht.js";

// Convenient factory helpers
export {
  httpRendezvous,
  memoryRendezvous,
  memoryRendezvousPlain,
  dhtRendezvous,
} from "./rendezvous/factories.js";

// Encryption utilities
export { encryptPeerInfo, decryptPeerInfo } from "./rendezvous/encryption.js";
