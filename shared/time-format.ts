/** Display stored HH:mm clock values without changing the storage format. */
export function formatTimeOfDay(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return value;
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/** Legacy shift values remain valid in saved records and API inputs. */
export function formatShiftLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (/\b(?:AM|PM)\b/i.test(value)) return value;
  return value.replace(/\b\d{1,2}:\d{2}\b/g, time => formatTimeOfDay(time));
}

export function to24HourTime(hour: string, minute: string, period: "AM" | "PM"): string {
  const h = Number(hour) % 12 + (period === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${minute.padStart(2, "0")}`;
}
