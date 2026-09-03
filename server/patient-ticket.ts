/**
 * Public-safe ticket code for a patient identifier.
 *
 * The kiosk and any unauthenticated board viewer only ever receive this code,
 * never the real patient ID. Computing it on the server is what makes that
 * guarantee hold — the previous client-side masking still shipped the raw ID
 * over the wire on a public endpoint.
 */
export function patientTicket(patientId: string): string {
  if (!patientId) return "TK-0000";
  let hash = 0;
  for (let i = 0; i < patientId.length; i++) {
    hash = (hash << 5) - hash + patientId.charCodeAt(i);
    hash |= 0;
  }
  return `TK-${(Math.abs(hash) % 9000) + 1000}`;
}
