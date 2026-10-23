/** `db.js`: the realm's tables, keyed by the database's column names. Ours, beside mudtool's copy. */
export type Row = Record<string, unknown>;
export const db: {
  info: Row | null;
  Classes: Row[];
  Items: Row[];
  Races: Row[];
  Spells: Row[];
  Shops: Row[];
  Monsters: Row[];
  Rooms: Row[];
  [table: string]: unknown;
};
export const by: {
  item: Map<number, Row>;
  monster: Map<number, Row>;
  spell: Map<number, Row>;
  shop: Map<number, Row>;
  cls: Map<number, Row>;
  race: Map<number, Row>;
  textblock: Map<number, Row>;
  room: Map<string, Row>;
};
export function roomKey(map: number, room: number): string;
export function loadDB(
  base: string,
  fetchJSON: (path: string) => Promise<unknown>
): Promise<unknown>;
