/** Demos set this to 0 so the API process does not race them for the same outbox row. */
export function outboxWorkersEnabled(): boolean {
  return process.env.OUTBOX_AUTOSTART !== '0';
}
