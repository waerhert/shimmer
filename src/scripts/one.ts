import { kadDHT } from "@libp2p/kad-dht";
import { createLibp2p } from "libp2p";
import { peerIdFromString } from "@libp2p/peer-id";
import { ping } from "@libp2p/ping";
import { identify } from "@libp2p/identify";
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { sleep } from "../util.js";

const node = await createLibp2p({
  addresses: {
    // add a listen address (localhost) to accept TCP connections on a random port
    listen: ["/ip4/127.0.0.1/tcp/0"],
  },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    dht: kadDHT({
      // DHT options
    }),
    ping: ping(),
    identify: identify(),
  },
});

// start libp2p
await node.start();
console.log("libp2p has started");

await sleep(10000);
// print out listening addresses
console.log("listening on addresses:");
node.getMultiaddrs().forEach((addr) => {
  console.log(addr.toString());
});



node.addEventListener('peer:connect', () => {
    console.log("peer connected")
})
