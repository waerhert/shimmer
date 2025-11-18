/**
 * @shimmer/core - Browser build
 * Privacy-preserving peer discovery for libp2p (Browser-compatible exports)
 *
 * Enables peers with similar content to discover each other without revealing
 * exact content to rendezvous servers or other peers.
 *
 * Uses locality-sensitive hashing (LSH) with epoch-based tags for privacy.
 *
 * Note: This build excludes Node.js-specific features like HTTP server and DHT.
 */

// Main service
export { shimmer, Shimmer, type ShimmerInit, type ShimmerComponents, type ShimmerEvents } from "./shimmer.js";

// Sketcher
export { Sketcher, type SketcherConfig, type ModalityConfig } from "./sketcher/sketcher.js";
export { Sketch } from "./sketcher/sketch.js";
export { type Tags } from "./sketcher/lsh.js";

// Peer management
export { ProximityPeer } from "./peers/peer.js";
export { PeerRegistry } from "./peers/registry.js";

// PSI
export { type PSIResult, type PSICompleteEvent } from "./protocols/psi/index.js";

// Rendezvous interface
export { type RendezVous, type PeerDiscoveryResult } from "./rendezvous/interface.js";

// Browser-compatible rendezvous implementations
export { InMemoryEncryptedRendezVous } from "./rendezvous/memory-encrypted.js";
export { InMemoryRendezVous } from "./rendezvous/memory.js";

// Browser-compatible factory helpers
export {
  memoryRendezvous,
  memoryRendezvousPlain,
} from "./rendezvous/factories.js";

// Encryption utilities
export { encryptPeerInfo, decryptPeerInfo } from "./rendezvous/encryption.js";
