import {
  kadDHT,
  removePrivateAddressesMapper,
  removePublicAddressesMapper,
} from "@libp2p/kad-dht";
import { createLibp2p } from "libp2p";
import { peerIdFromPublicKey, peerIdFromString } from "@libp2p/peer-id";
import { ping } from "@libp2p/ping";
import { identify } from "@libp2p/identify";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { bootstrap } from "@libp2p/bootstrap";
import { sleep } from "../util.js";
import { generateKeyPair, generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import { DHTDiscovery } from "../dht-discovery.js";
import { Sketcher } from "../sketcher.js";
import { tagToCID } from "../p2p.js";
import { aminoBootstrappers } from "../amino-bootstrappers.js";
import { identities, localMultiAddrFromIdentity } from "./id.js";
import { PSIProtocol } from "../psi-protocol.js";
import { LSHDiscovery } from "../lsh-discovery.js";

const node = await createLibp2p({
  privateKey: identities.three.key,
  addresses: {
    // add a listen address (localhost) to accept TCP connections on a random port
    listen: [`/ip4/127.0.0.1/tcp/${identities.three.port}`],
  },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    dht: kadDHT({
      // protocol: "/shimmer/kad/1.0.0",
      protocol: "/shimmer/kad/1.0.0",
      //peerInfoMapper: removePrivateAddressesMapper,
      peerInfoMapper: removePublicAddressesMapper,
      clientMode: false,
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

const sketcher = new Sketcher();
const PSI = new PSIProtocol(node, sketcher);

await sketcher.sketch('words', ['1', '2', '3'])

// start libp2p
await node.start();

// Rendezvous-based peer discovery (equivalent to Go's drouting + dutil)
//const discovery = new DHTDiscovery(node, "/shimmer/peers/1.0.0");
//await discovery.startPeriodicDiscovery();


// await PSI.initiatePSI(peerIdFromPublicKey(identities.two.key.publicKey).toString(), 'words');

const lsh = new LSHDiscovery(node, sketcher, {
  onPeerDiscovered: () => {
    //console.log("TWO discovered peer")
  }
});
lsh.start();


await sketcher.sketch("words", ["1", "2", "3", "4"]);


// Keep running
console.log("\nNode THREE is running. Press Ctrl+C to stop.");
await sleep(1000000);
