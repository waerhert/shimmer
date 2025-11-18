import { kadDHT, removePublicAddressesMapper } from "@libp2p/kad-dht";
import { createLibp2p } from "libp2p";
import { ping } from "@libp2p/ping";
import { identify } from "@libp2p/identify";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { bootstrap } from "@libp2p/bootstrap";
import { sleep, words1 } from "../util.js";
import { identities, localMultiAddrFromIdentity } from "./id.js";
import { shimmer } from "../shimmer.js";
import { dhtRendezvous } from "../rendezvous/factories.js";

const node = await createLibp2p({
  privateKey: identities.two.key,
  addresses: {
    // add a listen address (localhost) to accept TCP connections on a random port
    listen: [`/ip4/127.0.0.1/tcp/${identities.two.port}`],
  },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    shimmer: shimmer({
      rendezvous: dhtRendezvous({
        peerInfoMapper: removePublicAddressesMapper,
      }),
      autoDiscoverInterval: 5000,
      autoAnnounce: true,
      nameInit: { name: 'two' },
    }),
    ping: ping(),
    identify: identify(),
  },
  peerDiscovery: [
    bootstrap({
      //list: aminoBootstrappers,
      list: [localMultiAddrFromIdentity(identities.one)],
      timeout: 1000, // in ms,
      tagName: "bootstrap",
      tagValue: 50,
      tagTTL: 120000, // in ms
    }),
  ],
});

// start libp2p
await node.start();
await node.services.shimmer.start();

node.services.shimmer.sketch("words", words1);

node.addEventListener("peer:connect", (evt) => {
  console.log("Peer connected:", evt.detail.toString());
});

node.addEventListener("peer:discovery", (evt) => {
  console.log("✓ Discovered peer:", evt.detail.id.toString());
});

node.services.shimmer.addEventListener("peer:name:discovered", (evt) => {
  console.log(`📛 Name discovered: ${evt.detail.name} (${evt.detail.peer.peerInfo.id.toString()})`);
});

// Keep running
console.log("\nNode two is running. Press Ctrl+C to stop.");
await sleep(1000000);
