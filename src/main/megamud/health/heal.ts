/**
 * `0x413760`: light a dark room (D28), read 2026-10-12. With `AutoLight` on,
 * a dark room (or a dim one, with `LightDimRooms`) gets the light spell (its
 * item equipped first, if it is cast from one), else a light source from the
 * inventory (`0x453760`). Not while hidden, nor against monsters here.
 */
import { goTo, headFor, roomByName } from '../move/destinations';
import { enemiesHere } from '../room/entities';
import { stamp } from '../script/events';
import { send } from '../script/send';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { castSpell, equipForSpell } from './cast';
import { State } from '../states';
import { CarriedFlag, ItemFlag, Darkness } from '../flags';

/** An item of type 6, a light source. */
const LIGHT = 6;

/**
 * `0x453760`: a light source carried is used (and marked equipped); with no
 * light spell, a light the item table buys (`4`) from a shop on the room
 * list is gone for, to buy it there. 1 when either was done.
 */
function lightSource(s: Session): number {
  for (const c of s.inventory) {
    if (c.item?.type !== LIGHT) continue;
    c.flags |= CarriedFlag.Equipped;
    s.waitLines = 2;
    setState(s, State.Other);
    send(s, `use ${c.item.name}\r`);
    s.darkness = Darkness.Lit;
    s.lookDue = 1;
    return 1;
  }
  if (s.Spells_LightCmd !== '') return 0;
  for (const item of s.data.items) {
    if (item.type !== LIGHT || (item.flags & ItemFlag.Buy) === 0 || item.shop === '') continue;
    const shop = roomByName(s, item.shop);
    if (!shop || goTo(s, shop.signature, null) === 0) continue;
    s.detours[0]!.why = 'to buy items';
    s.itemPickingUp = item.name.slice(0, 0x1e);
    s.host.show(`[Detouring to Shop (${stamp(s)})]`);
    headFor(s, 0);
    return 1;
  }
  return 0;
}

export function healStep(s: Session): number {
  if (s.hp < 1) return 0;
  const st = s.state;
  if (st === State.Attacking || st === State.Backstabbing) return 0;
  if (st === State.Nothing && s.sneaking !== 0 && s.walking !== 0 && enemiesHere(s, 0) > 0)
    return 0;
  if (s.MegaMud_AutoLight === 0 || s.hidden !== 0) return 0;
  if (s.sneaking !== 0 && enemiesHere(s, 0) > 0) return 0;
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
    if (lightSource(s) === 0) return 0;
  }
  s.darkness = Darkness.Lit;
  s.roomLookedAt = 0;
  s.lookDue = 1;
  return 1;
}
