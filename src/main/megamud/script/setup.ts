/**
 * The scheduler's set-up and refresh steps, read 2026-10-12: the game
 * options MegaMUD needs (D13), and the stats, experience, spells, inventory
 * and who list asked for when they are wanted or stale (D14–D16). Each sends
 * its command and waits for the listing (state `0x2e`, `0x25`, `0x23`).
 */
import { classMagic } from '../data';
import { enemiesHere } from '../room/entities';
import type { Session } from '../Session';
import { queue, send } from './send';
import { setState } from './state';
import { State } from '../states';

/** `0x40b200` (D13): game set-up asked for (or the HP prompt not seen): the options MegaMUD reads by. */
export function gameSetup(s: Session): number {
  if (s.setupDue === 0 || s.setupDone !== 0) return 0;
  send(s, `set statline ${s.MegaMud_StatLine}\r`);
  queue(s, 'set palette 0\r');
  queue(s, 'set talk fast\r');
  queue(s, 'set warning on\r');
  queue(s, 'set interrupt on\r');
  queue(s, 'set messages high\r');
  queue(s, 'set keep on\r');
  queue(s, 'brief\r');
  s.setupDue = 0;
  s.setupDone = 1;
  s.lookDue = 1;
  s.host.activity('Game setup requested or HP prompt not detected');
  return 1;
}

/**
 * `0x40d0e0` (D14): `stat` when wanted (`statDue`) and not asked for in the
 * last `LagWait` + 3 seconds, or when HP or mana runs over its maximum (not
 * within 15 seconds of the last); else `exp` (`expDue`) or `spells`/`powers`
 * (`spellsDue`) when wanted. Not in a fight, unless forced (-1).
 */
export function refreshStats(s: Session): number {
  if (s.statDue !== -1 && s.expDue !== -1 && enemiesHere(s, 0) > 0) return 0;
  if (s.statDue === 0) {
    const recent = s.now - s.statAskedAt < 0xf;
    if (recent || (s.hp <= s.Player_MaxHP && s.mana <= s.Player_MaxMana)) {
      if (s.expDue === 0) {
        if (s.spellsDue === 0) return 0;
        s.spellsDue = 0;
        setState(s, State.Other);
        s.host.activity('Getting player spells/powers');
        send(s, classMagic(s.data, s.Player_Class) === 5 ? 'powers\r' : 'spells\r');
        return 1;
      }
      s.expDue = 0;
      s.waitLines = 2;
      setState(s, State.Other);
      s.host.activity('Getting player experience');
      send(s, 'exp\r');
      return 1;
    }
  }
  if (s.now - s.statAskedAt <= s.Comms_LagWait + 3) return 0;
  s.Player_MaxHP = Math.max(s.Player_MaxHP, s.hp);
  s.Player_MaxMana = Math.max(s.Player_MaxMana, s.mana);
  s.hp = s.Player_MaxHP;
  s.mana = s.Player_MaxMana;
  s.statDue = 0;
  s.waitLines = 2;
  s.statAskedAt = s.now;
  setState(s, State.Other);
  s.host.activity('Getting player stats');
  send(s, 'stat\r');
  return 1;
}

/** `0x407e40` (D15): `i` when the inventory is not known (no maximum encumbrance), at most every `LagWait` + 4 seconds. */
export function refreshInventory(s: Session): number {
  if (s.weightMax >= 1 || s.hp <= 0) return 0;
  if (s.now - s.inventoryAskedAt <= s.Comms_LagWait + 4) return 0;
  s.inventoryAskedAt = s.now;
  s.waitLines = 2;
  setState(s, State.Inventory);
  s.host.activity('Getting inventory');
  send(s, 'i\r');
  return 1;
}

/** `0x40d820` (D16): `who` when wanted (`whoDue`; not in a fight, unless forced, -1). */
export function refreshWho(s: Session): number {
  if (s.whoDue !== -1 && enemiesHere(s, 0) > 0) return 0;
  if (s.whoDue === 0) return 0;
  s.whoDue = 0;
  s.lookDue = 1;
  s.waitLines = 2;
  setState(s, State.Who);
  s.host.activity('Getting list of online players');
  send(s, 'who\r');
  return 1;
}
