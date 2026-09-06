import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The nurses table lives in a separate Supabase project (skti-nursetrack),
 * so this pool is its own postgres() client, not the app's drizzle pool.
 * Each test resets modules so the in-memory roster cache and cached client
 * from one test never leak into the next.
 */
const FAKE_ROWS = [
  { id: 2, employeeId: "RN-002", firstName: "Bea", lastName: "Alvarez", position: "Staff Nurse II", area: "RDU Annex" },
  { id: 1, employeeId: "RN-001", firstName: "Al", lastName: "Cruz", position: "Staff Nurse II", area: "RDU Main" },
];

const sqlMock = vi.fn(async () => FAKE_ROWS);
const postgresFactory = vi.fn(() => sqlMock);

vi.mock("postgres", () => ({
  default: postgresFactory,
}));

beforeEach(() => {
  vi.resetModules();
  sqlMock.mockClear();
  sqlMock.mockResolvedValue(FAKE_ROWS);
  postgresFactory.mockClear();
  postgresFactory.mockImplementation(() => sqlMock);
  process.env.NURSETRACK_DATABASE_URL = "postgresql://user:pass@localhost:5432/nursetrack";
});

afterEach(() => {
  delete process.env.NURSETRACK_DATABASE_URL;
});

describe("listActiveNurses", () => {
  it("maps rows to display names ordered by last name", async () => {
    const { listActiveNurses } = await import("./nurse-roster");
    const nurses = await listActiveNurses();
    expect(nurses).toEqual([
      { id: 2, employeeId: "RN-002", name: "Alvarez, Bea", position: "Staff Nurse II", area: "RDU Annex" },
      { id: 1, employeeId: "RN-001", name: "Cruz, Al", position: "Staff Nurse II", area: "RDU Main" },
    ]);
  });

  it("caches the roster instead of querying on every call", async () => {
    const { listActiveNurses } = await import("./nurse-roster");
    await listActiveNurses();
    await listActiveNurses();
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty roster without throwing when NURSETRACK_DATABASE_URL is unset", async () => {
    delete process.env.NURSETRACK_DATABASE_URL;
    const { listActiveNurses } = await import("./nurse-roster");
    await expect(listActiveNurses()).resolves.toEqual([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns an empty roster instead of throwing when the query fails", async () => {
    sqlMock.mockRejectedValueOnce(new Error("connection terminated"));
    const { listActiveNurses } = await import("./nurse-roster");
    await expect(listActiveNurses()).resolves.toEqual([]);
  });

  it("strips wrapping quotes a pasted connection string picks up", async () => {
    process.env.NURSETRACK_DATABASE_URL = '"postgresql://user:pass@localhost:5432/nursetrack"';
    const { listActiveNurses } = await import("./nurse-roster");
    await listActiveNurses();
    expect(postgresFactory).toHaveBeenCalledWith(
      "postgresql://user:pass@localhost:5432/nursetrack",
      expect.anything(),
    );
  });

  it("returns an empty roster instead of throwing when the connection string is invalid", async () => {
    postgresFactory.mockImplementationOnce(() => {
      throw new TypeError("Invalid URL");
    });
    const { listActiveNurses } = await import("./nurse-roster");
    await expect(listActiveNurses()).resolves.toEqual([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
