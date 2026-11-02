import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { getDb } from "./db";
import {
  listMachines,
  listFloors,
  invalidateBoardCache,
  removeRoom,
  addRoom,
  renameRoom,
  reportCacheSet,
  reportCacheGet,
} from "./machines";

describe("room deletion against Postgres", () => {
  const pg = new PGlite();

  beforeAll(async () => {
    await pg.exec(
      readFileSync(
        new URL("../drizzle/0000_baseline.sql", import.meta.url),
        "utf8"
      )
    );
    await pg.exec(
      readFileSync(
        new URL("../drizzle/manual/0004_machine_repairs.sql", import.meta.url),
        "utf8"
      )
    );
  }, 30_000);

  beforeEach(async () => {
    await pg.exec(
      "TRUNCATE machine_repairs, sessions, machines, floors RESTART IDENTITY CASCADE"
    );
    await pg.exec(`INSERT INTO floors (code, name, "sortOrder") VALUES
      ('F1', 'Room 1', 1), ('F2', 'Room 2', 2)`);
    vi.mocked(getDb).mockResolvedValue(
      drizzle(pg) as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>
    );
    invalidateBoardCache();
  });

  afterAll(async () => {
    await pg.close();
  });

  async function addMachine(
    id: number,
    status: "active" | "backup" | "repair",
    floorId = 1
  ) {
    await pg.query(
      `INSERT INTO machines (id, label, location, status, "floorId")
      VALUES ($1, $2, 'Bay A', $3, $4)`,
      [id, `HD-${id}`, status, floorId]
    );
  }

  async function addSession(status: "active" | "ended") {
    await pg.query(
      `INSERT INTO sessions ("machineId", "patientId", "durationMinutes", "startedAt", "endsAt", status)
      VALUES (1, 'TEST-PATIENT', 240, now(), now() + interval '4 hours', $1)`,
      [status]
    );
  }

  async function remainingRooms() {
    return (await pg.query("SELECT id FROM floors ORDER BY id")).rows;
  }

  it("removes an empty room", async () => {
    reportCacheSet(
      "eodBulk",
      { date: "2026-11-02" },
      { floors: [{ id: 1, name: "Room 1" }] }
    );
    reportCacheSet("eom", { month: "2026-11", floorId: "" }, [
      { floorName: "Room 1" },
    ]);
    await removeRoom({ roomId: 1 });
    expect(await remainingRooms()).toEqual([{ id: 2 }]);
    expect((await listFloors()).map(room => room.id)).toEqual([2]);
    expect(reportCacheGet("eodBulk", { date: "2026-11-02" })).toBeNull();
    expect(reportCacheGet("eom", { month: "2026-11", floorId: "" })).toBeNull();
  });

  it("also refreshes cached room names and report lists on rename and add", async () => {
    reportCacheSet(
      "eodBulk",
      { date: "2026-11-02" },
      { floors: [{ id: 1, name: "Room 1" }] }
    );
    await renameRoom({ roomId: 1, name: "New name" });
    expect(reportCacheGet("eodBulk", { date: "2026-11-02" })).toBeNull();
    reportCacheSet("eodBulk", { date: "2026-11-02" }, { floors: [] });
    await addRoom({ name: "Room 3" });
    expect(reportCacheGet("eodBulk", { date: "2026-11-02" })).toBeNull();
  });

  it("removes a room that appears empty on the board, preserving offboard machines and sessions", async () => {
    await addMachine(1, "backup");
    await addMachine(2, "repair");
    await addMachine(3, "active", 2);
    await addSession("ended");
    await pg.exec(`INSERT INTO machine_repairs ("machineId", "reportedBy", issue)
      VALUES (2, 'Test technician', 'Test maintenance record')`);
    // Reproduces the bug: no visible machine on Room 1, despite retained floorIds.
    expect(
      (await listMachines()).filter(row => row.machine.floorId === 1)
    ).toEqual([]);

    await removeRoom({ roomId: 1 });

    expect(await remainingRooms()).toEqual([{ id: 2 }]);
    expect(
      (await pg.query('SELECT id, status, "floorId" FROM machines ORDER BY id'))
        .rows
    ).toEqual([
      { id: 1, status: "backup", floorId: null },
      { id: 2, status: "repair", floorId: null },
      { id: 3, status: "active", floorId: 2 },
    ]);
    expect(
      (await pg.query('SELECT "machineId", status FROM sessions')).rows
    ).toEqual([{ machineId: 1, status: "ended" }]);
    expect(
      (await pg.query('SELECT "machineId", issue FROM machine_repairs')).rows
    ).toEqual([{ machineId: 2, issue: "Test maintenance record" }]);
  });

  it("still blocks a room with an idle machine on its board", async () => {
    await addMachine(1, "active");
    await addMachine(2, "repair");
    await expect(removeRoom({ roomId: 1 })).rejects.toThrow(
      "ROOM_HAS_MACHINES"
    );
    expect(await remainingRooms()).toHaveLength(2);
    expect((await pg.query('SELECT "floorId" FROM machines')).rows).toEqual([
      { floorId: 1 },
      { floorId: 1 },
    ]);
  });

  it.each(["active", "backup", "repair"] as const)(
    "blocks active treatment even on a %s machine",
    async status => {
      await addMachine(1, status);
      await addSession("active");
      await expect(removeRoom({ roomId: 1 })).rejects.toThrow(
        "ROOM_HAS_ACTIVE_SESSIONS"
      );
      expect(await remainingRooms()).toHaveLength(2);
    }
  );

  it("rolls back detached machines if deleting the room fails", async () => {
    await addMachine(1, "backup");
    await pg.exec(`CREATE FUNCTION reject_room_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test deletion failure'; END $$;
      CREATE TRIGGER reject_room_delete BEFORE DELETE ON floors
      FOR EACH ROW EXECUTE FUNCTION reject_room_delete();`);
    try {
      await expect(removeRoom({ roomId: 1 })).rejects.toMatchObject({
        cause: expect.objectContaining({ message: "test deletion failure" }),
      });
      expect(await remainingRooms()).toHaveLength(2);
      expect((await pg.query('SELECT "floorId" FROM machines')).rows).toEqual([
        { floorId: 1 },
      ]);
    } finally {
      await pg.exec(
        "DROP TRIGGER reject_room_delete ON floors; DROP FUNCTION reject_room_delete()"
      );
    }
  });
});
