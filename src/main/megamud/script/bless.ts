/**
 * `0x4066f0`: blessings (D22 in a fight, D25 out of one), read 2026-10-12.
 *
 * Fourteen slots: `Spells.BlessCmd1`–`10` on this character, and
 * `Party.PartyBless1`–`4` on the weakest party member. A slot is cast when
 * it never has been, when its `BlessTim` has passed since it was last seen
 * to take, or (no timer) ten minutes on; a party slot waits `PartyBlessWait`
 * seconds between casts. A slot with `BlessPri` (or every slot, with
 * `Other.BlessPriority`) is a priority blessing: those are cast in the fight
 * step, the others in the idle one. Only spells flagged as lasting (Spells.md
 * `2`) are blessings; mana must be above `ManaBless%`.
 */
import { indexOfNoCase } from '../cstr';
import { castSpell, equipForSpell } from '../health/cast';
import { weakestMember } from '../party/members';
import { blessCommand } from '../player/cast';
import { enemiesHere } from '../room/entities';
import type { Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { forgetAwaited, setState } from './state';

const SLOTS = 0xe;
const OWN = 10;

function field(s: Session, name: string): number {
  return (s as unknown as Record<string, number>)[name] ?? 0;
}

/** Slot `i`'s spell: a blessing of this character's, or a party blessing. */
function slotCommand(s: Session, i: number): string {
  return i < OWN
    ? blessCommand(s, i)
    : ((s as unknown as Record<string, string>)[`Party_PartyBless${i - 9}`] ?? '');
}

/** Slot `i` is cast in the fight step. */
function priority(s: Session, i: number): boolean {
  if (s.Other_BlessPriority !== 0) return true;
  return i < OWN && field(s, `Spells_BlessPri${i + 1}`) !== 0;
}

/** Whether slot `i` is due again. */
function due(s: Session, i: number, first: boolean): boolean {
  const castAt = s.blessCastAt[i]!;
  if (castAt === 0) return true;
  const timer = i < OWN ? field(s, `Spells_BlessTim${i + 1}`) : 0;
  if (timer > 0) {
    if (first && s.blessSeenAt[i] === 0) return true;
    if (s.blessSeenAt[i] === 0) s.blessSeenAt[i] = castAt;
    return s.now - s.blessSeenAt[i]! > timer;
  }
  return s.now - castAt > 600;
}

export function blessStep(s: Session, fighting: number): number {
  if (s.runCount >= 1 && fighting === 0) return 0;
  if (s.MegaMud_AutoBless === 0 || s.state === 0x12) return 0;
  if (
    s.state === 0 &&
    s.sneaking !== 0 &&
    s.f_e184 !== 0 &&
    enemiesHere(s, s.Combat_AttackNeutral) >= 1
  ) {
    return 0;
  }
  if (s.state === 0x10) {
    // A blessing cast, its message not seen: taken as cast, once it was answered.
    if (s.f_a3e0 === 0) return 1;
    if (s.blessSlot !== -1 && s.f_a3e4 > 0) {
      s.blessCastAt[s.blessSlot] = s.now;
      s.blessSeenAt[s.blessSlot] = s.now;
      if (s.debug !== 0) s.host.trace(`{bless+${s.blessSlot}}`);
    }
    forgetAwaited(s, 0x10);
    setState(s, 0);
  }
  if (s.hp < 1 || s.confused !== 0) return 0;
  if (s.inCombat !== 0 && s.Other_BlessCombat === 0) return 0;
  const st = s.state;
  if ((st === 2 || st === 3 || st === 4 || st === 5) && s.Other_BlessResting === 0) return 0;
  if (Math.trunc((s.Player_MaxMana * s.Health_ManaBlessPct) / 100) > s.mana) return 0;
  for (let i = 0; i < SLOTS; i += 1) {
    const first = priority(s, i);
    if (fighting !== 0 ? !first : first) continue;
    if (s.runCount >= 1 && !first) continue;
    if (i >= OWN && s.partySize < 2) break;
    const command = slotCommand(s, i);
    if (command === '') continue;
    const spell = findSpell(s, command);
    if (!spell || (spell.flags & 2) === 0) continue;
    if (i >= OWN) {
      if (s.now - s.blessCastAt[i]! <= field(s, `Party_PartyBlessWait${i - 9}`)) continue;
      s.blessCastAt[i] = 0;
    }
    if (!due(s, i, first)) continue;
    if (equipForSpell(s, spell.short) === 1) return 1;
    let at: string | null = null;
    if (i >= OWN && (spell.flags & 0x80) === 0) {
      const m = weakestMember(s, 0, 0x1100);
      if (m === -1) continue;
      at = s.party[m]!.name;
    }
    if (castSpell(s, spell.short, at) === 0) continue;
    s.blessSlot = i;
    if (at === null && (spell.item === '' || indexOfNoCase(spell.item, 'use ') !== -1)) {
      // Its message will say whether it took.
      setState(s, 0x10);
      return 1;
    }
    s.blessCastAt[i] = s.now;
    s.blessSeenAt[i] = s.now;
    s.f_a3e0 = 1;
    s.f_a3e4 = 1;
    setState(s, 0);
    return 1;
  }
  s.blessSlot = -1;
  return 0;
}
