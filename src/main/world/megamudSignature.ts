/**
 * MegaMUD's signature for a room of the realm data (2026-10-18): what the
 * engine places a room by, and what places a recorded loop's start
 * (`megamudLoops.ts`). The arithmetic is the engine's own (`roomSignatureOf`).
 */
import { Exit } from '../megamud/flags';
import { roomSignatureOf } from '../megamud/move/exits';
import { roomNameHash } from '../megamud/room/roomName';
import { DIRECTIONS, type RequirementKind, type WorldRoom } from '../../shared/world';

/**
 * Exits the game lists as plain ones, whatever stops a character using them.
 * An item's and a cast's among them: `Rooms.md` in MudRev's Default folder
 * records all 11 item exits and all 6 cast ones of the rooms it places as
 * plain exits (2026-10-18).
 */
const PLAIN: ReadonlySet<RequirementKind> = new Set([
  'level',
  'class',
  'race',
  'alignment',
  'ability',
  'trap',
  'item',
  'cast'
]);

/**
 * A room's signature as the exits line would give it (`0x438f90`'s
 * `finish`), from the realm data: a plain exit 1, a door or gate 2, a hidden
 * one or a text one 0 (the game lists neither: `Rooms.md` records 31 of the
 * 32 text exits of the rooms it places as none, 2026-10-18). Null when an
 * exit's kind leaves it unsure how the game lists it.
 */
export function worldSignature(room: WorldRoom): number | null {
  const exits = new Array<number>(10).fill(Exit.None);
  for (const exit of room.exits) {
    const dir = DIRECTIONS.indexOf(exit.direction);
    if (dir === -1) continue;
    const kind = exit.requirement?.kind ?? null;
    let code: number;
    if (kind === null || PLAIN.has(kind)) code = Exit.Open;
    else if (kind === 'door' || kind === 'key') code = Exit.ClosedDoor;
    else if (kind === 'hidden' || kind === 'text') code = Exit.None;
    else return null;
    exits[dir] = Math.max(exits[dir]!, code);
  }
  return roomSignatureOf(roomNameHash(room.name), exits);
}
