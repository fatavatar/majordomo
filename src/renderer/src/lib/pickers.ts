/**
 * The window's own realm picker, for a bridge that has no native one.
 *
 * `IpcApi.chooseRealm` is a native dialog on the desktop. In a browser tab
 * the client's disk is out of the player's reach — a container's volume, a
 * machine across the room — so the realm's database is sent up from the
 * tab instead (`RealmUpload`, 2026-11-10), and the web bridge asks the window
 * for that through this seam. `App.tsx` registers one while it is mounted;
 * the bridge is not React and must not reach into it.
 */
export type RealmPicker = () => Promise<string | null>;

let picker: RealmPicker | null = null;
let uploads = false;

/** Said by the web bridge: a realm's database is sent up from this tab, not browsed for. */
export function chooseRealmsByUpload(): void {
  uploads = true;
}

/** Whether choosing a realm's database sends one up — what its button is called. */
export function realmsAreUploaded(): boolean {
  return uploads;
}

export function registerRealmPicker(next: RealmPicker | null): void {
  picker = next;
}

/** Whether a picker is registered — a bridge asks before promising one. */
export function hasRealmPicker(): boolean {
  return picker !== null;
}

/** The chosen path, or null when dismissed or when nothing can ask. */
export function pickRealm(): Promise<string | null> {
  return picker === null ? Promise.resolve(null) : picker();
}
