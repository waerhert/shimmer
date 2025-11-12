import { kadDHT, removePublicAddressesMapper } from "@libp2p/kad-dht";
import { createLibp2p } from "libp2p";
import { peerIdFromString } from "@libp2p/peer-id";
import { ping } from "@libp2p/ping";
import { identify } from "@libp2p/identify";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { bootstrap } from '@libp2p/bootstrap'
import { sleep } from "../util.js";
import { generateKeyPair, generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import { DHTDiscovery } from "../dht-discovery.js";
// import { CID } from "multiformats/cid";
// import * as raw from "multiformats/codecs/raw";
// import { sha256 } from "multiformats/hashes/sha2";

const key = await generateKeyPairFromSeed("Ed25519", 
    Uint8Array.from([1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,0,1,44]));

const node = await createLibp2p({
  privateKey: key,
  addresses: {
    // add a listen address (localhost) to accept TCP connections on a random port
    listen: ["/ip4/127.0.0.1/tcp/0"],
  },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    dht: kadDHT({
      protocol: '/shimmer/kad/1.0.0',
      peerInfoMapper: removePublicAddressesMapper,
      clientMode: false
    }),
    ping: ping(),
    identify: identify(),
  },
  peerDiscovery: [
    bootstrap({
      list: [
        "/ip4/127.0.0.1/tcp/37893/p2p/12D3KooWPTq9qJ6ULqG6CEWr9iCdTNCaS5cSa4TNXQtSbBdM9KAQ"
      ],
      timeout: 1000, // in ms,
      tagName: "bootstrap",
      tagValue: 50,
      tagTTL: 120000, // in ms
    }),
  ],
});

// start libp2p
await node.start();

// Rendezvous-based peer discovery (equivalent to Go's drouting + dutil)
const discovery = new DHTDiscovery(node, "/shimmer/peers/1.0.0");
//console.log("\n📢 Starting DHT-based peer discovery");
//await discovery.startPeriodicDiscovery();

// Keep running
console.log("\nNode FOUR is running. Press Ctrl+C to stop.");
await sleep(1000000);
