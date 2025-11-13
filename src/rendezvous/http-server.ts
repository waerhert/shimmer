import { Hono } from "hono";
import type { RawRendezVous, RawPeerDiscoveryResult } from "./interface.js";
import { serve } from "@hono/node-server";

/**
 * HTTPRendezVousServer - HTTP server implementing RawRendezVous
 *
 * Provides a simple HTTP API for storing and retrieving opaque data by tags.
 * Does not perform encryption - clients are responsible for encrypting data.
 */
export class HTTPRendezVousServer implements RawRendezVous {
  hono: Hono;
  // tag → data → expiresAt
  private registry: Map<string, Map<string, number>> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.hono = new Hono();
    this.registerHandlers();
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 30000);
  }

  public listen(port: number = 8771) {
    serve({
      fetch: this.hono.fetch,
      port: port,
    });
  }

  private registerHandlers() {
    // POST /announce - Announce data under tags
    this.hono.post("/announce", async (c) => {
      try {
        const body = await c.req.json();
        const { tags, data, expiresAt } = body;

        if (
          !Array.isArray(tags) ||
          !data ||
          typeof data !== "string" ||
          typeof expiresAt !== "number"
        ) {
          return c.json(
            {
              error:
                "Invalid request: tags (array), data (string), and expiresAt (number) required",
            },
            400
          );
        }

        if (tags.length === 0) {
          return c.json({ error: "At least one tag is required" }, 400);
        }

        if (expiresAt <= Date.now()) {
          return c.json({ error: "expiresAt must be in the future" }, 400);
        }

        await this.announce(tags, data, expiresAt);
        return c.json({ success: true }, 200);
      } catch (err) {
        return c.json({ error: "Internal server error" }, 500);
      }
    });

    // POST /discover - Discover data by tags (using POST for JSON body)
    this.hono.post("/discover", async (c) => {
      try {
        const body = await c.req.json();
        const { tags } = body;

        if (!Array.isArray(tags)) {
          return c.json(
            { error: "Invalid request: tags (array) required" },
            400
          );
        }

        if (tags.length === 0) {
          return c.json({ error: "At least one tag is required" }, 400);
        }

        const results = await this.discover(tags);
        return c.json({ results }, 200);
      } catch (err) {
        return c.json({ error: "Internal server error" }, 500);
      }
    });
  }

  public async announce(
    tags: string[],
    data: string,
    expiresAt: number
  ): Promise<void> {
    for (const tag of tags) {
      let record = this.registry.get(tag);
      if (!record) {
        record = new Map();
        this.registry.set(tag, record);
      }
      record.set(data, expiresAt);
    }
  }

  public async discover(tags: string[]): Promise<RawPeerDiscoveryResult[]> {
    const found = new Map<string, string>(); // data → tag (for deduplication)
    const now = Date.now();

    for (const tag of tags) {
      const record = this.registry.get(tag);
      if (record) {
        for (const [data, expiresAt] of record) {
          if (expiresAt > now) {
            // Store tag for each data, deduplicating by data key
            if (!found.has(data)) {
              found.set(data, tag);
            }
          }
        }
      }
    }

    return Array.from(found.entries()).map(([data, publicTag]) => ({ publicTag, data }));
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [tag, record] of this.registry) {
      for (const [data, expiresAt] of record) {
        if (expiresAt <= now) {
          record.delete(data);
        }
      }
      if (record.size === 0) {
        this.registry.delete(tag);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}
