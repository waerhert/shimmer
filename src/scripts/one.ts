import { kadDHT, removePublicAddressesMapper } from "@libp2p/kad-dht";
import { createLibp2p } from "libp2p";
import { ping } from "@libp2p/ping";
import { identify } from "@libp2p/identify";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { sleep } from "../util.js";
import { generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import { DHTDiscovery } from "../dht-discovery.js";
import { peerIdFromPublicKey } from "@libp2p/peer-id";
import { identities } from "./id.js";
import type { PeerInfo } from '@libp2p/interface';


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
    dht: kadDHT({
      protocol: '/shimmer/kad/1.0.0',
      peerInfoMapper: (peer) => {
       // console.log(peer)
        return removePublicAddressesMapper(peer)
      },
      clientMode: false
    }),
    ping: ping(),
    identify: identify(),
  },
});

// start libp2p
await node.start();
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

// Rendezvous-based peer discovery (equivalent to Go's drouting + dutil)
const discovery = new DHTDiscovery(node, "/shimmer/peers/1.0.0");
console.log("\n📢 Starting DHT-based peer discovery");
await discovery.startPeriodicDiscovery();

// Keep running
console.log("\nNode ONE is running. Press Ctrl+C to stop.");
await sleep(1000000);
