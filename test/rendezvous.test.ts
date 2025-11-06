import { describe, it, expect } from "vitest";
import { InMemoryRendezVous } from "../src/rendezvous.js";
import { Sketcher } from "../src/sketcher.js";
import { before } from "node:test";
import { sleep } from "../src/util.js";

describe("InMemoryRendezVous", () => {
  it("should allow Alice to announce and Bob to discover via shared tags", async () => {
    const rendezvous = new InMemoryRendezVous();
    const alice = new Sketcher();
    const bob = new Sketcher();

    await alice.sketch("words", ["apple", "tree", "house", "car"]);
    await bob.sketch("words", ["apple", "tree", "house", "pet"]);

    const aliceTags = alice.getTags().get("words")?.publicTags;
    const bobTags = bob.getTags().get("words")?.publicTags;

    expect(aliceTags).toBeDefined();
    expect(bobTags).toBeDefined();

    // Alice publishes
    await rendezvous.announce(aliceTags!, "alice", 60);

    // Bob searches
    const discovered = await rendezvous.discover(bobTags!);

    expect(discovered).toHaveLength(1);
    expect(discovered).toContain("alice");
  });

  it("should respect TTL and not return expired announcements", async () => {
    const rendezvous = new InMemoryRendezVous();
    const alice = new Sketcher();
    const bob = new Sketcher();

    await alice.sketch("words", ["apple", "tree", "house", "car"]);
    await bob.sketch("words", ["apple", "tree", "house", "pet"]);

    const aliceTags = alice.getTags().get("words")?.publicTags;
    const bobTags = bob.getTags().get("words")?.publicTags;

    expect(aliceTags).toBeDefined();
    expect(bobTags).toBeDefined();

    // Alice publishes with a ttl of 1 second
    await rendezvous.announce(aliceTags!, "alice", 1);

    // Time passes
    await sleep(1100);

    // Bob searches
    const discovered = await rendezvous.discover(bobTags!);

    expect(discovered).toHaveLength(0);
  });
});
