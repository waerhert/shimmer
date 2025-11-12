import { describe, it, expect } from "vitest";
import { Sketcher } from "../src/sketcher/Sketcher.js";
import { sleep } from "../src/util.js";
import type { PeerInfo } from "@libp2p/interface";
import { peerIdFromString } from "@libp2p/peer-id";
import { multiaddr } from "@multiformats/multiaddr";
import { InMemoryRendezVous } from '../src/rendezvous/memory.js'
import { InMemoryEncryptedRendezVous } from '../src/rendezvous/memory-encrypted.js'

// Helper to create mock PeerInfo
function createMockPeerInfo(id: string, addr: string): PeerInfo {
  return {
    id: peerIdFromString(id),
    multiaddrs: [multiaddr(addr)]
  };
}

describe("InMemoryRendezVous", () => {
  it("should allow Alice to announce and Bob to discover via shared tags", async () => {
    const rendezvous = new InMemoryRendezVous();
    const alice = new Sketcher();
    const bob = new Sketcher();

    await alice.sketch("words", ["apple", "tree", "house", "car"]);
    await bob.sketch("words", ["apple", "tree", "house", "pet"]);

    const aliceTags = alice.getTags("words");
    const bobTags = bob.getTags("words");

    expect(aliceTags).toBeDefined();
    expect(bobTags).toBeDefined();

    // Alice publishes
    const alicePeerInfo = createMockPeerInfo(
      "12D3KooWRHRJuPC5HFB5rFjhMGQzrDPmpZvfWgCy8wfcXxCZvMQA",
      "/ip4/127.0.0.1/tcp/4001"
    );
    await rendezvous.announce(aliceTags!, alicePeerInfo, 60);

    // Bob searches
    const discovered = await rendezvous.discover(bobTags!);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.peerInfo.id.toString()).toBe(alicePeerInfo.id.toString());
  });

  it("should respect TTL and not return expired announcements", async () => {
    const rendezvous = new InMemoryRendezVous();
    const alice = new Sketcher();
    const bob = new Sketcher();

    await alice.sketch("words", ["apple", "tree", "house", "car"]);
    await bob.sketch("words", ["apple", "tree", "house", "pet"]);

    const aliceTags = alice.getTags("words");
    const bobTags = bob.getTags("words");

    expect(aliceTags).toBeDefined();
    expect(bobTags).toBeDefined();

    // Alice publishes with a ttl of 1 second
    const alicePeerInfo = createMockPeerInfo(
      "12D3KooWRHRJuPC5HFB5rFjhMGQzrDPmpZvfWgCy8wfcXxCZvMQA",
      "/ip4/127.0.0.1/tcp/4001"
    );
    await rendezvous.announce(aliceTags!, alicePeerInfo, 1);

    // Time passes
    await sleep(1100);

    // Bob searches
    const discovered = await rendezvous.discover(bobTags!);

    expect(discovered).toHaveLength(0);
  });
});

