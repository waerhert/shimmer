import { peerIdFromPublicKey, peerIdFromString } from "@libp2p/peer-id";
import { HTTPEncryptedRendezVous } from "../rendezvous/http-client.js";
import { Sketcher } from "../sketcher/Sketcher.js";
import { multiaddr } from "@multiformats/multiaddr";
import { identities } from "./id.js";

const client = new HTTPEncryptedRendezVous('http://localhost:8771');

const sketcher = new Sketcher();

await sketcher.sketch('words', ['1', '2']);

const tags = sketcher.getTags('words')!;

await client.announce(tags, {
    id: peerIdFromPublicKey(identities.one.key.publicKey),
    multiaddrs: [multiaddr('/ip4/127.0.0.1/tcp/4001')]
}, tags.expiresAt);


client.discover(tags).then(console.log)