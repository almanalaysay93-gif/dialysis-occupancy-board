import { describe, expect, it } from "vitest";
import { formatShiftLabel, formatTimeOfDay, to24HourTime } from "../shared/time-format";

describe("12-hour clock display with compatible stored times", () => {
  it.each([
    ["00:00", "12:00 AM"], ["12:00", "12:00 PM"],
    ["13:05", "1:05 PM"], ["23:59:00", "11:59 PM"],
    ["07:30", "7:30 AM"], ["1:05 PM", "1:05 PM"],
  ])("formats %s as %s", (stored, display) => expect(formatTimeOfDay(stored)).toBe(display));

  it.each([
    ["12", "00", "AM", "00:00"], ["12", "00", "PM", "12:00"],
    ["01", "05", "PM", "13:05"], ["07", "30", "AM", "07:30"],
  ] as const)("stores %s:%s %s as %s", (h, m, period, expected) => {
    expect(to24HourTime(h, m, period)).toBe(expected);
  });

  it("displays legacy shift ranges with AM/PM without changing saved values", () => {
    expect(formatShiftLabel("Night (21:00-05:00)")).toBe("Night (9:00 PM-5:00 AM)");
    expect(formatShiftLabel("Morning (5:00 AM-1:00 PM)")).toBe("Morning (5:00 AM-1:00 PM)");
    expect(formatTimeOfDay(null)).toBe("—");
    expect(formatTimeOfDay("bad time")).toBe("bad time");
  });
});
