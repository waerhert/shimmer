/**
 * Basic Shimmer usage example
 *
 * This example shows how to integrate Shimmer with libp2p for
 * privacy-preserving peer discovery based on content similarity.
 */

import { createLibp2p } from 'libp2p';
import { shimmer, httpRendezvous, dhtRendezvous, memoryRendezvous } from '../src/index.js';

// Example 1: Using HTTP rendezvous (centralized)
async function httpExample() {
  const node = await createLibp2p({
    // ... other libp2p config (transports, etc.)
    services: {
      shimmer: shimmer({
        // Pre-instantiated HTTP rendezvous
        rendezvous: httpRendezvous('http://localhost:8771'),

        // Sketcher config for different modalities
        sketcherConfig: {
          interests: {
            k: 128,              // MinHash signature size
            bands: 16,           // Number of LSH bands
            epochInterval: '5m'  // Tags rotate every 5 minutes
          },
          location: {
            k: 64,
            bands: 8,
            epochInterval: '10m'
          }
        },

        // Auto-announce when sketch() is called
        autoAnnounce: true,

        // Auto-discover every 30 seconds
        autoDiscoverInterval: 30_000
      })
    }
  });

  // Create a sketch for interests
  await node.services.shimmer.sketch('interests', [
    'music',
    'art',
    'coding',
    'hiking'
  ]);

  // Listen for discovered peers
  node.services.shimmer.addEventListener('peer:discovered', (event) => {
    console.log('Discovered peer:', event.detail.peerInfo.id.toString());
    console.log('Matching tag:', event.detail.publicTag);
    console.log('Modality:', event.detail.modality);

    // Dial the peer
    // await node.dial(event.detail.peerInfo.id);
  });

  // Manually discover (if autoDiscoverInterval not set)
  const peers = await node.services.shimmer.discover('interests');
  console.log(`Found ${peers.length} peers with similar interests`);

  return node;
}

// Example 2: Using DHT rendezvous (decentralized)
async function dhtExample() {
  const node = await createLibp2p({
    services: {
      shimmer: shimmer({
        // Factory function - DHT needs components
        rendezvous: dhtRendezvous({
          protocol: '/myapp/shimmer/kad/1.0.0',  // Custom isolated DHT
          provideValidity: 300_000,              // 5 minutes (match epoch)
          refreshInterval: 240_000,              // Re-provide every 4 minutes
        }),

        sketcherConfig: {
          interests: { k: 128, bands: 16, epochInterval: '5m' }
        }
      })
    }
  });

  await node.services.shimmer.sketch('interests', ['music', 'art']);

  return node;
}

// Example 3: Using memory rendezvous (testing)
async function memoryExample() {
  const node = await createLibp2p({
    services: {
      shimmer: shimmer({
        // Pre-instantiated memory rendezvous
        rendezvous: memoryRendezvous(),

        sketcherConfig: {
          interests: { k: 128, bands: 16, epochInterval: '5m' }
        }
      })
    }
  });

  await node.services.shimmer.sketch('interests', ['music', 'art']);

  return node;
}

// Example 4: Custom rendezvous implementation
async function customRendezvousExample() {
  const node = await createLibp2p({
    services: {
      shimmer: shimmer({
        // You can pass any object that implements RendezVous interface
        rendezvous: {
          async announce(tags, peerInfo, expiresAt) {
            console.log('Custom announce:', tags.publicTags);
            // Your custom logic...
          },
          async discover(tags) {
            console.log('Custom discover:', tags.publicTags);
            // Your custom logic...
            return [];
          }
        },

        sketcherConfig: {
          interests: { k: 128, bands: 16, epochInterval: '5m' }
        }
      })
    }
  });

  return node;
}

// Example 5: Multi-modality discovery
async function multiModalityExample() {
  const node = await createLibp2p({
    services: {
      shimmer: shimmer({
        rendezvous: httpRendezvous('http://localhost:8771'),

        sketcherConfig: {
          interests: { k: 128, bands: 16, epochInterval: '5m' },
          location: { k: 64, bands: 8, epochInterval: '10m' },
          playlist: { k: 256, bands: 32, epochInterval: '15m' }
        }
      })
    }
  });

  // Sketch multiple modalities
  await node.services.shimmer.sketch('interests', ['music', 'art', 'coding']);
  await node.services.shimmer.sketch('location', ['san-francisco', 'california', 'usa']);
  await node.services.shimmer.sketch('playlist', [
    'track-1-id',
    'track-2-id',
    'track-3-id'
  ]);

  // Discover peers for each modality
  const interestPeers = await node.services.shimmer.discover('interests');
  const locationPeers = await node.services.shimmer.discover('location');
  const playlistPeers = await node.services.shimmer.discover('playlist');

  console.log(`Interests: ${interestPeers.length} peers`);
  console.log(`Location: ${locationPeers.length} peers`);
  console.log(`Playlist: ${playlistPeers.length} peers`);

  return node;
}

// Run example (uncomment desired example)
// httpExample().catch(console.error);
// dhtExample().catch(console.error);
// memoryExample().catch(console.error);
// customRendezvousExample().catch(console.error);
// multiModalityExample().catch(console.error);
