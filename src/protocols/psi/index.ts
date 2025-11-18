/**
 * @packageDocumentation
 *
 * Use the `psi` function to add support for Private Set Intersection between peers.
 *
 * This protocol allows peers to compute similarity of their sketches without
 * revealing the actual items.
 *
 * @example Enabling PSI protocol
 *
 * ```typescript
 * import { createLibp2p } from 'libp2p'
 * import { psi } from './protocols/psi'
 *
 * const node = await createLibp2p({
 *   // ...other options
 *   services: {
 *     psi: psi({ similarityThreshold: 50 })
 *   }
 * })
 * ```
 */

import { PSIProtocol as PSIProtocolClass } from './psi.js'
import type { PeerStore } from '@libp2p/interface'
import type { Registrar, ConnectionManager } from '@libp2p/interface-internal'
import type { Sketcher } from '../../sketcher/sketcher.js'
import type { Sketch } from '../../sketcher/sketch.js'
import type { ProximityPeer } from '../../peers/peer.js'

export interface PSIProtocolInit {
  /**
   * Minimum similarity % to consider peer as "in proximity"
   *
   * @default 50
   */
  similarityThreshold?: number

  /**
   * Protocol prefix to use
   *
   * @default 'shimmer'
   */
  protocolPrefix?: string

  /**
   * Timeout for PSI operations in milliseconds
   *
   * @default 30000
   */
  timeout?: number
}

export interface PSIProtocolComponents {
  peerStore: PeerStore
  registrar: Registrar
  connectionManager: ConnectionManager
}

export interface PSIResult {
  similarity: number
  intersectionSize: number
  totalItems: number
  completedAt: number
}

export interface PSICompleteEvent {
  peer: ProximityPeer
  sketch: Sketch
  result: PSIResult
}

export interface PSIProtocol<T extends string = string> {
  protocol: string
  initiatePSI(peer: ProximityPeer, sketch: Sketch): Promise<PSIResult>
}

export function psi<T extends string = string>(
  sketcher: Sketcher<T>,
  init: PSIProtocolInit = {}
) {
  return (components: PSIProtocolComponents): PSIProtocol<T> => {
    return new PSIProtocolClass(components, sketcher, init)
  }
}
