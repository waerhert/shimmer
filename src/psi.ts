import PSI from "@openmined/psi.js";
import type { Client } from "@openmined/psi.js/implementation/client.js";
import type { Server } from "@openmined/psi.js/implementation/server.js";

let psi: any = null;

// TODO this is messy
async function ensureInit() {
  if (!psi) {
    if (!PSI.default) {
     // @ts-ignore
      psi = await PSI();
    } else {
      psi = await PSI.default();
    }
  }
}

await ensureInit();

const fpr = 0.001; // false positive rate (0.1%)

export class PSIServer {
  private server: Server | null = psi.server!.createWithNewKey();

  createSetup(items: string[], numClientElements: number): Uint8Array {
    if (!this.server) {
      throw new Error("Server has been deleted");
    }
    if (items.length === 0) {
      throw new Error("items cannot be empty");
    }
    const setupMessage = this.server.createSetupMessage(
      fpr,
      numClientElements,
      items
    );
    const serializedSetupMessage = setupMessage.serializeBinary();

    return serializedSetupMessage;
  }

  // The return result is sent to the client, along with the serializedServerSetupMessage (above)
  // This methos calls this.server.delete() which deletes the server in wasm, as recommended
  // this means this instance becomes unusable once processRequest() has run
  processRequest(serializedClientRequest: Uint8Array): Uint8Array {
    if (!this.server) {
      throw new Error("Server has been deleted");
    }
    // Deserialize the client request for the server
    const deserializedClientRequest = psi.request.deserializeBinary(
      serializedClientRequest
    );

    const serverResponse = this.server.processRequest(
      deserializedClientRequest
    );

    const serializedServerResponse = serverResponse.serializeBinary();

    this.server.delete();
    this.server = null;

    return serializedServerResponse;
  }
}

export class PSIClient {
  private client: Client | null = psi.client!.createWithNewKey();

  createRequest(items: string[]): Uint8Array {
    if (!this.client) {
      throw new Error("Client has been deleted");
    }
    const clientRequest = this.client.createRequest(items);
    const serializedClientRequest = clientRequest.serializeBinary();
    return serializedClientRequest;
  }

  // gets the intersection size and deletes the client, causing
  // this instance to become unusable
  getIntersectionSize(
    serializedServerSetup: Uint8Array,
    serializedServerResponse: Uint8Array
  ): number {
    if (!this.client) {
      throw new Error("Client has been deleted");
    }
    const deserializedServerResponse = psi.response.deserializeBinary(
      serializedServerResponse
    );
    const deserializedServerSetup = psi.serverSetup.deserializeBinary(
      serializedServerSetup
    );

    const intersectionSize = this.client.getIntersectionSize(
      deserializedServerSetup,
      deserializedServerResponse
    );

    this.client.delete();
    this.client = null;

    return intersectionSize;
  }
}
