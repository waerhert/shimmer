/**
 * Bootstrap Relay Server for Shimmer P2P Demo
 *
 * This server provides:
 * - Circuit relay v2 for browser NAT traversal
 * - WebSocket transport for browser connectivity
 * - Fixed peer identity for consistent bootstrap address
 */

import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';

const WS_PORT = 9002;

async function seedFromPhrase(str: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(str + '219847923874932khewiurwe')
    )
  );
}

async function main() {
  // Generate deterministic key from seed phrase
  const privateKey = await generateKeyPairFromSeed('Ed25519', await seedFromPhrase('shimmer-relay-bootstrap-server-1'));

  const node = await createLibp2p({
    privateKey,
    addresses: {
     listen: ['/ip4/0.0.0.0/tcp/9002/ws']
    },
    transports: [
      webSockets()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping(),
      relay: circuitRelayServer({

        reservations: {

          maxReservations: Infinity,
          // Make limits very high for development
          // Circuit relay v2 connections are ALWAYS limited by design
          // These settings make the limits effectively unlimited for testing
          defaultDurationLimit: 24 * 60 * 60 * 1000, // 24 hours in ms
          defaultDataLimit: BigInt(1024 * 1024 * 1024 * 100) // 100 GB
        },
        // Max concurrent relay streams
        maxInboundHopStreams: 1000,
        maxOutboundHopStreams: 1000,
        maxOutboundStopStreams: 1000
      })
    }
  });

  await node.start();

  console.log('\n🚀 Bootstrap Relay Server Started');
  console.log('═'.repeat(60));
  console.log(`Peer ID: ${node.peerId.toString()}`);
  console.log('\nListening on:');
  node.getMultiaddrs().forEach(ma => {
    console.log(`  ${ma.toString()}`);
  });
  console.log('═'.repeat(60));
  console.log('\n📋 Browser nodes should bootstrap to:');
  console.log(`  /ip4/127.0.0.1/tcp/${WS_PORT}/ws/p2p/${node.peerId.toString()}`);
  console.log('\n💡 Press Ctrl+C to stop\n');

  // Listen for peer connections
  node.addEventListener('peer:connect', (event) => {
    const peerId = event.detail;
    console.log(`[${new Date().toISOString()}] 🔗 Peer connected: ${peerId.toString()}`);
  });

  node.addEventListener('peer:disconnect', (event) => {
    const peerId = event.detail;
    console.log(`[${new Date().toISOString()}] 🔌 Peer disconnected: ${peerId.toString()}`);
  });

  node.addEventListener('connection:open', (event) => {
    const connection = event.detail;
    console.log(`[${new Date().toISOString()}] 📡 Connection opened from ${connection.remotePeer.toString()}`);
    console.log(`   Remote address: ${connection.remoteAddr.toString()}`);
  });

  node.addEventListener('connection:close', (event) => {
    const connection = event.detail;
    console.log(`[${new Date().toISOString()}] 📴 Connection closed from ${connection.remotePeer.toString()}`);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    await node.stop();
    console.log('✅ Stopped gracefully');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Failed to start bootstrap server:', err);
  process.exit(1);
});
