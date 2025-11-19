import PSI from "@openmined/psi.js";
import type { Client } from "@openmined/psi.js/implementation/client.js";
import type { Server } from "@openmined/psi.js/implementation/server.js";

let psi: any = null;

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

const fpr = 0.001; // false positive rate (0.1%)

export class PSIServer {
  private server: Server;

  private constructor(server: Server) {
    this.server = server;
  }

  static async create(): Promise<PSIServer> {
    await ensureInit();
    const server = psi.server!.createWithNewKey();
    return new PSIServer(server);
  }

  createSetup(items: string[], numClientElements: number): Uint8Array {
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
  // This method calls this.server.delete() which deletes the server in wasm, as recommended
  // this means this instance becomes unusable once processRequest() has run
  processRequest(serializedClientRequest: Uint8Array): Uint8Array {
    // Deserialize the client request for the server
    const deserializedClientRequest = psi.request.deserializeBinary(
      serializedClientRequest
    );

    const serverResponse = this.server.processRequest(
      deserializedClientRequest
    );

    const serializedServerResponse = serverResponse.serializeBinary();

    this.server.delete();

    return serializedServerResponse;
  }
}

export class PSIClient {
  private client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  static async create(): Promise<PSIClient> {
    await ensureInit();
    const client = psi.client!.createWithNewKey();
    return new PSIClient(client);
  }

  createRequest(items: string[]): Uint8Array {
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

    return intersectionSize;
  }
}

/**
 * Factory function to create a PSI server
 * Ensures WASM initialization before creating the server
 */
export async function createPSIServer(): Promise<PSIServer> {
  return PSIServer.create();
}

/**
 * Factory function to create a PSI client
 * Ensures WASM initialization before creating the client
 */
export async function createPSIClient(): Promise<PSIClient> {
  return PSIClient.create();
}
