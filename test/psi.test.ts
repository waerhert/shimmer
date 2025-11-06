import { describe, it, expect } from "vitest";
import { PSIServer, PSIClient } from "../src/psi.js";
import { Sketcher } from "../src/sketcher.js";

describe("PSI", () => {
  it("should compute intersection size on MinHash signatures", async () => {
    const alice = new Sketcher();
    const bob = new Sketcher();

    const commonItems = Array.from({ length: 3 }, (_, i) => `common_${i}`);
    const aliceUnique = Array.from({ length: 1 }, (_, i) => `alice_${i}`);
    const bobUnique = Array.from({ length: 1 }, (_, i) => `bob_${i}`);

    const aliceOriginalItems = [...commonItems, ...aliceUnique];
    const bobOriginalItems = [...commonItems, ...bobUnique];
    const originalOverlapPercentage = (commonItems.length / aliceOriginalItems.length) * 100;

    await alice.sketch("words", aliceOriginalItems);
    await bob.sketch("words", bobOriginalItems);

    const sigAlice = alice.getModalityState("words")?.signature;
    const sigBob = bob.getModalityState("words")?.signature;

    // Convert signatures to strings for PSI
    const aliceItems = sigAlice!.map((i) => i.toString(16).padStart(16, "0"));
    const bobItems = sigBob!.map((i) => i.toString(16).padStart(16, "0"));

    // Alice creates server, Bob creates client
    const server = new PSIServer();
    const client = new PSIClient();

    // Alice: createSetup() -> serialized setup
    const serializedSetup = server.createSetup(aliceItems, sigBob!.length);

    // Bob: createRequest() -> serialized request
    const serializedRequest = client.createRequest(bobItems);

    // Alice: processRequest(bob's request) -> serialized response
    const serializedResponse = server.processRequest(serializedRequest);

    // Bob: getIntersectionSize(alice's setup, alice's response) -> number
    const intersectionSize = client.getIntersectionSize(
      serializedSetup,
      serializedResponse
    );

    const matchPercentage = (intersectionSize / bobItems.length) * 100;

    console.log("=== PSI on MinHash Signatures ===");
    console.log("Original items overlap:", `${commonItems.length}/${aliceOriginalItems.length} (${originalOverlapPercentage.toFixed(1)}%)`);
    console.log("Bob's signature length:", bobItems.length);
    console.log("Signature intersection size:", intersectionSize);
    console.log("Match percentage:", matchPercentage.toFixed(1) + "%");

    // MinHash is probabilistic - signature match percentage varies based on original overlap
    // This variance is normal for MinHash with moderate k values
    expect(intersectionSize).toBeGreaterThan(0); // At least some match
    expect(matchPercentage).toBeGreaterThanOrEqual(50); // At least 50%
    expect(matchPercentage).toBeLessThanOrEqual(100); // Can't exceed 100%
  });

  it("should compute intersection size on raw items", async () => {
    const commonItems = Array.from({ length: 4 }, (_, i) => `common_${i}`);
    const aliceUnique = Array.from({ length: 1 }, (_, i) => `alice_${i}`);
    const bobUnique = Array.from({ length: 1 }, (_, i) => `bob_${i}`);

    const aliceItems = [...commonItems, ...aliceUnique];
    const bobItems = [...commonItems, ...bobUnique];
    const expectedIntersection = commonItems.length;

    // Alice creates server, Bob creates client
    const server = new PSIServer();
    const client = new PSIClient();

    // Alice: createSetup() -> serialized setup
    const serializedSetup = server.createSetup(aliceItems, bobItems.length);

    // Bob: createRequest() -> serialized request
    const serializedRequest = client.createRequest(bobItems);

    // Alice: processRequest(bob's request) -> serialized response
    const serializedResponse = server.processRequest(serializedRequest);

    // Bob: getIntersectionSize(alice's setup, alice's response) -> number
    const intersectionSize = client.getIntersectionSize(
      serializedSetup,
      serializedResponse
    );

    const matchPercentage = (intersectionSize / bobItems.length) * 100;

    console.log("\n=== PSI on Raw Items ===");
    console.log("Alice items count:", aliceItems.length);
    console.log("Bob items count:", bobItems.length);
    console.log("Expected intersection:", expectedIntersection);
    console.log("Actual intersection size:", intersectionSize);
    console.log("Match percentage:", matchPercentage.toFixed(1) + "% (of Bob's items)");

    // With raw items, we expect ~80% match (4 out of 5 items match)
    // Allow small margin for PSI false positive rate
    const expectedMatchPercentage = (expectedIntersection / bobItems.length) * 100;
    expect(matchPercentage).toBeGreaterThanOrEqual(expectedMatchPercentage - 5); // Within 5% margin
    expect(matchPercentage).toBeLessThanOrEqual(expectedMatchPercentage + 5); // Within 5% margin
  });
});
