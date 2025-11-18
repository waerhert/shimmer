/**
 * @packageDocumentation
 *
 * Use the `name` function to add support for exchanging human-readable names between peers.
 *
 * This simple protocol allows network peers to share their names with each other.
 *
 * @example Enabling name protocol
 *
 * ```typescript
 * import { createLibp2p } from 'libp2p'
 * import { name } from './protocols/name'
 *
 * const node = await createLibp2p({
 *   // ...other options
 *   services: {
 *     name: name({ name: 'Alice' })
 *   }
 * })
 * ```
 */

import { Name as NameClass } from './name.js'
import type { ComponentLogger, Libp2pEvents, PeerId } from '@libp2p/interface'
import type { ConnectionManager, OpenConnectionOptions, Registrar } from '@libp2p/interface-internal'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { TypedEventTarget } from 'main-event'

export interface NameInit {
  /**
   * The human-readable name for this peer
   *
   * @default 'anonymous'
   */
  name?: string

  /**
   * The prefix to use for the protocol
   *
   * @default 'shimmer'
   */
  protocolPrefix?: string

  /**
   * How long we should wait for a remote peer to send their name
   *
   * @default 5000
   */
  timeout?: number

  /**
   * The maximum number of inbound streams that may be open on a single
   * connection for this protocol
   *
   * @default 1
   */
  maxInboundStreams?: number

  /**
   * The maximum number of outbound streams that may be open on a single
   * connection for this protocol
   *
   * @default 1
   */
  maxOutboundStreams?: number
}

export interface NameComponents {
  peerId: PeerId
  registrar: Registrar
  connectionManager: ConnectionManager
  events: TypedEventTarget<Libp2pEvents>
  logger: ComponentLogger
}

export interface Name {
  protocol: string
  name(peer: PeerId | Multiaddr | Multiaddr[], options?: OpenConnectionOptions): Promise<string>
}

export function name (init: NameInit = {}): (components: NameComponents) => Name {
  return (components) => new NameClass(components, init)
}
