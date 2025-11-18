import { peerIdFromPublicKey, peerIdFromString } from "@libp2p/peer-id";
import { HTTPEncryptedRendezVous } from "../rendezvous/http-client.js";
import { Sketcher } from "../sketcher/sketcher.js";
import { multiaddr } from "@multiformats/multiaddr";
import { identities } from "./id.js";

const client = new HTTPEncryptedRendezVous('http://localhost:8771');

const sketcher = new Sketcher();

const sketch = await sketcher.sketch('words', ['1', '2']);



await client.announce(sketch.tags, {
    id: peerIdFromPublicKey(identities.one.key.publicKey),
    multiaddrs: [multiaddr('/ip4/127.0.0.1/tcp/4001')]
}, sketch.expiresAt);


client.discover(sketch.tags).then(console.log)