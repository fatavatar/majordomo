/**
 * Every extension `openRealm` accepts, for the file pickers — the desktop's
 * dialog and a browser tab's upload (2026-11-10) — and for prose.
 *
 * The same closed union `realmKind` and `isZip` decide between
 * (`main/world/RealmSource.ts`), and a list of extensions a picker offers that
 * the reader then refuses is a file a player can choose and not use. The
 * archive is last: it is the container, not a shape of its own. In shared so
 * the window can name it without reaching into main.
 */
export const REALM_EXTENSIONS = ['mdb', 'accdb', 'sqlite', 'db', 'sqlite3', 'zip'] as const;

/**
 * What an uploaded realm database holds (2026-11-10), said once it is kept:
 * the realm's own rows, its message table where it carries one (null where
 * not), and the hunting loops the realm is given from it, one an area.
 */
export interface RealmSummary {
  classes: number;
  races: number;
  monsters: number;
  items: number;
  rooms: number;
  messages: number | null;
  loops: number;
}
