import type { PeerInfo } from "@libp2p/interface";

async function deriveEncryptionKey(preImage: string): Promise<CryptoKey> {
  // Step 1: Import preImage as raw key material for HKDF
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(preImage),
    'HKDF',
    false,  // Not extractable
    ['deriveKey']
  );
  
  // Step 2: Derive AES-GCM key from the key material
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),  // Optional: add salt for more security
      info: new TextEncoder().encode('shimmer-rendezvous-encryption')  // Context string
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256  // 256-bit key
    },
    false,  // Not extractable
    ['encrypt', 'decrypt']
  );
  
  return aesKey;  // Returns CryptoKey ready for AES-GCM
}

export async function encryptPeerInfo(peerInfo: PeerInfo, preImage: string): Promise<Uint8Array> {
  const key = await deriveEncryptionKey(preImage);
  const iv = crypto.getRandomValues(new Uint8Array(12));  // 96-bit IV for GCM
  
  const plaintext = new TextEncoder().encode(JSON.stringify({
    id: peerInfo.id.toString(),
    multiaddrs: peerInfo.multiaddrs.map(ma => ma.toString())
  }));
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  
  // Prepend IV to ciphertext for decryption
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  
  return result;
}

export async function decryptPeerInfo(encrypted: Uint8Array, preImage: string): Promise<PeerInfo | null> {
  try {
    const key = await deriveEncryptionKey(preImage);
    const iv = encrypted.slice(0, 12);
    const ciphertext = encrypted.slice(12);
    
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    
    const json = new TextDecoder().decode(plaintext);
    return JSON.parse(json);
  } catch {
    return null;  // Decryption failed = wrong preImage
  }
}