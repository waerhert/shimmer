import { kadDHT, removePublicAddressesMapper } from "@libp2p/kad-dht";
import { createLibp2p } from "libp2p";
import { ping } from "@libp2p/ping";
import { identify } from "@libp2p/identify";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { sleep } from "../util.js";
import { identities } from "./id.js";
import type { PeerInfo } from '@libp2p/interface';
import { dhtRendezvous } from "../rendezvous/factories.js";
import { shimmer } from "../shimmer.js";


const node = await createLibp2p({
  privateKey: identities.one.key,
  addresses: {
    // Fixed port so two.ts can connect
    listen: [`/ip4/127.0.0.1/tcp/${identities.one.port}`],
  },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    shimmer: shimmer({
      rendezvous: dhtRendezvous({
        peerInfoMapper: removePublicAddressesMapper,
      })
    }),
    ping: ping(),
    identify: identify(),
  },
});

// start libp2p
await node.start();
await node.services.shimmer.start();

console.log("libp2p has started");

// print out listening addresses
console.log("\n=== Copy this multiaddr to two.ts ===");
node.getMultiaddrs().forEach((addr) => {
  console.log(addr.toString());
});
console.log("=====================================\n");

node.addEventListener("peer:connect", (evt) => {
  console.log("Peer connected:", evt.detail.toString());
});

node.addEventListener('peer:discovery', (evt) => {
  console.log("✓ Discovered peer:", evt.detail.id.toString());
});

// Monitor provider records
console.log('\n[Monitor] Setting up provider monitoring...');
const dht = (node.services.shimmer as any).rendezvous.getDHT();
console.log('[Monitor] DHT obtained:', typeof dht);

// Track provider record counts over time
let previousCount = 0;
const startTime = Date.now();

// Periodic provider record monitoring
setInterval(async () => {
  try {
    const providers = (dht as any).providers;

    if (providers && providers.datastore) {
      const datastore = providers.datastore;

      // Count provider records
      let count = 0;
      const uniqueCIDs = new Set<string>();
      const peerIds = new Set<string>();

      try {
        for await (const { key } of datastore.query({ prefix: providers.datastorePrefix })) {
          count++;
          const keyStr = key.toString();

          // Extract CID and PeerID from key format: /dht/provider/{CID}/{PeerID}
          const parts = keyStr.split('/');
          if (parts.length >= 4) {
            uniqueCIDs.add(parts[3]); // CID part
            if (parts.length >= 5) {
              peerIds.add(parts[4]); // PeerID part
            }
          }
        }

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const change = count - previousCount;
        const changeStr = change > 0 ? `+${change}` : change < 0 ? `${change}` : '=';

        console.log(
          `[${elapsed}s] Provider Records: ${count} (${changeStr}) | ` +
          `Unique CIDs: ${uniqueCIDs.size} | ` +
          `Unique Peers: ${peerIds.size}`
        );

        previousCount = count;
      } catch (queryErr: any) {
        console.log(`[Monitor] Error querying: ${queryErr.message}`);
      }
    }
  } catch (err: any) {
    console.error(`[Monitor] Error: ${err.message}`);
  }
}, 5000); // Check every 5 seconds

// Keep running
console.log("\nNode ONE is running as bootstrap. Press Ctrl+C to stop.");
await sleep(1000000);
