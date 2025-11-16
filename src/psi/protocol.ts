import type { Libp2p } from "libp2p";
import type { Sketcher } from "../sketcher/sketcher.js";
import type { Sketch } from "../sketcher/sketch.js";
import { PSIServer, PSIClient } from "./psi.js";
import { lpStream, type LengthPrefixedStream } from "@libp2p/utils";
import type {
  Connection,
  PeerId,
  PeerInfo,
  PeerStore,
  Stream,
} from "@libp2p/interface";
import { EventEmitter } from "node:events";
import { ProximityPeer } from "../peers/peer.js";

const PROTOCOL_ID = "/shimmer/psi/1.0.0";
const PSI_TIMEOUT_MS = 30000; // 30 seconds timeout for PSI operations

export interface PSIProtocolOptions {
  similarityThreshold?: number; // Minimum similarity % to consider peer as "in proximity" (default: 50)
}

export interface PSIResult {
  similarity: number;
  intersectionSize: number;
  totalItems: number;
  completedAt: number;
}

export interface PSICompleteEvent {
  peer: ProximityPeer;
  sketch: Sketch;
  result: PSIResult;
}

interface PSIProtocolEventMap {
  "psi:complete": [data: PSICompleteEvent];
}

/**
 * PSIProtocol - Custom libp2p protocol for Private Set Intersection handshakes
 *
 * Implements /shimmer/psi/1.0.0 protocol for computing similarity between peers
 * using their MinHash signatures without revealing the actual items.
 */
export class PSIProtocol<T extends string = string> extends EventEmitter<PSIProtocolEventMap> {
  private node: Libp2p;
  private sketcher: Sketcher<T>;
  private options: Required<PSIProtocolOptions>;

  constructor(
    node: Libp2p,
    sketcher: Sketcher<T>,
    options: PSIProtocolOptions = {}
  ) {
    super();

    this.node = node;
    this.sketcher = sketcher;
    this.options = {
      similarityThreshold: options.similarityThreshold ?? 50,
    };

    // Register protocol handler
    this.registerProtocolHandler();
  }

  private async actAsClient(
    lp: LengthPrefixedStream,
    stream: Stream,
    remotePeerId: string,
    sketch: Sketch
  ): Promise<PSIResult> {
    try {
      const modality = sketch.modality as T;
      const ourItems = sketch.items;

      // Create PSI client and request
      const client = new PSIClient();
      const clientRequest = client.createRequest(ourItems);

      // Send the request
      await lp.write(
        new TextEncoder().encode(
          JSON.stringify({
            modality,
            clientRequest: Array.from(clientRequest),
          })
        )
      );

      // Read the response
      const responseData = await lp.read();
      const response = JSON.parse(
        new TextDecoder().decode(responseData.subarray())
      );

      const setupMessage = Uint8Array.from(response.setupMessage);
      const serverResponse = Uint8Array.from(response.serverResponse);

      // Compute intersection size
      const intersectionSize = client.getIntersectionSize(
        setupMessage,
        serverResponse
      );
      const similarity = (intersectionSize / ourItems.length) * 100;

      console.log(
        `[PSIProtocol] PSI with ${remotePeerId} for ${modality}: ${similarity.toFixed(
          1
        )}% similarity`
      );

      return {
        similarity,
        intersectionSize,
        totalItems: ourItems.length,
        completedAt: Date.now(),
      };
    } catch (err) {
      console.error(
        `[PSIProtocol] Failed to act as client with ${remotePeerId}:`,
        err
      );
      stream.abort(err instanceof Error ? err : new Error(String(err)));
      throw err; // Propagate error instead of returning zeros
    }
  }