describe("InMemoryEncryptedRendezVous", () => {
  it("should allow Alice to announce encrypted and Bob to discover with matching preImages", async () => {
    const rendezvous = new InMemoryEncryptedRendezVous();
    const alice = new Sketcher();
    const bob = new Sketcher();

    // Alice and Bob have similar items, so they'll have overlapping tags
    await alice.sketch("words", ["apple", "tree", "house", "car"]);
    await bob.sketch("words", ["apple", "tree", "house", "pet"]);

    const aliceTags = alice.getTags("words");
    const bobTags = bob.getTags("words");

    expect(aliceTags).toBeDefined();
    expect(bobTags).toBeDefined();

    // Alice publishes with encryption
    const alicePeerInfo = createMockPeerInfo(
      "12D3KooWRHRJuPC5HFB5rFjhMGQzrDPmpZvfWgCy8wfcXxCZvMQA",
      "/ip4/127.0.0.1/tcp/4001"
    );
    await rendezvous.announce(aliceTags!, alicePeerInfo, 60);

    // Bob searches with his tags (which include matching preImages)
    const discovered = await rendezvous.discover(bobTags!);

    // Bob should be able to decrypt and discover Alice
    expect(discovered.length).toBeGreaterThan(0);
    const aliceDiscovery = discovered.find(
      (p) => p.peerInfo.id.toString() === alicePeerInfo.id.toString()
    );
    expect(aliceDiscovery).toBeDefined();
    expect(aliceDiscovery?.peerInfo.multiaddrs[0]?.toString()).toBe("/ip4/127.0.0.1/tcp/4001");
  });

  it("should NOT decrypt announcements without matching preImages", async () => {
    const rendezvous = new InMemoryEncryptedRendezVous();
    const alice = new Sketcher();

    await alice.sketch("words", ["apple", "tree", "house", "car"]);

    const aliceTags = alice.getTags("words");
    expect(aliceTags).toBeDefined();

    // Alice publishes with encryption
    const alicePeerInfo = createMockPeerInfo(
      "12D3KooWRHRJuPC5HFB5rFjhMGQzrDPmpZvfWgCy8wfcXxCZvMQA",
      "/ip4/127.0.0.1/tcp/4001"
    );
    await rendezvous.announce(aliceTags!, alicePeerInfo, 60);

    // Charlie has the SAME publicTags but WRONG preImages
    const charlieTagsWithWrongPreImages = {
      publicTags: aliceTags!.publicTags, // Same tags - so he finds the entries
      preImages: aliceTags!.preImages.map(() => "dummy-wrong-preimage") // Wrong preImages - so decryption fails
    };

    // Charlie searches with same publicTags but wrong preImages
    const discovered = await rendezvous.discover(charlieTagsWithWrongPreImages);

    // Charlie should NOT find Alice (decryption fails with wrong preImages)
    expect(discovered).toHaveLength(0);
  });

  it("should respect TTL with encrypted announcements", async () => {
    const rendezvous = new InMemoryEncryptedRendezVous();
    const alice = new Sketcher();
    const bob = new Sketcher();

    await alice.sketch("words", ["apple", "tree", "house", "car"]);
    await bob.sketch("words", ["apple", "tree", "house", "pet"]);

    const aliceTags = alice.getTags("words");
    const bobTags = bob.getTags("words");

    expect(aliceTags).toBeDefined();
    expect(bobTags).toBeDefined();

    // Alice publishes with 1 second TTL
    const alicePeerInfo = createMockPeerInfo(
      "12D3KooWRHRJuPC5HFB5rFjhMGQzrDPmpZvfWgCy8wfcXxCZvMQA",
      "/ip4/127.0.0.1/tcp/4001"
    );
    await rendezvous.announce(aliceTags!, alicePeerInfo, 1);

    // Time passes
    await sleep(1100);

    // Bob searches - should find nothing as TTL expired
    const discovered = await rendezvous.discover(bobTags!);

    expect(discovered).toHaveLength(0);
  });

  it("should handle multiple peers with overlapping encrypted tags", async () => {
    const rendezvous = new InMemoryEncryptedRendezVous();
    const alice = new Sketcher();
    const bob = new Sketcher();
    const carol = new Sketcher();

    // All three have similar items
    await alice.sketch("words", ["apple", "tree", "house", "car"]);
    await bob.sketch("words", ["apple", "tree", "house", "pet"]);
    await carol.sketch("words", ["apple", "tree", "house", "bird"]);

    const aliceTags = alice.getTags("words");
    const bobTags = bob.getTags("words");
    const carolTags = carol.getTags("words");

    // Alice and Bob both announce
    const alicePeerInfo = createMockPeerInfo(
      "12D3KooWRHRJuPC5HFB5rFjhMGQzrDPmpZvfWgCy8wfcXxCZvMQA",
      "/ip4/127.0.0.1/tcp/4001"
    );
    const bobPeerInfo = createMockPeerInfo(
      "12D3KooWBvMjNdHmvz8vBRYHqG7Zf6JkXj2NRcDxjKv5aYhGZ3Qw",
      "/ip4/127.0.0.1/tcp/4002"
    );

    await rendezvous.announce(aliceTags!, alicePeerInfo, 60);
    await rendezvous.announce(bobTags!, bobPeerInfo, 60);

    // Carol discovers - should find both Alice and Bob
    const discovered = await rendezvous.discover(carolTags!);

    expect(discovered.length).toBeGreaterThan(0);

    // Check that Carol found distinct peers
    const peerIds = new Set(discovered.map((p) => p.peerInfo.id.toString()));
    expect(peerIds.size).toBe(discovered.length); // No duplicates
  });
});
