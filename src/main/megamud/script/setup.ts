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

/** `0x40b200` (D13): game set-up asked for (or the HP prompt not seen): the options MegaMUD reads by. */
export function gameSetup(s: Session): number {
  if (s.f_e2c8 === 0 || s.f_e2d4 !== 0) return 0;
  send(s, `set statline ${s.MegaMud_StatLine}\r`);
  queue(s, 'set palette 0\r');
  queue(s, 'set talk fast\r');
  queue(s, 'set warning on\r');
  queue(s, 'set interrupt on\r');
  queue(s, 'set messages high\r');
  queue(s, 'set keep on\r');
  queue(s, 'brief\r');
  s.f_e2c8 = 0;
  s.f_e2d4 = 1;
  s.f_e290 = 1;
  s.host.activity('Game setup requested or HP prompt not detected');
  return 1;
}

/**
 * `0x40d0e0` (D14): `stat` when wanted (`0xe29c`) and not asked for in the
 * last `LagWait` + 3 seconds, or when HP or mana runs over its maximum (not
 * within 15 seconds of the last); else `exp` (`0xe2a8`) or `spells`/`powers`
 * (`0xe2cc`) when wanted. Not in a fight, unless forced (-1).
 */
export function refreshStats(s: Session): number {
  if (s.f_e29c !== -1 && s.f_e2a8 !== -1 && enemiesHere(s, 0) > 0) return 0;
  if (s.f_e29c === 0) {
    const recent = s.now - s.f_32378 < 0xf;
    if (recent || (s.hp <= s.Player_MaxHP && s.mana <= s.Player_MaxMana)) {
      if (s.f_e2a8 === 0) {
        if (s.f_e2cc === 0) return 0;
        s.f_e2cc = 0;
        setState(s, 0x2e);
        s.host.activity('Getting player spells/powers');
        send(s, classMagic(s.data, s.Player_Class) === 5 ? 'powers\r' : 'spells\r');
        return 1;
      }
      s.f_e2a8 = 0;
      s.waitLines = 2;
      setState(s, 0x2e);
      s.host.activity('Getting player experience');
      send(s, 'exp\r');
      return 1;
    }
  }
  if (s.now - s.f_32378 <= s.Comms_LagWait + 3) return 0;
  s.Player_MaxHP = Math.max(s.Player_MaxHP, s.hp);
  s.Player_MaxMana = Math.max(s.Player_MaxMana, s.mana);
  s.hp = s.Player_MaxHP;
  s.mana = s.Player_MaxMana;
  s.f_e29c = 0;
  s.waitLines = 2;
  s.f_32378 = s.now;
  setState(s, 0x2e);
  s.host.activity('Getting player stats');
  send(s, 'stat\r');
  return 1;
}

/** `0x407e40` (D15): `i` when the inventory is not known (no maximum encumbrance), at most every `LagWait` + 4 seconds. */
export function refreshInventory(s: Session): number {
  if (s.f_8468 >= 1 || s.hp <= 0) return 0;
  if (s.now - s.f_32348 <= s.Comms_LagWait + 4) return 0;
  s.f_32348 = s.now;
  s.waitLines = 2;
  setState(s, 0x25);
  s.host.activity('Getting inventory');
  send(s, 'i\r');
  return 1;
}

/** `0x40d820` (D16): `who` when wanted (`0xe2a4`; not in a fight, unless forced, -1). */
export function refreshWho(s: Session): number {
  if (s.f_e2a4 !== -1 && enemiesHere(s, 0) > 0) return 0;
  if (s.f_e2a4 === 0) return 0;
  s.f_e2a4 = 0;
  s.f_e290 = 1;
  s.waitLines = 2;
  setState(s, 0x23);
  s.host.activity('Getting list of online players');
  send(s, 'who\r');
  return 1;
}

/** `0x495590`: exp, stats and spells to be asked for again (the spells' learned marks cleared). */
export function statsWanted(s: Session): void {
  s.f_e29c = 1;
  for (const spell of s.data.spells) spell.flags &= ~0x1000;
}
