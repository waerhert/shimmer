import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";

export async function tagToCID(tag: string): Promise<CID> {
  const tagBytes = new TextEncoder().encode(tag);
  const tagHash = await sha256.digest(tagBytes);
  return CID.create(1, raw.code, tagHash);
}
