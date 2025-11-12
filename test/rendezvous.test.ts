import { describe, it, expect } from "vitest";
import { InMemoryRendezVous } from "../src/rendezvous.js";
import { Sketcher } from "../src/sketcher.js";
import { sleep } from "../src/util.js";
import type { PeerInfo } from "@libp2p/interface";
import { peerIdFromString } from "@libp2p/peer-id";
import { multiaddr } from "@multiformats/multiaddr";

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
