/**
 * The scheduler's odd jobs, read 2026-10-12: the MUD op's room check for a
 * monster's home (D38, D11), and searching (D45).
 */
import type { Session } from '../Session';
import { queue, send } from './send';
import { setState } from './state';

/**
 * `0x46fee0` (D38, D11): a MUD op asked about a monster (`@home`): `sys stat
 * room` for its home, when it has one (`0x400`); else the asker told it
 * failed. (With no one asking, MegaMUD's own monster window is told; left out.)
 */
export function roomCheck(s: Session): number {
  if (s.BBS_IsMudop === 0 || s.f_d8f0 === 0 || s.f_d8f4 === 0 || s.f_d8f8 === -1) return 0;
  const mon = s.data.monsters[s.f_d8f8];
  if (!mon) return 0;
  const home = mon.home;
  if ((mon.flags & 0x400) !== 0 && home && home[0] !== 0 && home[1] !== 0) {
    s.spawnAlive = 0;
    s.spawnMonster = '';
    s.spawnText = '';
    queue(s, `sys stat room ${home[0]} ${home[1]}\r`);
    s.f_d8f4 = 0;
    return 1;
  }
  if (s.roomReply !== '') {
    queue(s, `${s.roomReply} {failed}\r`);
    s.roomReply = '';
  }
  return 0;
}

/**
 * `0x40aff0` (D45): with `MegaMud.AutoSearch` (or `Other.SearchNeedItem`
 * while an item is wanted for a path), `sea`, up to `Other.SearchMax` times
 * in a room.
 */
export function searchRoom(s: Session): number {
  if (s.MegaMud_AutoSearch === 0 && (s.Other_SearchNeedItem === 0 || s.s_8474 === '')) return 0;
  if (s.inCombat !== 0 || s.hp <= 0 || s.blind !== 0 || s.f_db60 === 0) return 0;
  s.hidden = 0;
  s.f_db60 -= 1;
  s.sneaking = 0;
  s.waitLines = 2;
  setState(s, 0x21);
  s.host.activity(`Searching room (need ${s.s_8474})`);
  send(s, 'sea\r');
  return 1;
}
