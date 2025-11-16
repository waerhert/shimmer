import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { kadDHT, removePublicAddressesMapper } from "@libp2p/kad-dht";
import { identify } from "@libp2p/identify";
import { ping } from "@libp2p/ping";
import { identities } from "./id.js";
import { sleep } from "../util.js";

console.log("Creating Node ONE (bootstrap node)...");

const node = await createLibp2p({
  privateKey: identities.one.key,
  addresses: {
    listen: [`/ip4/127.0.0.1/tcp/${identities.one.port}`],
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
});

await node.start();

console.log("Node ONE started");
console.log("Listening on:");
node.getMultiaddrs().forEach((addr) => {
  console.log("  ", addr.toString());
});

node.addEventListener("peer:connect", (evt) => {
  console.log("✓ Peer connected:", evt.detail.toString());
});

node.addEventListener("peer:discovery", (evt) => {
  console.log("✓ Discovered peer:", evt.detail.id.toString());
});

// Just keep running - this is the bootstrap node
console.log("\nNode ONE is running as bootstrap. Press Ctrl+C to stop.");
await sleep(1000000);
