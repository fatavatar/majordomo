/**
 * `0x4bd1c0`: the top heroes (`top`), read 2026-10-12: each row's name,
 * class and experience brought to a known player's record (`lineFlags`
 * `0x40`; state `0x24`).
 */
import { leadingNumber, splitWord } from '../cstr';
import { findClassByName } from '../data';
import { findPlayer } from '../room/checkNames';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';

export function topLine(s: Session, line: string): number {
  if (line.indexOf('Top Heroes of the Realm') !== -1) {
    s.lineFlags = (s.lineFlags & ~1) | 0x40;
    setState(s, 0x24);
    return 1;
  }
  if ((s.lineFlags & 0x40) === 0) return 0;
  if ((s.lineFlags & 1) !== 0) {
    s.lineFlags &= ~0x40;
    forgetAwaited(s, 0x24);
    setState(s, 0);
    return 0;
  }
  if (line.length <= 0x48 || leadingNumber(line)[0] === 0 || line[4] !== ' ') return 0;
  const [name] = splitWord(line.slice(5), ' ', 0xb);
  if (line[0x1a] !== ' ') return 0;
  const [className] = splitWord(line.slice(0x1b), ' ', 0x14);
  if (line[0x39] !== ' ') return 0;
  const [expText] = splitWord(line.slice(0x3a).replace(/^ +/, ''), ' ', 0x14);
  const cls = findClassByName(s.data, className);
  if (!cls) return 0;
  s.f_32368 = s.host.tickMs();
  const p = findPlayer(s, name);
  if (p) {
    p.name = name.slice(0, 10);
    p.exp = Number(/^ *(-?[0-9]*)/.exec(expText)![1] || 0);
    s.f_e24c = 1;
    if (p.cls !== cls.id) {
      if (p.cls !== 0) {
        s.host.show(`[${name}'s class updated]`);
        p.level = 0;
      }
      p.cls = cls.id;
    }
  }
  return 1;
}
