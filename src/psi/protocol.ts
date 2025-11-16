import type { Libp2p } from "libp2p";
import type { Sketcher } from "../sketcher/Sketcher.js";
import { PSIServer, PSIClient } from "./psi.js";
import { lpStream, type LengthPrefixedStream } from "@libp2p/utils";
import type {
  Connection,
  PeerId,
  PeerInfo,
  PeerStore,
  Stream,
} from "@libp2p/interface";
import { peerIdFromString } from "@libp2p/peer-id";

const PROTOCOL_ID = "/shimmer/psi/1.0.0";

export interface PSIProtocolOptions {
  similarityThreshold?: number; // Minimum similarity % to consider peer as "in proximity" (default: 50)
}

export interface PSIMetadata<T> {
  modality: T;
  epoch: string;
  timestamp: number;
  similarity: number;
  intersectionSize: number;
  totalItems: number;
  completed: true;
}

/**
 * PSIProtocol - Custom libp2p protocol for Private Set Intersection handshakes
 *
 * Implements /shimmer/psi/1.0.0 protocol for computing similarity between peers
 * using their MinHash signatures without revealing the actual items.
 */
export class PSIProtocol<T extends string = string> {
  private node: Libp2p;
  private sketcher: Sketcher<T>;
  private options: Required<PSIProtocolOptions>;
  private myPeerId: string;

  constructor(
    node: Libp2p,
    sketcher: Sketcher<T>,
    options: PSIProtocolOptions = {}
  ) {
    this.node = node;
    this.sketcher = sketcher;
    this.options = {
      similarityThreshold: options.similarityThreshold ?? 50,
    };
    this.myPeerId = (this.node as any).peerId.toString();

    // Register protocol handler
    this.registerProtocolHandler();
  }

  private async actAsClient(
    lp: LengthPrefixedStream,
    stream: Stream,
    remotePeerId: string,
    modality: T
  ): Promise<number> {
    try {
      const modalityState = this.sketcher.getModalityState(modality as any);
      if (!modalityState) {
        throw new Error(`No sketch data for modality: ${modality}`);
      }

      // Use original items for PSI (exact intersection, not lossy signature)
      const ourItems = modalityState.items;

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

      // If above threshold, record as proximity peer
      if (similarity >= this.options.similarityThreshold) {
        /*
        const proximityPeer: ProximityPeer = {
          peerId,
          modality,
          similarity,
          timestamp: Date.now(),
          intersectionSize,
          totalItems: ourItems.length,
          epoch: modalityState.epoch,
        };
        */

        return similarity;
      }
    } catch (err) {
      console.error(
        `[PSIProtocol] Failed to initiate PSI with ${remotePeerId}:`,
        err
      );
      stream.abort(err instanceof Error ? err : new Error(String(err)));
    }
    return 0;
  }

  private async actAsServer(
    lp: LengthPrefixedStream,
    stream: Stream,
    remotePeerId: string
  ): Promise<T> {
    let modalitySecondPass: T;
    try {
      // Read the incoming request
      const requestData = await lp.read();
      const request = JSON.parse(
        new TextDecoder().decode(requestData.subarray())
      );

      modalitySecondPass = request.modality as T;

      console.log(
        `[PSIProtocol] Received PSI request from ${remotePeerId} for modality: ${request.modality}`
      );

      // Get our items for this modality (use original items, not signature)
      const modalityState = this.sketcher.getModalityState(request.modality);
      if (!modalityState) {
        throw new Error(`No sketch data for modality: ${request.modality}`);
      }

      // Use original items for PSI (exact intersection, not lossy signature)
      const ourItems = modalityState.items;

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
        `[PSIProtocol] Error handling incoming PSI from ${remotePeerId}:`,
        err
      );
      stream.abort(err instanceof Error ? err : new Error(String(err)));
    }

