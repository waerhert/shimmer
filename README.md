# Shimmer

Proximity-based peer discovery for libp2p using environmental observations.

## ⚠️ Development Status

**This software is in active development and subject to breaking changes. Not intended for production use.**

APIs may change without notice, features are experimental, and there are known security considerations that have not been fully addressed. Use at your own risk.

## What is it?

Shimmer helps peers in the **same physical location** discover each other by observing their shared environment (WiFi networks, Bluetooth devices, cell towers). If you and I both see the same WiFi SSIDs, we're probably nearby - Shimmer lets us find each other.

```
  Coffee Shop                          Library
┌──────────────┐                  ┌──────────────┐
│ WiFi: [      │                  │ WiFi: [      │
│  "CoffeeNet" │                  │  "LibraryNet"│
│  "Starbucks" │                  │  "PublicNet" │
│ ]            │                  │ ]            │
│              │                  │              │
│  Peer A ────┐│                  │  Peer C      │
│  Peer B ────┘│                  │              │
└──────────────┘                  └──────────────┘
       │                                 │
       │ 1. Sketch observations          │
       ▼                                 ▼
  [tag1,tag2]                      [tag5,tag6]
       │                                 │
       │ 2. Announce to Rendezvous       │
       └────────►┌──────────┐◄───────────┘
                 │Rendezvous│
                 └────┬─────┘
       ┌──────────────┴──────────────┐
       │ 3. Discover matches         │
       ▼                             ▼
  A & B match!                 C (no match)
       │
       └──── 4. Compute 90% similarity
                (same location!)
```

## How it works

1. **Observe environment**: Scan WiFi SSIDs, Bluetooth devices, or cell towers
2. **Sketch**: Convert observations into compact LSH (Locality-Sensitive Hashing) signatures
3. **Announce**: Publish signatures to a rendezvous server
4. **Discover**: Find peers with matching signatures
5. **PSI**: Use Private Set Intersection to compute exact similarity

## Quick Example

Based on [src/scripts/four.ts](src/scripts/four.ts):

```typescript
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { shimmer } from './shimmer.js';
import { httpRendezvous } from './rendezvous/factories.js';

const node = await createLibp2p({
  addresses: {
    listen: ['/ip4/127.0.0.1/tcp/0']
  },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    shimmer: shimmer({
      rendezvous: httpRendezvous('http://localhost:8771'),
      autoDiscoverInterval: 5000,  // Auto-discover every 5s
      autoAnnounce: true
    })
  }
});

await node.start();
await node.services.shimmer.start();

// Sketch environmental observations
const wifiNetworks = ['CoffeeNet', 'Starbucks', 'Guest123'];
await node.services.shimmer.sketch('wifi', wifiNetworks);

// Listen for nearby peers
node.addEventListener('peer:discovery', (evt) => {
  console.log('Discovered nearby peer:', evt.detail.id);
});

// Check similarity scores
node.services.shimmer.addEventListener('peer:psi:complete', (event) => {
  const { peer, result } = event.detail;
  console.log(`Peer ${peer.peerInfo.id}: ${result.similarity.toFixed(1)}% similar`);
});
```
