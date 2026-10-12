/**
 * `0x413760`: light a dark room (D28), read 2026-10-12. With `AutoLight` on,
 * a dark room (or a dim one, with `LightDimRooms`) gets the light spell (its
 * item equipped first, if it is cast from one), else a light source from the
 * inventory (`0x453760`). Not while hidden, nor against monsters here.
 */
import { enemiesHere } from '../room/entities';
import type { Session } from '../Session';
import { unported } from '../unported';
import { castSpell, equipForSpell } from './cast';

export function healStep(s: Session): number {
  if (s.hp < 1) return 0;
  const st = s.state;
  if (st === 0x11 || st === 0x12) return 0;
  if (st === 0 && s.f_e1c4 !== 0 && s.f_e184 !== 0 && enemiesHere(s, 0) > 0) return 0;
  if (s.MegaMud_AutoLight === 0 || s.hidden !== 0) return 0;
  if (s.f_e1c4 !== 0 && enemiesHere(s, 0) > 0) return 0;
  const dark = s.darkness;
  if (dark === 3 || (dark === 1 && s.Other_LightDimRooms === 0)) return 0;
  let lit = false;
  if (dark !== 0 && s.Spells_LightCmd !== '') {
    if (s.inCombat !== 0 && s.Other_BlessCombat === 0) return 0;
    if (equipForSpell(s, s.Spells_LightCmd) === 1) return 1;
    lit = castSpell(s, s.Spells_LightCmd, null) !== 0;
  }
  if (!lit) {
    if (dark === 0 || dark === 1) return 0;
    if (unported('453760') === 0) return 0;
  }
  s.darkness = 0;
  s.f_32390 = 0;
  s.f_e290 = 1;
  return 1;
}
