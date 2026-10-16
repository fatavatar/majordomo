/**
 * Where this character is, as `@where` tells it (read 2026-10-12): the room
 * and its exits (`0x4ae040`), and with `Talk.WhereUseRm` the map numbers an
 * `rm` reports (`Location: x,y`, `0x47a430`). Replies asked for before the
 * numbers arrive wait for them, or for the `rm` to time out (`0x4b6840`).
 */
import { directionShort } from '../cstr';
import { queue } from '../script/send';
import type { Session } from '../Session';

/** `0x4ae040`: `Room (Exits: N,S)`, or `(Exits: NONE)`. */
export function whereText(s: Session): string {
  const exits: string[] = [];
  for (let d = 0; d < 10; d += 1) {
    if (s.roomExits[d] !== 0) exits.push(directionShort(d).toUpperCase());
  }
  return `${s.roomName} (Exits: ${exits.length > 0 ? exits.join(',') : 'NONE'})`;
}

/** `0x4b6770`: the map numbers are this room's (its signature unchanged since the `rm`). */
export function roomKnown(s: Session): boolean {
  return s.f_8130 !== 0 && s.f_8170 !== 0 && s.f_8170 === s.f_8130;
}

/** `0x4b67a0`: ` - x/y ? n seconds ago`, while the last `rm` is this room's or under a minute old. */
export function whereAgo(s: Session): string {
  if (s.f_32380 === 0) return '';
  const secs = Math.max(0, s.now - s.f_32380);
  if (!roomKnown(s) && secs >= 0x3d) return '';
  return ` - ${s.f_8168}/${s.f_816c} ? ${secs} second${secs === 1 ? '' : 's'} ago`;
}

/** `0x4b6600`: the waiting `@where` replies answered, with the numbers (`fresh`) or how old they are. */
function whereReplies(s: Session, fresh: number): void {
  if (s.whereAsked.length > 0 && s.inGame !== 0) {
    const where = whereText(s);
    const numbers = fresh !== 0 ? ` - ${s.f_8168}/${s.f_816c}` : whereAgo(s);
    for (const prefix of s.whereAsked) queue(s, `${prefix} {${where}${numbers}}\r`);
  }
  s.whereAsked = [];
  s.whereAskedAt = 0;
}

/** `0x4b6840` (the one-second timer): the `rm` unanswered after `Comms.LagWait` + 4 seconds. */
export function whereTimeout(s: Session): void {
  if (s.whereAsked.length === 0) return;
  const wait = (Math.max(s.Comms_LagWait, 0) + 4) * 1000;
  if (s.host.tickMs() - s.whereAskedAt >= wait) whereReplies(s, 0);
}

/** `0x47a430`: `Location: x,y`, the map numbers of the room. */
export function locationLine(s: Session, line: string): number {
  if (s.inGame === 0 || line.indexOf('Location:') !== 0) return 0;
  const m = /^[ \t]*([0-9]+),([0-9]+)[ \t]*$/.exec(line.slice(9));
  if (!m) return 0;
  s.f_8168 = Number(m[1]);
  s.f_816c = Number(m[2]);
  s.f_8170 = s.f_8130;
  s.f_32380 = s.now;
  if (s.whereAsked.length > 0) whereReplies(s, 1);
  return 1;
}
