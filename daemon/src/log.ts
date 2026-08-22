/** One line per event, timestamped — the daemon's whole UI is this log. */
export function log(message: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
}

export function warn(message: string): void {
  console.error(`${new Date().toISOString().slice(11, 19)} ! ${message}`);
}
