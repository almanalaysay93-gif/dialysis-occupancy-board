import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn(() => null) }));

import {
  periodOverlapsShift,
  reportCacheGet,
  reportCacheSet,
  reportCacheInvalidate,
} from "./machines";

describe("periodOverlapsShift", () => {
  it("includes session1 (5-10) for shift 05-13", () => {
    expect(periodOverlapsShift("session1", "05-13")).toBe(true);
  });
  it("excludes session4 (18-22) for shift 05-13", () => {
    expect(periodOverlapsShift("session4", "05-13")).toBe(false);
  });
  it("includes transition3 (17-20) for shift 13-21 and excludes session1", () => {
    expect(periodOverlapsShift("transition3", "13-21")).toBe(true);
    expect(periodOverlapsShift("session1", "13-21")).toBe(false);
  });
  it("handles midnight-crossing shift 21-05: includes supShift3 (23-7) and session4, excludes session1", () => {
    expect(periodOverlapsShift("supShift3", "21-05")).toBe(true);
    expect(periodOverlapsShift("session4", "21-05")).toBe(true);
    expect(periodOverlapsShift("session1", "21-05")).toBe(false);
  });
  it("shift 07-15 includes session2 (10-14) and transition1 (9-11), excludes session4", () => {
    expect(periodOverlapsShift("session2", "07-15")).toBe(true);
    expect(periodOverlapsShift("transition1", "07-15")).toBe(true);
    expect(periodOverlapsShift("session4", "07-15")).toBe(false);
  });
  it("supShift1 (7-15) overlaps shift 07-15 and 13-21 but not 21-05", () => {
    expect(periodOverlapsShift("supShift1", "07-15")).toBe(true);
    expect(periodOverlapsShift("supShift1", "13-21")).toBe(true);
    expect(periodOverlapsShift("supShift1", "21-05")).toBe(false);
  });
  it("unknown period key returns false", () => {
    expect(periodOverlapsShift("bogus", "05-13")).toBe(false);
  });
});

describe("reportCache (30s TTL)", () => {
  beforeEach(() => reportCacheInvalidate("__any__"));

  it("returns the cached payload within the TTL", () => {
    reportCacheSet("eodBulk", { date: "2026-08-16" }, { daily: 1 });
    expect(reportCacheGet("eodBulk", { date: "2026-08-16" })).toEqual({ daily: 1 });
  });
  it("distinguishes different cache inputs", () => {
    reportCacheSet("eodBulk", { date: "2026-08-16" }, { daily: 1 });
    expect(reportCacheGet("eodBulk", { date: "2026-08-17" })).toBeNull();
  });
  it("expires after the TTL elapses", () => {
    vi.useFakeTimers();
    reportCacheSet("eodBulk", { date: "2026-08-16" }, { daily: 1 });
    vi.advanceTimersByTime(30_100);
    expect(reportCacheGet("eodBulk", { date: "2026-08-16" })).toBeNull();
    vi.useRealTimers();
  });
  it("invalidate drops every key containing the report date", () => {
    reportCacheSet("eodBulk", { date: "2026-08-16" }, { daily: 1 });
    reportCacheSet("eod", { date: "2026-08-16", floorId: "30001" }, { s: 2 });
    reportCacheSet("eom", { floorId: "", month: "2026-08" }, { m: 3 });
    reportCacheInvalidate("2026-08-16");
    expect(reportCacheGet("eodBulk", { date: "2026-08-16" })).toBeNull();
    expect(reportCacheGet("eod", { date: "2026-08-16", floorId: "30001" })).toBeNull();
    // Unrelated month key survives.
    expect(reportCacheGet("eom", { floorId: "", month: "2026-08" })).toEqual({ m: 3 });
  });
});
