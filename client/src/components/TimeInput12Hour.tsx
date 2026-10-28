import { to24HourTime } from "@shared/time-format";

/** Explicit AM/PM controls even on devices whose native time picker is 24-hour. */
export default function TimeInput12Hour({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [hours, minutes] = value.split(":");
  const hour24 = Number(hours) || 0;
  const hour = String(hour24 % 12 || 12).padStart(2, "0");
  const minute = minutes || "00";
  const period = hour24 < 12 ? "AM" : "PM";
  const className = "min-h-10 min-w-0 w-full rounded-md border border-input bg-background px-1 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <div role="group" aria-label="Time" className="mt-1 grid grid-cols-3 gap-1">
      <select aria-label="Hour" className={className} value={hour}
        onChange={event => onChange(to24HourTime(event.target.value, minute, period))}>
        {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map(h => <option key={h}>{h}</option>)}
      </select>
      <select aria-label="Minute" className={className} value={minute}
        onChange={event => onChange(to24HourTime(hour, event.target.value, period))}>
        {Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")).map(m => <option key={m}>{m}</option>)}
      </select>
      <select aria-label="AM or PM" className={className} value={period}
        onChange={event => onChange(to24HourTime(hour, minute, event.target.value as "AM" | "PM"))}>
        <option>AM</option><option>PM</option>
      </select>
    </div>
  );
}
