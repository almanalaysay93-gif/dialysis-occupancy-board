import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * node-postgres emits "error" on the pool when an idle client dies, which the
 * Supabase pooler does routinely. An EventEmitter with no "error" listener
 * throws, which in a server process is an uncaughtException that takes the
 * whole site down. These tests hold that behaviour in place.
 */
class FakePool extends EventEmitter {
  static instances: FakePool[] = [];
  query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
  end = vi.fn().mockResolvedValue(undefined);

  constructor() {
    super();
    FakePool.instances.push(this);
  }
}

vi.mock("pg", () => ({
  default: { Pool: FakePool },
  Pool: FakePool,
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => ({ marker: "drizzle-handle" })),
}));

describe("database pool resilience", () => {
  beforeEach(() => {
    FakePool.instances = [];
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/board";
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("handles an idle client error instead of crashing the process", async () => {
    const { getDb } = await import("./db");
    await getDb();

    expect(FakePool.instances).toHaveLength(1);
    const pool = FakePool.instances[0];
    expect(pool.listenerCount("error")).toBeGreaterThan(0);

    // Without a listener this call throws and the process exits.
    expect(() => pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
  });

  it("drops the dead pool so the next call rebuilds a healthy one", async () => {
    const { getDb } = await import("./db");
    await getDb();

    const dead = FakePool.instances[0];
    dead.emit("error", new Error("Connection terminated unexpectedly"));
    // resetPool ends the dying pool asynchronously.
    await new Promise(resolve => setImmediate(resolve));
    expect(dead.end).toHaveBeenCalled();

    await getDb();
    expect(FakePool.instances).toHaveLength(2);
    expect(FakePool.instances[1]).not.toBe(dead);
  });

  it("reuses the cached handle while the pool is healthy", async () => {
    const { getDb } = await import("./db");
    const first = await getDb();
    const second = await getDb();

    expect(second).toBe(first);
    expect(FakePool.instances).toHaveLength(1);
  });
});
