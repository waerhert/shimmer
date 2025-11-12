import type { Libp2p } from "libp2p";
import type { Sketcher } from "./sketcher.js";
import { PSIServer, PSIClient } from "./psi.js";
import { lpStream } from "@libp2p/utils";
import type { Stream } from "@libp2p/interface";

const PROTOCOL_ID = "/shimmer/psi/1.0.0";

export interface ProximityPeer {
  peerId: string;
  modality: string;
  similarity: number;  // 0-100 percentage
  timestamp: number;
}

export interface PSIProtocolOptions {
  similarityThreshold?: number;  // Minimum similarity % to consider peer as "in proximity" (default: 50)
}

/**
 * PSIProtocol - Custom libp2p protocol for Private Set Intersection handshakes
 *
 * Implements /shimmer/psi/1.0.0 protocol for computing similarity between peers
 * using their MinHash signatures without revealing the actual items.
 */
export class PSIProtocol {
  private node: Libp2p;
  private sketcher: Sketcher;
  private options: Required<PSIProtocolOptions>;
  private proximityPeers = new Map<string, ProximityPeer[]>();

  constructor(
    node: Libp2p,
    sketcher: Sketcher,
    options: PSIProtocolOptions = {}
  ) {
    this.node = node;
    this.sketcher = sketcher;
    this.options = {
      similarityThreshold: options.similarityThreshold ?? 50,
    };

    // Register protocol handler
    this.registerProtocolHandler();
  }

  private registerProtocolHandler(): void {
    (this.node as any).handle(PROTOCOL_ID, (stream: Stream) => {
      Promise.resolve().then(async () => {
        // lpStream lets us read/write in a predetermined order
        const lp = lpStream(stream);

        // Read the incoming request
        const requestData = await lp.read();
        const request = JSON.parse(new TextDecoder().decode(requestData.subarray()));

        console.log(`[PSIProtocol] Received PSI request for modality: ${request.modality}`);

        // Get our sketch for this modality
        // TODO: Consider doing PSI on the original inputs instead of the signature
        const signature = this.sketcher.getSignature(request.modality);
        if (!signature) {
          throw new Error(`No sketch data for modality: ${request.modality}`);
        }

        // Convert our signature to items for PSI
        const ourItems = signature.map((sig) =>
          sig.toString(16).padStart(16, "0")
        );

        // Create PSI server and process request
        const server = new PSIServer();
        const clientRequest = Uint8Array.from(request.clientRequest);
        const setupMessage = server.createSetup(ourItems, ourItems.length);
        const serverResponse = server.processRequest(clientRequest);

        // Write the response
        await lp.write(new TextEncoder().encode(JSON.stringify({
          setupMessage: Array.from(setupMessage),
          serverResponse: Array.from(serverResponse),
        })));

        console.log(`[PSIProtocol] Sent PSI response for modality: ${request.modality}`);
      }).catch(err => {
        console.error("[PSIProtocol] Error handling incoming PSI:", err);
        stream.abort(err);
      });
    });
  }

  /**
   * Initiate PSI handshake with a peer (we act as client)
   */
  public async initiatePSI(
    peerId: string,
    modality: string
  ): Promise<ProximityPeer | null> {
    try {
      const signature = this.sketcher.getSignature(modality as any);
      if (!signature) {
        throw new Error(`No sketch data for modality: ${modality}`);
      }

      // Convert our signature to items for PSI
      const ourItems = signature.map((sig) =>
        sig.toString(16).padStart(16, "0")
      );

      // Create PSI client and request
      const client = new PSIClient();
      const clientRequest = client.createRequest(ourItems);

      // Find peer in connected peers
      const peers = this.node.getPeers();
      const targetPeer = peers.find(p => p.toString() === peerId);
      if (!targetPeer) {
        throw new Error(`Peer ${peerId} not connected`);
      }

      // Dial the protocol
      const stream = await (this.node as any).dialProtocol(targetPeer, PROTOCOL_ID);

      // lpStream lets us read/write in a predetermined order
      const lp = lpStream(stream);

      // Send the request
      await lp.write(new TextEncoder().encode(JSON.stringify({
        modality,
        clientRequest: Array.from(clientRequest),
      })));

      // Read the response
      const responseData = await lp.read();
      const response = JSON.parse(new TextDecoder().decode(responseData.subarray()));

      const setupMessage = Uint8Array.from(response.setupMessage);
      const serverResponse = Uint8Array.from(response.serverResponse);

      // Compute intersection size
      const intersectionSize = client.getIntersectionSize(setupMessage, serverResponse);
      const similarity = (intersectionSize / ourItems.length) * 100;

      console.log(
        `[PSIProtocol] PSI with ${peerId} for ${modality}: ${similarity.toFixed(1)}% similarity`
      );

      // If above threshold, record as proximity peer
      if (similarity >= this.options.similarityThreshold) {
        const proximityPeer: ProximityPeer = {
          peerId,
          modality,
          similarity,
          timestamp: Date.now(),
        };

        // Store proximity peer
        if (!this.proximityPeers.has(peerId)) {
          this.proximityPeers.set(peerId, []);
        }
        this.proximityPeers.get(peerId)!.push(proximityPeer);

        return proximityPeer;
      }

      return null;
    } catch (err) {
      console.error(`[PSIProtocol] Failed to initiate PSI with ${peerId}:`, err);
      return null;
    }
  }

  /**
   * Get all proximity peers
   */
  public getProximityPeers(): Map<string, ProximityPeer[]> {
    return new Map(this.proximityPeers);
  }

  /**
   * Get proximity peers for a specific peer ID
   */
  public getProximityPeersByPeerId(peerId: string): ProximityPeer[] | undefined {
    return this.proximityPeers.get(peerId);
  }

  /**
   * Check if a peer is considered in proximity (above threshold for any modality)
   */
  public isProximityPeer(peerId: string): boolean {
    const peers = this.proximityPeers.get(peerId);
    if (!peers) return false;
    return peers.some(p => p.similarity >= this.options.similarityThreshold);
  }
}
