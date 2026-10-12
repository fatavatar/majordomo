/**
 * Bashing doors (`0x437c50`): bashed open (the exit becomes an open door),
 * a failed bash (tried again up to `Other.BashMax` when not automated), and
 * with `Party.HelpBash` the leader's bash joined. Read 2026-10-12.
 */
import { directionOf } from './exits';
import { directionWord, indexFrom, indexOf } from '../cstr';
import { queue } from '../script/send';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { unported } from '../unported';

export function bashLine(s: Session, line: string): number {
  if (indexOf(line, 'You bashed the ') !== -1 || indexOf(line, ' is already open.') !== -1) {
    if (s.state === 0x17 && s.f_db30 !== -1) {
      s.roomExits[s.f_db30] = 3;
      s.lineFlags |= 4;
    } else {
      s.f_e290 = 1;
    }
    s.sneaking = 0;
    s.hidden = 0;
    setState(s, 0);
    return 1;
  }
  if (indexOf(line, 'Your attempts to bash ') !== -1) {
    if (s.state === 0x17 && s.f_db30 !== -1) s.roomExits[s.f_db30] = 2;
    s.f_db48 += 1;
    s.sneaking = 0;
    s.hidden = 0;
    if (
      s.active === 0 &&
      s.f_e184 === 0 &&
      s.f_e18c === 0 &&
      s.f_e178 === 0 &&
      s.f_a32c === 0 &&
      s.state === 0x17 &&
      s.f_db30 !== -1
    ) {
      if (s.f_db48 < s.Other_BashMax) queue(s, `bash ${directionWord(s.f_db30)}\r`);
      else s.f_db48 = 0;
    }
    setState(s, 0);
    return 1;
  }
  if (s.following === 0) return 0;
  const see = indexOf(line, 'You see ');
  if (see === -1) return 0;
  const attempt = indexFrom(line, see, ' attempt to bash the ');
  if (attempt === -1) return 0;
  const who = line.slice(see + 8, see + 8 + Math.min(attempt - see - 8, 10));
  if (s.Party_HelpBash !== 0 && who === s.leaderName) {
    let dir: number;
    if (indexFrom(line, attempt, 'above you') !== -1) dir = 8;
    else if (indexFrom(line, attempt, 'below you') !== -1) dir = 9;
    else {
      const to = indexFrom(line, attempt, 'to the ');
      if (to === -1) return 1;
      dir = directionOf(line.slice(to + 7));
      if (dir === -1) return 1;
    }
    s.f_db30help = dir;
    unported('408870');
  }
  return 1;
}
