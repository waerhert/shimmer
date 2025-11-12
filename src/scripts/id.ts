// Fixed peer ID so two.ts can always connect to the same peer

import { generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import type { PrivateKey, PublicKey } from "@libp2p/interface";
import { peerIdFromPublicKey } from "@libp2p/peer-id";

export async function seedFromPhrase(str: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(str + "219847923874932khewiurwe")
    )
  );
}

export function localMultiAddrFromIdentity(id: { key: PrivateKey, port: number}): string {
  return `/ip4/127.0.0.1/tcp/${id.port}/p2p/${peerIdFromPublicKey(id.key.publicKey)}`;
}

export const identities = {
  one: {
    key: await generateKeyPairFromSeed(
      "Ed25519",
      await seedFromPhrase("one")
    ),
    port: 4526,
  },
  two: {
    key: await generateKeyPairFromSeed(
      "Ed25519",
      await seedFromPhrase("two")
    ),
    port: 4527,
  },
  three: {
    key: await generateKeyPairFromSeed(
      "Ed25519",
      await seedFromPhrase("three")
    ),
    port: 4528,
  },
};
