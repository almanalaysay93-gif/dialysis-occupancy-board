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
    await pg.exec(
      readFileSync(
        new URL("../drizzle/manual/0005_waiting_called.sql", import.meta.url),
        "utf8"
      )
    );
    await pg.exec(
      readFileSync(
        new URL(
          "../drizzle/manual/0006_archive_removed_rooms.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    // Match the restrictive foreign key present in production, not just the
    // unconstrained baseline that missed the user's server error.
    await pg.exec(
      'ALTER TABLE waiting_list ADD CONSTRAINT waiting_list_floorId_fkey FOREIGN KEY ("floorId") REFERENCES floors(id)'
    );
  }, 30_000);

  beforeEach(async () => {
    await pg.exec(
      "TRUNCATE waiting_list, machine_repairs, sessions, machines, floors RESTART IDENTITY CASCADE"
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
    return (
      await pg.query(
        'SELECT id FROM floors WHERE "archivedAt" IS NULL ORDER BY id'
      )
    ).rows;
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
    expect(
      (
        await pg.query(
          'SELECT "archivedAt" IS NOT NULL AS archived FROM floors WHERE id = 1'
        )
      ).rows
    ).toEqual([{ archived: true }]);
    expect(reportCacheGet("eodBulk", { date: "2026-11-02" })).toBeNull();
    expect(reportCacheGet("eom", { month: "2026-11", floorId: "" })).toBeNull();
  });

  it("requires a destination for waiting patients and preserves the production foreign-key history", async () => {
    await addMachine(1, "active");
    await pg.exec(`INSERT INTO waiting_list ("patientId", "floorId", status, priority, "joinedAt", "calledAt", "calledBy")
      VALUES ('TEST-WAITING', 1, 'waiting', 'urgent', '2026-11-03T01:00:00Z', now(), 'Test nurse'),
             ('TEST-ADMITTED', 1, 'admitted', 'normal', '2026-11-02T01:00:00Z', null, null)`);
    await expect(removeRoom({ roomId: 1 })).rejects.toThrow(
      "ROOM_HAS_WAITING_PATIENTS"
    );
    expect(await remainingRooms()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(
      (await pg.query('SELECT status, "floorId" FROM machines')).rows
    ).toEqual([{ status: "active", floorId: 1 }]);

    await removeRoom({ roomId: 1, replacementRoomId: 2 });

    expect(await remainingRooms()).toEqual([{ id: 2 }]);
    expect(
      (
        await pg.query(
          'SELECT "patientId", "floorId", status, priority, "calledAt", "calledBy" FROM waiting_list ORDER BY id'
        )
      ).rows
    ).toEqual([
      {
        patientId: "TEST-WAITING",
        floorId: 2,
        status: "waiting",
        priority: "urgent",
        calledAt: null,
        calledBy: null,
      },
      {
        patientId: "TEST-ADMITTED",
        floorId: 1,
        status: "admitted",
        priority: "normal",
        calledAt: null,
        calledBy: null,
      },
    ]);
    expect(
      (await pg.query('SELECT "joinedAt" FROM waiting_list WHERE id = 1'))
        .rows[0].joinedAt
    ).toEqual(new Date("2026-11-03T01:00:00Z"));
  });

  it("archives a room with admitted entries without deleting or reassigning historical queue records", async () => {
    await pg.exec(
      `INSERT INTO waiting_list ("patientId", "floorId", status) VALUES ('TEST-ADMITTED', 1, 'admitted')`
    );
    await removeRoom({ roomId: 1 });
    expect(await remainingRooms()).toEqual([{ id: 2 }]);
    expect(
      (await pg.query('SELECT "floorId", status FROM waiting_list')).rows
    ).toEqual([{ floorId: 1, status: "admitted" }]);
  });

  it.each([1, 999, 2])(
    "rejects a same, nonexistent, or archived destination (%s)",
    async replacementRoomId => {
      await pg.exec(
        `INSERT INTO waiting_list ("patientId", "floorId") VALUES ('TEST-WAITING', 1)`
      );
      if (replacementRoomId === 2)
        await pg.exec('UPDATE floors SET "archivedAt" = now() WHERE id = 2');
      await expect(
        removeRoom({ roomId: 1, replacementRoomId })
      ).rejects.toThrow("INVALID_REPLACEMENT_ROOM");
      expect(
        (await pg.query('SELECT "floorId" FROM waiting_list')).rows
      ).toEqual([{ floorId: 1 }]);
    }
  );

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

  it("moves idle board machines to Backup while preserving repair status and history", async () => {
    await addMachine(1, "active");
    await addMachine(2, "repair");
    await addSession("ended");
    await removeRoom({ roomId: 1 });
    expect(await remainingRooms()).toEqual([{ id: 2 }]);
    expect(
      (await pg.query('SELECT id, status, "floorId" FROM machines ORDER BY id'))
        .rows
    ).toEqual([
      { id: 1, status: "backup", floorId: null },
      { id: 2, status: "repair", floorId: null },
    ]);
    expect(
      (await pg.query('SELECT "machineId", status FROM sessions')).rows
    ).toEqual([{ machineId: 1, status: "ended" }]);
  });

  it("removes the screenshot's 98-machine room without deleting machines", async () => {
    await pg.exec(`INSERT INTO machines (label, location, "floorId", status)
      SELECT 'HD-' || n, 'Bay A', 1, 'active' FROM generate_series(1, 98) n`);
    await removeRoom({ roomId: 1 });
    expect(await remainingRooms()).toEqual([{ id: 2 }]);
    expect(
      (
        await pg.query(`SELECT count(*)::int AS total FROM machines
      WHERE status = 'backup' AND "floorId" IS NULL`)
      ).rows
    ).toEqual([{ total: 98 }]);
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
    await addMachine(1, "active");
    await pg.exec(`CREATE FUNCTION reject_room_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test deletion failure'; END $$;
      CREATE TRIGGER reject_room_delete BEFORE UPDATE ON floors
      FOR EACH ROW EXECUTE FUNCTION reject_room_delete();`);
    try {
      await expect(removeRoom({ roomId: 1 })).rejects.toMatchObject({
        cause: expect.objectContaining({ message: "test deletion failure" }),
      });
      expect(await remainingRooms()).toHaveLength(2);
      expect(
        (await pg.query('SELECT status, "floorId" FROM machines')).rows
      ).toEqual([{ status: "active", floorId: 1 }]);
    } finally {
      await pg.exec(
        "DROP TRIGGER reject_room_delete ON floors; DROP FUNCTION reject_room_delete()"
      );
    }
  });
});
