/**
 * `0x470060`: the MUD op's `room` reply, read 2026-10-12 (while one is asked
 * for, `homeLookup`): `Room N … Map: M` (the room's numbers), `Specific Monster
 * is Alive`, `Specific Monster: N-name [killed: dd-Mon-yy hh:mm:ss: regen
 * hours]` (when it respawns), and `Hidden items:` (the end: the answer goes
 * out as the reply asked for, `roomReply`).
 */
import { atoi, leadingNumber, trimSpaces } from '../cstr';
import { queue } from '../script/send';
import type { Session } from '../Session';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 day, 2 hours, 5 minutes". */
function span(seconds: number): string {
  const parts: string[] = [];
  const unit = (n: number, name: string): void => {
    if (n !== 0) parts.push(`${n} ${name}${n !== 1 ? 's' : ''}`);
  };
  unit(Math.trunc(seconds / 0x15180), 'day');
  seconds %= 0x15180;
  unit(Math.trunc(seconds / 0xe10), 'hour');
  seconds %= 0xe10;
  unit(Math.trunc(seconds / 0x3c), 'minute');
  return parts.join(', ');
}

/** The specific monster's line: its name, and when it respawns. */
function spawnLine(s: Session, line: string): number {
  const [, numEnd] = leadingNumber(line.slice(0x12));
  let rest = line.slice(0x12 + numEnd);
  if (!rest.startsWith('-')) return 0;
  rest = rest.slice(1);
  const bracket = rest.indexOf('[');
  if (bracket === -1) return 0;
  s.spawnMonster = trimSpaces(rest.slice(0, Math.min(bracket, 199)));
  let at = rest.indexOf(':', bracket);
  if (at === -1) return 0;
  rest = rest.slice(at + 1).replace(/^ +/, '');
  const day = atoi(rest);
  at = rest.indexOf('-');
  if (at === -1) return 0;
  rest = rest.slice(at + 1);
  const month = Math.max(
    0,
    MONTHS.findIndex((m) => rest.toLowerCase().startsWith(m.toLowerCase()))
  );
  at = rest.indexOf('-');
  if (at === -1) return 0;
  rest = rest.slice(at + 1);
  let year = atoi(rest);
  year = year < 0x32 ? year + 100 : year;
  at = rest.indexOf(' ');
  if (at === -1) return 0;
  const time = rest.slice(at).replace(/^ +/, '');
  const hour = atoi(time);
  at = rest.indexOf(':');
  if (at === -1) return 0;
  const minute = atoi(rest.slice(at + 1));
  const second = rest.indexOf(':', at + 1);
  if (second === -1) return 0;
  const seconds = atoi(rest.slice(second + 1));
  const killed = new Date(1900 + year, month, day, hour, minute, seconds).getTime() / 1000;
  const regen = rest.indexOf(':', second + 1);
  if (regen === -1) return 0;
  const due = killed + atoi(rest.slice(regen + 1)) * 0xe10;
  const now = Date.now() / 1000;
  s.spawnText = now < due ? `Regens in ${span(Math.trunc(due - now))}` : 'Should be alive!';
  return 1;
}

export function roomLine(s: Session, line: string): number {
  if (s.homeLookup === 0) return 0;
  if (line.startsWith('Room error')) {
    s.homeLookup = 0;
    s.homeAskDue = 0;
    s.roomReply = '';
    return 1;
  }
  if (line.startsWith('Room ') && line.includes('Map: ')) return 1;
  if (line.startsWith('Hidden items: ')) {
    s.homeAskDue = 1;
    s.homeMonster = -1;
    if (s.spawnAlive !== 0) s.spawnText = 'Alive now!';
    if (s.roomReply === '') return 1;
    queue(s, `${s.roomReply} {${s.spawnText}}\r`);
    s.roomReply = '';
    s.homeLookup = 0;
    return 1;
  }
  if (line.startsWith('Specific Monster is Alive')) {
    s.spawnAlive = 1;
    return 1;
  }
  if (line.startsWith('Specific Monster: ')) return spawnLine(s, line);
  return 0;
}