  private async actAsServer(
    lp: LengthPrefixedStream,
    stream: Stream,
    remotePeerId: string
  ): Promise<T> {
    try {
      // Read the incoming request
      const requestData = await lp.read();
      const request = JSON.parse(
        new TextDecoder().decode(requestData.subarray())
      );

      console.log(
        `[PSIProtocol] Received PSI request from ${remotePeerId} for modality: ${request.modality}`
      );

      // Get our items for this modality (use original items, not signature)
      const sketch = this.sketcher.getCurrentSketch(request.modality);
      if (!sketch) {
        throw new Error(`No sketch data for modality: ${request.modality}`);
      }

      // Use original items for PSI (exact intersection, not lossy signature)
      const ourItems = sketch.items;

      // Create PSI server and process request
      const server = new PSIServer();
      const clientRequest = Uint8Array.from(request.clientRequest);
      const setupMessage = server.createSetup(ourItems, ourItems.length);
      const serverResponse = server.processRequest(clientRequest);

      // Write the response
      await lp.write(
        new TextEncoder().encode(
          JSON.stringify({
            setupMessage: Array.from(setupMessage),
            serverResponse: Array.from(serverResponse),
          })
        )
      );

      console.log(
        `[PSIProtocol] Sent PSI response to ${remotePeerId} for modality: ${request.modality}`
      );

      return request.modality as T;
    } catch (err) {
      console.error(
        `[PSIProtocol] Error acting as server for ${remotePeerId}:`,
        err
      );
      stream.abort(err instanceof Error ? err : new Error(String(err)));
      throw err; // Propagate error instead of returning "none"
    }
  }

