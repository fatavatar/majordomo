/** `mmud/textblocks.js`: a room's script. Ours, beside mudtool's copy. */
/** The rooms a room command (`Rooms.CMD`) moves you to, and the command. */
export function roomTeleports(
  textblock: number,
  map: number
): Array<{ command: string; map: number; room: number }>;
