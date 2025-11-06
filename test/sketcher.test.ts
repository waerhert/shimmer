import { describe, it, expect } from "vitest";
import { Sketcher } from "../src/sketcher.js";

describe("Sketcher", () => {
  it("should produce overlapping tags for Alice and Bob with similar words", async () => {
    const alice = new Sketcher();
    const bob = new Sketcher();

    // 75% overlap (3 out of 4 words match)
    await alice.sketch('words', ['apple', 'tree', 'house', 'car']);
    await bob.sketch('words', ['apple', 'tree', 'house', 'pet']);

    const aliceTags = alice.getTags().get('words')?.publicTags;
    const bobTags = bob.getTags().get('words')?.publicTags;

    expect(aliceTags).toBeDefined();
    expect(bobTags).toBeDefined();

    const overlap = aliceTags?.filter(tag => bobTags?.includes(tag));

    // With 32 bands and 75% Jaccard similarity, we expect high collision probability
    expect(overlap?.length).toBeGreaterThan(0);
  });

  it("should produce different tags for different epochs", async () => {
    const sketcher = new Sketcher({
      words: { k: 64, bands: 32, epochInterval: "5m" }
    });

    // Mock time at 12:00
    const originalNow = Date.now;
    Date.now = () => 1730898000000; // Fixed timestamp

    await sketcher.sketch('words', ['apple', 'tree', 'house', 'car']);
    const tags1 = sketcher.getTags().get('words')?.publicTags;

    // Mock time at 12:10 (different 5m epoch)
    Date.now = () => 1730898600000; // +10 minutes

    await sketcher.sketch('words', ['apple', 'tree', 'house', 'car']);
    const tags2 = sketcher.getTags().get('words')?.publicTags;

    // Restore
    Date.now = originalNow;

    // Tags should be completely different (different salt due to epoch)
    expect(tags1).toBeDefined();
    expect(tags2).toBeDefined();
    expect(tags1?.some(tag => tags2?.includes(tag))).toBe(false);
  });

  it("should invalidate stale modalities in getTags()", async () => {
    const sketcher = new Sketcher({
      words: { k: 64, bands: 32, epochInterval: "5m" }
    });

    const originalNow = Date.now;
    Date.now = () => 1730898000000; // 12:00

    await sketcher.sketch('words', ['apple', 'tree', 'house', 'car']);

    // Tags should be present in same epoch
    expect(sketcher.getTags().get('words')).toBeDefined();

    // Advance time to next epoch (12:10)
    Date.now = () => 1730898600000;

    // getTags() should drop stale modality
    expect(sketcher.getTags().get('words')).toBeUndefined();

    Date.now = originalNow;
  });

  it("should handle multiple modalities independently", async () => {
    const sketcher = new Sketcher({
      wifi: { k: 128, bands: 32, epochInterval: "5m" },
      words: { k: 64, bands: 32, epochInterval: "10m" }
    });

    await sketcher.sketch('wifi', ['SSID_A', 'SSID_B']);
    await sketcher.sketch('words', ['apple', 'tree']);

    const tags = sketcher.getTags();

    // Both modalities should be present
    expect(tags.get('wifi')).toBeDefined();
    expect(tags.get('words')).toBeDefined();

    // Each should have correct number of bands
    expect(tags.get('wifi')?.publicTags.length).toBe(32);
    expect(tags.get('words')?.publicTags.length).toBe(32);
  });
});