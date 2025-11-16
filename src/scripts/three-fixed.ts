import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { kadDHT, removePublicAddressesMapper } from "@libp2p/kad-dht";
import { identify } from "@libp2p/identify";
import { ping } from "@libp2p/ping";
import { bootstrap } from "@libp2p/bootstrap";
import { identities, localMultiAddrFromIdentity } from "./id.js";
import { sleep } from "../util.js";
import { DHTDiscovery } from "../dht-discovery.js";

console.log("Creating Node THREE...");

const node = await createLibp2p({
  privateKey: identities.three.key,
  addresses: {
    listen: [`/ip4/127.0.0.1/tcp/${identities.three.port}`],
  },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    identify: identify(),
    ping: ping(),
    dht: kadDHT({
      protocol: '/test-dht/1.0.0',
      clientMode: false,
      peerInfoMapper: removePublicAddressesMapper,
    })
  },
  peerDiscovery: [
    bootstrap({
      list: [localMultiAddrFromIdentity(identities.one)],
      timeout: 1000,
      tagName: "bootstrap",
      tagValue: 50,
      tagTTL: 120000,
    }),
  ],
});

await node.start();

console.log("Node THREE started");
console.log("Peer ID:", node.peerId.toString());

node.addEventListener("peer:connect", (evt) => {
  console.log("✓ Peer connected:", evt.detail.toString());
});

node.addEventListener("peer:discovery", (evt) => {
  console.log("✓ Discovered peer:", evt.detail.id.toString());
});

// Create DHT discovery with the SAME rendezvous string as two-fixed.ts
const discovery = new DHTDiscovery(node, "test-rendezvous");

console.log("\nStarting DHT-based discovery...");
await discovery.startPeriodicDiscovery(
  60000,  // Re-advertise every 60 seconds
  15000   // Search for peers every 15 seconds
);

console.log("\nNode THREE is running. Press Ctrl+C to stop.");
await sleep(1000000);
