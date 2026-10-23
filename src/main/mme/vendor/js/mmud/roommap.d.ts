/** `mmud/roommap.js`: MME's room walker (frmMap). Ours, beside mudtool's copy. */
import type { Row } from '../db';
export const DIRS: string[];
export const DIR_NAMES: Record<string, string>;
export function getRoom(map: number, room: number): Row | null;
export function extractMapRoom(s: unknown): { map: number; room: number; type: string };
export function roomExits(row: Row): Array<{
  dir: string;
  i: number;
  raw: string;
  action?: boolean;
  map?: number;
  room?: number;
  type?: string;
  code?: number;
} | null>;
export interface MapSize {
  id: string;
  label: string;
  cols: number;
  rows: number;
  center: number;
  zoom: boolean;
}
export const MAP_SIZES: MapSize[];
/** `QBColor()`'s palette, which marks and lines are coloured from. */
export const QB: string[];
export const CELL: { PLAIN: string; UP: string; DOWN: string; BOTH: string; UNSEEN: string };
export const EXIT: Record<string, number>;
export interface MapCell {
  map: number;
  room: number;
  row: Row | null;
  color: string;
  draw: Array<{ shape: string; size: number; color: number }>;
  alt: { map: number; room: number } | null;
}
export function buildMap(
  startMap: number,
  startRoom: number,
  size?: MapSize,
  opts?: Record<string, unknown>,
  centerCell?: number | null,
  known?: ((map: number, room: number) => boolean) | null
): { cols: number; rows: number; center: number; zoom: boolean; cells: Array<MapCell | null> };
export function roomTooltip(row: Row, opts?: Record<string, unknown>): string;
export function roomRefs(
  map: number,
  room: number,
  opts?: Record<string, unknown>
): Array<{ text: string; ref: { kind: string; n: number | string } | null }>;
export function leadsHere(
  map: number,
  room: number,
  opts?: { onlyInGame?: boolean }
): Array<{ text: string; ref: { kind: string; n: number | string } | null }>;
export function findRoomByName(text: string, after?: string | null): Row | null;
export function searchRooms(text: string, limit?: number): Row[];
