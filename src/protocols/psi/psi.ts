import type { Sketcher } from "../../sketcher/sketcher.js";
import type { Sketch } from "../../sketcher/sketch.js";
import { PSIServer, PSIClient } from "./helpers.js";
import { lpStream, type LengthPrefixedStream } from "@libp2p/utils";
import type {
  Connection,
  PeerId,
  PeerInfo,
  PeerStore,
  Stream,
  Startable,
} from "@libp2p/interface";
import { TypedEventEmitter } from "main-event";
import { ProximityPeer } from "../../peers/peer.js";
import { PSI_TIMEOUT_MS } from "./constants.js";
import type {
  PSIProtocolComponents,
  PSIProtocolInit,
  PSIResult,
  PSICompleteEvent,
  PSIProtocol as PSIProtocolInterface,
} from "./index.js";

interface PSIProtocolEventMap {
  "psi:complete": CustomEvent<PSICompleteEvent>;
}

/**
 * PSIProtocol - Custom libp2p protocol for Private Set Intersection handshakes
 *
 * Implements /shimmer/psi/1.0.0 protocol for computing similarity between peers
 * using their MinHash signatures without revealing the actual items.
 */
export class PSIProtocol<T extends string = string>
  extends TypedEventEmitter<PSIProtocolEventMap>
  implements Startable, PSIProtocolInterface<T> {
  public readonly protocol: string;
  private readonly components: PSIProtocolComponents;
  private readonly sketcher: Sketcher<T>;
  private readonly init: PSIProtocolInit;
  private readonly timeout: number;
  private started: boolean;

  constructor(
    components: PSIProtocolComponents,
    sketcher: Sketcher<T>,
    init: PSIProtocolInit = {}
  ) {
    super();

    this.started = false;
    this.components = components;
    this.sketcher = sketcher;
    this.protocol = '/shimmer/psi/1.0.0';
    this.init = init;
    this.timeout = init.timeout ?? PSI_TIMEOUT_MS;
  }

  readonly [Symbol.toStringTag] = '@shimmer/psi';

  async start(): Promise<void> {
    await this.components.registrar.handle(
      this.protocol,
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
    this.started = true;
  }

  async stop(): Promise<void> {
    await this.components.registrar.unhandle(this.protocol);
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
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
      if (await isOngoing(this.components.peerStore, remotePeerId)) {
        stream.close();
        throw new Error(`PSI already ongoing with peer ${remotePeerId.toString()}`);
      }

      // Mark as ongoing to prevent race conditions
      await markOngoing(this.components.peerStore, remotePeerId);

      const lp = lpStream(stream);

      // Wrap PSI execution with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`PSI timeout after ${this.timeout}ms`)),
          this.timeout
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
      this.dispatchEvent(
        new CustomEvent("psi:complete", {
          detail: { peer, sketch: usedSketch!, result },
        })
      );

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
        await unmarkOngoing(this.components.peerStore, remotePeerId);
      } catch (unmarkErr) {
        console.warn(`[PSIProtocol] Error unmarking ongoing:`, unmarkErr);
      }
    }
  }


  /**
   * Wait for a direct (non-limited) connection to a peer
   * This prevents opening protocol streams on limited relay connections
   *
   * @param remotePeerId - Peer to wait for direct connection to
   * @param timeoutMs - Maximum time to wait for direct connection (default: 10000ms)
   */
  private async waitForDirectConnection(
    remotePeerId: PeerId,
    timeoutMs: number = 10000
  ): Promise<void> {
    const startTime = Date.now();

    // Check if we already have a direct connection
    const connections = this.components.connectionManager.getConnections(remotePeerId);
    const hasDirectConnection = connections.some(conn => !conn.limits);

    if (hasDirectConnection) {
      console.log(`[PSIProtocol] Direct connection to ${remotePeerId.toString()} already available`);
      return;
    }

    console.log(`[PSIProtocol] Waiting for direct connection to ${remotePeerId.toString()}...`);

    // Wait for a direct connection to be established
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const conns = this.components.connectionManager.getConnections(remotePeerId);
        const directConn = conns.find(conn => !conn.limits);

        if (directConn) {
          clearInterval(checkInterval);
          console.log(
            `[PSIProtocol] Direct connection established to ${remotePeerId.toString()} via ${directConn.remoteAddr.toString()}`
          );
          resolve();
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          console.warn(
            `[PSIProtocol] Timeout waiting for direct connection to ${remotePeerId.toString()}, proceeding with limited connection`
          );
          // Don't reject - proceed with limited connection and let it fail if needed
          resolve();
        }
      }, 100); // Check every 100ms
    });
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
      if (await isOngoing(this.components.peerStore, remotePeerId)) {
        throw new Error(`PSI already ongoing with peer ${remotePeerId.toString()}`);
      }

      // Mark as ongoing to prevent race conditions
      await markOngoing(this.components.peerStore, remotePeerId);

      // Wait for a direct (non-limited) connection if we only have limited ones
      await this.waitForDirectConnection(remotePeerId);

      // Open stream to remote peer
      stream = await this.components.connectionManager.openStream(
        remotePeerId,
        [this.protocol],
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
          () => reject(new Error(`PSI timeout after ${this.timeout}ms`)),
          this.timeout
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
      this.dispatchEvent(
        new CustomEvent("psi:complete", {
          detail: { peer, sketch, result },
        })
      );

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
        await unmarkOngoing(this.components.peerStore, remotePeerId);
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
