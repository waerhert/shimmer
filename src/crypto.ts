// TODO: consider a length-prefixed concatenation method, instead of joining things with "|"

/**
 * Hash the concatenated arguments using SHA-256 and returns a bigint of 64bit
 *
 * Bigint is returned because that makes it easy to compare when doing minHash
 *
 * @param args List of things to hash
 * @returns bigint
 */
export async function sha256biguint64(...args: string[]): Promise<bigint> {
  const concatenated = args.join("|");
  const encoder = new TextEncoder();
  const data = encoder.encode(concatenated);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const view = new DataView(digest, 0);
  const bigint = view.getBigUint64(0, false);

  return bigint;
}

/**
 * minHash
 * @param items List of items to calculate minhash on
 * @param k     Number of hash functions to use
 * @param salt  Salt to include in each item
 */
export async function minHash(
  items: string[],
  k: number,
  salt: string
): Promise<bigint[]> {
  const signature: bigint[] = new Array(k).fill(0xffff_fffff_ffff_ffffn);
  for (const item of items) {
    for (let i = 0; i < k; i++) {
      const h = await sha256biguint64(item, salt, i.toString());
      signature[i] = h < signature[i]! ? h : signature[i]!; // min()
    }
  }

  return signature;
}

/**
 *
 * @param args strings
 * @returns base64url-encoded string of the sha256 digest of the strings
 */
export async function sha256base64url(...args: string[]): Promise<string> {
  const concatenated = args.join("|");
  const encoder = new TextEncoder();
  const data = encoder.encode(concatenated);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const uint8digest = new Uint8Array(digest);
  const base64 = btoa(String.fromCharCode(...uint8digest));
  const base64url = base64
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return base64url;
}

export interface Tags {
  publicTags: string[];
  preImages: string[];
}
/**
 * Generate LSH (Locality-Sensitive Hashing) tags from a MinHash signature.
 *
 * Divides the signature into bands and hashes each band to create collision buckets.
 * Similar signatures are likely to produce at least one matching tag.
 *
 * @param signature - MinHash signature (array of k bigints)
 * @param bands - Number of bands to divide signature into
 * @param salt - Epoch nonce for privacy (rotates to invalidate old tags)
 * @returns Array of base64url-encoded tags, one per band
 * @throws Error if signature.length is not divisible by bands
 */
export async function lshTags(
  signature: bigint[],
  bands: number,
  salt: string
): Promise<Tags> {
  const tags: Tags = {
    publicTags: [],
    preImages: [],
  };
  const rows = signature.length / bands;

  if (!Number.isInteger(rows)) {
    throw new Error(
      `signature.length (${signature.length}) must be divisible by bands (${bands})`
    );
  }

  for (let i = 0; i < bands; i++) {
    const slice = signature
      .slice(i * rows, (i + 1) * rows)
      .map((b) => b.toString());
    const preImage = await sha256base64url(salt, i.toString(), ...slice);
    tags.preImages.push(preImage);
    // We double hash here, in case we want to encrypt our peerinfo at the rendezvous server.
    // The preImage would serve as the seed for a HKDF() to determine the encryption key
    // Only peers who share the tag can decrypt this information
    // TODO: We probably want to hash only on UInt8Array under the hood, and keep base64 encoding only
    // when doing presentation/crossing api boundaries
    // for now let's keep it simple
    const publicTag = await sha256base64url(preImage);
    tags.publicTags.push(publicTag);
  }

  return tags;
}