    return "none" as T;
  }

  private async doPSI(
    existingStream: Stream | null, // null signals we have to create stream ourselves, is outward connection
    modalityFirstPass: T | null,
    ourPeerId: PeerId,
    theirPeerId: PeerId
  ): Promise<number> {
    let proximity: number;
    let modalitySecondPass: T;
    let stream: Stream;

    if (await isOngoing(this.node.peerStore, theirPeerId)) {
      // Abandon stream because already ongoing
      if (existingStream) existingStream.close();
      return 0;
    }

    if (!existingStream) {
      // Open a stream using the protocol
      stream = await (this.node as any).connectionManager.openStream(
        theirPeerId,
        [PROTOCOL_ID]
      );
    } else {
      stream = existingStream;
    }

    const lp = lpStream(stream);

    // Mark negotiation as ongoing
    await markOngoing(this.node.peerStore, theirPeerId);

    if (ourPeerId.toString() < theirPeerId.toString()) {
      // NODE A
      if (modalityFirstPass === null) {
        throw new Error("Connecting outward but modalityfirstpass is null");
      }
      proximity = await this.actAsClient(
        lp,
        stream,
        theirPeerId.toString(),
        modalityFirstPass
      );
      await this.actAsServer(lp, stream, theirPeerId.toString());
    } else {
      // NODE B
      modalitySecondPass = await this.actAsServer(
        lp,
        stream,
        theirPeerId.toString()
      );
      proximity = await this.actAsClient(
        lp,
        stream,
        theirPeerId.toString(),
        modalitySecondPass
      );
    }

    const modality = modalityFirstPass ?? modalitySecondPass!;
    // todo this is very ugly, prone to race conditions, we need to completely review the data flow and stop re-querying the sketcher
    const currentEpoch = this.sketcher.getModalityState(modality)?.epoch;
    await this.storePSIResult(
      theirPeerId.toString(),
      modality,
      proximity,
      proximity,
      proximity,
      currentEpoch
    );

    await setProximity(this.node.peerStore, theirPeerId, proximity);
    await unmarkOngoing(this.node.peerStore, theirPeerId);

    return proximity;
  }

  private registerProtocolHandler(): void {
    (this.node as any).registrar.handle(
      PROTOCOL_ID,
      async (stream: Stream, connection: Connection) => {
        this.doPSI(stream, null, this.node.peerId, connection.remotePeer);
      }
    );
  }

  /**
   * Initiate PSI handshake with a peer (we act as client)
   *
   * Implements tiebreaker logic: if both peers try to initiate simultaneously,
   * only the peer with the lexicographically smaller ID acts as client.
   */
  public async initiatePSI(peerInfo: PeerInfo, modality: T): Promise<number> {
    return await this.doPSI(null, modality, this.node.peerId, peerInfo.id);
  }

  /**
   * Store PSI result in peerStore metadata
   */
  private async storePSIResult(
    peerIdStr: string,
    modality: T,
    similarity: number,
    intersectionSize: number,
    totalItems: number,
    epoch?: string
  ): Promise<void> {
    if (!this.node.peerStore) {
      return;
    }

    try {
      // Parse peerId string to PeerId object
      const peerIdBytes = this.node.peerId.constructor as any;
      const peerId = peerIdBytes.createFromB58String
        ? peerIdBytes.createFromB58String(peerIdStr)
        : await (await import("@libp2p/peer-id")).peerIdFromString(peerIdStr);

      const psiMetadata: PSIMetadata<T> = {
        modality,
        epoch: epoch || "",
        timestamp: Date.now(),
        similarity,
        intersectionSize,
        totalItems,
        completed: true,
      };

      const metadataKey = `shimmer:psi:${modality}`;
      const metadataBytes = new TextEncoder().encode(
        JSON.stringify(psiMetadata)
      );

      await this.node.peerStore.merge(peerId, {
        metadata: { [metadataKey]: metadataBytes },
      });

      console.log(
        `[Shimmer] Stored PSI result for ${peerIdStr} (${modality}: ${similarity.toFixed(
          1
        )}%)`
      );
    } catch (err) {
      console.error(`[Shimmer] Failed to store PSI result:`, err);
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

async function setProximity(
  peerStore: PeerStore,
  peerId: PeerId,
  value: number
) {
  await peerStore.merge(peerId, {
    metadata: {
      "shimmer/psi/proximity": new Uint8Array([value]),
    },
  });
}

export async function getProximity(
  peerStore: PeerStore,
  peerId: PeerId
): Promise<number> {
  const store = await peerStore.get(peerId);

  let value: any = store.metadata.get("shimmer/psi/proximity");

  if (!value) {
    return 0;
  }

  return value[0] as number;
}
