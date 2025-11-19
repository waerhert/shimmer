import { setMaxListeners, TimeoutError } from '@libp2p/interface'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { Uint8ArrayList } from 'uint8arraylist'
import { TypedEventEmitter } from 'main-event'
import type { Name as NameInterface, NameComponents, NameInit } from './index.js'
import type { PeerId, PeerInfo, Startable, Stream, Connection } from '@libp2p/interface'
import type { OpenConnectionOptions } from '@libp2p/interface-internal'
import type { Multiaddr } from '@multiformats/multiaddr'

interface NameEventMap {
  'name:discovered': CustomEvent<{ peerInfo: PeerInfo; name: string }>;
}

export class Name extends TypedEventEmitter<NameEventMap> implements Startable, NameInterface {
  public readonly protocol: string
  private readonly components: NameComponents
  private started: boolean
  private readonly init: NameInit
  private readonly timeout: number
  private readonly localName: string

  constructor (components: NameComponents, init: NameInit = {}) {
    super()
    this.started = false
    this.components = components
    this.protocol = '/shimmer/name/1.0.0'
    this.init = init
    this.timeout = init.timeout ?? 5000
    this.localName = init.name ?? 'anonymous'
  }

  readonly [Symbol.toStringTag] = '@shimmer/name'

  async start (): Promise<void> {
    await this.components.registrar.handle(this.protocol, this.onName.bind(this), {
      maxInboundStreams: this.init.maxInboundStreams ?? 1,
      maxOutboundStreams: this.init.maxOutboundStreams ?? 1
    })
    this.started = true
  }

  async stop (): Promise<void> {
    await this.components.registrar.unhandle(this.protocol)
    this.started = false
  }

  isStarted (): boolean {
    return this.started
  }

  async onName (stream: Stream, connection: Connection): Promise<void> {
    const log = stream.log.newScope('name')
    const signal = AbortSignal.timeout(this.timeout)
    setMaxListeners(Infinity, signal)

    signal.addEventListener('abort', () => {
      stream.abort(new TimeoutError())
    })

    // Read the remote peer's name
    const chunks = new Uint8ArrayList()
    for await (const buf of stream) {
      chunks.append(buf)
    }

    const remoteName = uint8ArrayToString(chunks.subarray())
    log('received name from peer: %s', remoteName)

    // Store name in peerStore as metadata
    if ('peerStore' in this.components) {
      await (this.components as any).peerStore.merge(connection.remotePeer, {
        metadata: {
          'shimmer/name': uint8ArrayFromString(remoteName)
        }
      })
    }

    // Emit event for reactive updates with full PeerInfo
    const peerInfo: PeerInfo = {
      id: connection.remotePeer,
      multiaddrs: [connection.remoteAddr]
    }
    this.dispatchEvent(
      new CustomEvent('name:discovered', {
        detail: { peerInfo, name: remoteName }
      })
    )

    // Send our name back
    const nameBytes = uint8ArrayFromString(this.localName)
    stream.send(nameBytes)

    await stream.close({ signal })
  }

  async name (peer: PeerId | Multiaddr | Multiaddr[], options?: OpenConnectionOptions): Promise<string> {
    // Open connection first, then create stream from it
    const connection = await this.components.connectionManager.openConnection(peer, {
      ...this.init,
      ...options
    })

    const stream = await connection.newStream(this.protocol, {
      ...this.init,
      ...options
    })

    const log = stream.log.newScope('name')
    const received = new Uint8ArrayList()
    const output = Promise.withResolvers<string>()

    stream.addEventListener('message', (evt: any) => {
      received.append(evt.data)
      log('received %d bytes', received.byteLength)
    })

    stream.addEventListener('close', async (evt: any) => {
      if (evt.error != null) {
        output.reject(evt.error)
        return
      }

      const remoteName = uint8ArrayToString(received.subarray())
      log('name exchange complete: %s', remoteName)

      // Store name in peerStore as metadata
      if ('peerStore' in this.components) {
        await (this.components as any).peerStore.merge(connection.remotePeer, {
          metadata: {
            'shimmer/name': uint8ArrayFromString(remoteName)
          }
        }).catch((err: Error) => {
          log('failed to store name in peerStore: %s', err.message)
        })
      }

      // Emit event for reactive updates with full PeerInfo
      const peerInfo: PeerInfo = {
        id: connection.remotePeer,
        multiaddrs: [connection.remoteAddr]
      }
      this.dispatchEvent(
        new CustomEvent('name:discovered', {
          detail: { peerInfo, name: remoteName }
        })
      )

      output.resolve(remoteName)
    })

    // Send our name
    const nameBytes = uint8ArrayFromString(this.localName)
    log('sending name: %s', this.localName)
    stream.send(nameBytes)

    await stream.close(options)

    return output.promise
  }
}