  /**
   * Handle incoming PSI negotiation
   * Flow: We act as SERVER first (receive request), then CLIENT (send request)
   */
  private async handleIncomingPSI(
    stream: Stream,
    connection: Connection
  ): Promise<void> {
    const remotePeerId = connection.remotePeer;
    let modality: T | undefined;
    let usedSketch: Sketch | undefined;

    console.log(`[PSIProtocol] Handling incoming PSI from ${remotePeerId.toString()}`);

    try {
      // Check if PSI is already ongoing
      if (await isOngoing(this.node.peerStore, remotePeerId)) {
        stream.close();
        throw new Error(`PSI already ongoing with peer ${remotePeerId.toString()}`);
      }

      // Mark as ongoing to prevent race conditions
      await markOngoing(this.node.peerStore, remotePeerId);

      const lp = lpStream(stream);

      // Wrap PSI execution with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`PSI timeout after ${PSI_TIMEOUT_MS}ms`)),
          PSI_TIMEOUT_MS
        );
      });

      const psiExecution = async (): Promise<PSIResult> => {
        // Step 1: Act as SERVER (receive their request, send our response)
        modality = await this.actAsServer(lp, stream, remotePeerId.toString());

        // Step 2: Get our sketch for this modality
        usedSketch = this.sketcher.getCurrentSketch(modality);
        if (!usedSketch) {
          throw new Error(`No sketch for modality ${modality} after receiving PSI`);
        }

        // Step 3: Act as CLIENT (send our request, receive their response)
        const result = await this.actAsClient(
          lp,
          stream,
          remotePeerId.toString(),
          usedSketch
        );

        return result;
      };

      const result = await Promise.race([psiExecution(), timeoutPromise]);

      // Create ProximityPeer for the event
      const peerInfo: PeerInfo = {
        id: connection.remotePeer,
        multiaddrs: [connection.remoteAddr],
      };
      const peer = new ProximityPeer(peerInfo);

      // Emit completion event ONLY on success
      this.emit("psi:complete", {
        peer,
        sketch: usedSketch!,
        result,
      });

      console.log(
        `[PSIProtocol] Incoming PSI completed with ${remotePeerId.toString()}: ${result.similarity.toFixed(1)}%`
      );
    } catch (err) {
      console.error(
        `[PSIProtocol] Incoming PSI failed with ${remotePeerId.toString()}:`,
        err
      );
      throw err;
    } finally {
      // Guaranteed cleanup
      try {
        stream.close();
      } catch (closeErr) {
        console.warn(`[PSIProtocol] Error closing stream:`, closeErr);
      }

      try {
        await unmarkOngoing(this.node.peerStore, remotePeerId);
      } catch (unmarkErr) {
        console.warn(`[PSIProtocol] Error unmarking ongoing:`, unmarkErr);
      }
    }
  }

  private registerProtocolHandler(): void {
    (this.node as any).registrar.handle(
      PROTOCOL_ID,
      async (stream: Stream, connection: Connection) => {
        try {
          await this.handleIncomingPSI(stream, connection);
        } catch (err) {
          // Error already logged in handleIncomingPSI - don't emit psi:complete on failure
          console.error(
            `[PSIProtocol] Incoming PSI handler failed for ${connection.remotePeer.toString()}:`,
            err
          );
        }
      }
    );
  }

  /**
   * Initiate PSI handshake with a peer
   * Flow: We act as CLIENT first (send request), then SERVER (receive request)
   *
   * @param peer - ProximityPeer to initiate PSI with
   * @param sketch - Sketch containing items and modality (avoids temporal coupling)
   */
  public async initiatePSI(
    peer: ProximityPeer,
    sketch: Sketch
  ): Promise<PSIResult> {
    const remotePeerId = peer.peerInfo.id;
    const modality = sketch.modality as T;
    let stream: Stream | undefined;

    console.log(
      `[PSIProtocol] Initiating PSI with ${remotePeerId.toString()} for modality: ${modality}`
    );

    try {
      // Check if PSI is already ongoing
      if (await isOngoing(this.node.peerStore, remotePeerId)) {
        throw new Error(`PSI already ongoing with peer ${remotePeerId.toString()}`);
      }

      // Mark as ongoing to prevent race conditions
      await markOngoing(this.node.peerStore, remotePeerId);

      // Open stream to remote peer
      stream = await (this.node as any).connectionManager.openStream(
        remotePeerId,
        [PROTOCOL_ID]
      );

      if (!stream) {
        throw new Error("Failed to open stream");
      }

      // Assign to const for type narrowing in closure
      const activeStream = stream;
      const lp = lpStream(activeStream);

      // Wrap PSI execution with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`PSI timeout after ${PSI_TIMEOUT_MS}ms`)),
          PSI_TIMEOUT_MS
        );
      });

      const psiExecution = async (): Promise<PSIResult> => {
        // Step 1: Act as CLIENT (send our request, receive their response)
        const result = await this.actAsClient(
          lp,
          activeStream,
          remotePeerId.toString(),
          sketch
        );

        // Step 2: Act as SERVER (receive their request, send our response)
        await this.actAsServer(lp, activeStream, remotePeerId.toString());

        return result;
      };

      const result = await Promise.race([psiExecution(), timeoutPromise]);

      // Emit completion event ONLY on success
      this.emit("psi:complete", {
        peer,
        sketch,
        result,
      });

      console.log(
        `[PSIProtocol] Outgoing PSI completed with ${remotePeerId.toString()}: ${result.similarity.toFixed(1)}%`
      );

      return result;
    } catch (err) {
      console.error(
        `[PSIProtocol] Outgoing PSI failed with ${remotePeerId.toString()}:`,
        err
      );
      throw err;
    } finally {
      // Guaranteed cleanup
      if (stream) {
        try {
          stream.close();
        } catch (closeErr) {
          console.warn(`[PSIProtocol] Error closing stream:`, closeErr);
        }
      }

      try {
        await unmarkOngoing(this.node.peerStore, remotePeerId);
      } catch (unmarkErr) {
        console.warn(`[PSIProtocol] Error unmarking ongoing:`, unmarkErr);
      }
    }
  }
}

async function markOngoing(peerStore: PeerStore, peerId: PeerId) {
  await peerStore.merge(peerId, {
    metadata: {
      "shimmer/psi/ongoing": new Uint8Array(),
    },
  });
}

async function unmarkOngoing(peerStore: PeerStore, peerId: PeerId) {
  await peerStore.merge(peerId, {
    metadata: {
      "shimmer/psi/ongoing": undefined,
    },
  });
}

async function isOngoing(peerStore: PeerStore, peerId: PeerId) {
  const store = await peerStore.get(peerId);
  return Boolean(store.metadata.get("shimmer/psi/ongoing"));
}
