/**
 * The end of a combat round, read at the prompt that closes it: the round's
 * damage (`0x425c40`), the attack-cast watchdog (`0x426560`) and the combat
 * reset when nothing has been heard (`0x426420`). Read 2026-10-12.
 */
import type { Session } from '../Session';
import { enemiesHere } from '../room/entities';
import { setState } from '../script/state';
import { castCount, f_426ab0, MODE_LABEL, NO_MESSAGE, resetNoMessage } from './casts';
import { clearCastMode, clearNoMessageRounds } from './engaged';
import { currentTarget } from '../room/entities';
import { castForgotten } from './timer';

/**
 * `0x425c40`: a round's damage is totalled (fewest and most, and the sum),
 * and with `Party.ParAfterRound` the next party status is due.
 */
export function combatRoundEnd(s: Session): void {
  if (s.f_32600 === 0 || s.f_32604 === 0 || s.f_3260c === 0) {
    s.f_32614 = 0;
    if (s.Party_ParAfterRound === 0 || s.f_32604 === 0) return;
    s.f_32604 = 0;
    s.f_3260c = 0;
  } else {
    if (s.Display_ShowRounds !== 0) s.host.show(`(Dmg:${s.f_32614} Tot:${s.f_32618})`);
    let fewest = s.f_3261c;
    if (fewest === 0 && s.f_32620 === 0) fewest = s.f_32614;
    const dealt = s.f_32614;
    s.f_32614 = 0;
    if (dealt <= fewest) fewest = dealt;
    s.f_32604 = 0;
    s.f_3261c = fewest;
    s.f_3260c = 0;
    s.f_32610 += 1;
    s.f_32624 += dealt;
    s.f_32620 = Math.max(s.f_32620, dealt);
    if (s.Party_ParAfterRound === 0) return;
  }
  s.f_32328 = 0;
}

/**
 * `0x426560`: a round passed in an attack-cast state. When the count moved,
 * the watch restarts. Otherwise, at most once every 4 seconds, a round with
 * no spell message is counted: at 1 it is noted, at 2 the spell is retried,
 * and past that it is given up for the fight (its count gains 9999) and
 * combat is dropped so the scheduler chooses again.
 */
export function castWatchdog(s: Session): number {
  if (f_426ab0(s, 0) === 0) return 0;
  const mode = s.state;
  if (s.f_a448 !== mode) return 0;
  const count = castCount(s, mode);
  if (s.f_a44c !== 0 || s.f_a454 < count) {
    resetNoMessage(s, mode);
    s.f_a44c = 0;
    s.f_a454 = count;
    s.f_a458 = 0;
    s.f_a450 = 0;
    return 0;
  }
  if (s.f_a450 !== 0) {
    s.f_a450 = 0;
    return 0;
  }
  const label = MODE_LABEL[mode];
  const field = NO_MESSAGE[mode];
  if (!label || !field) return 0;
  const now = s.host.tickMs();
  if (s.f_a458 !== 0 && now - s.f_a458 < 4000) return 0;
  s.f_a458 = now;
  const rounds = (s[field] as number) + 1;
  (s as unknown as Record<string, number>)[field as string] = rounds;
  if (rounds < 3) {
    if (rounds === 1 || s.state === 0xf) {
      s.host.activity(`${label} spell: no spell messages seen`);
      return 1;
    }
    s.host.activity(`Retrying ${label} spell: no spell messages seen`);
  } else {
    giveUpSpell(s, mode);
    (s as unknown as Record<string, number>)[field as string] = 0;
    s.host.activity(`Skipping ${label} spell: no spell message seen`);
    s.host.show(`[${s.castShort}: no spell msg seen after multiple rounds]`);
  }
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C7}');
  s.inCombat = 0;
  castForgotten(s);
  s.f_e1d8 = 0;
  clearCastMode(s);
  setState(s, 0);
  return 1;
}

/**
 * The part of `0x426560` that spends a spell that never answers. A pre-attack
 * on a player marks which PvP spell failed on them (entity flags `0x20` and
 * `0x40`) rather than spending the mode.
 */
function giveUpSpell(s: Session, mode: number): void {
  const counter: Record<number, string> = {
    9: 'f_a3e8',
    0xa: 'f_a3ec',
    0xb: 'f_a3f0',
    0xc: 'f_a3f8',
    0xd: 'f_a3f4',
    0xe: 'f_a3fc',
    0xf: 'f_a400'
  };
  const field = counter[mode]!;
  const fields = s as unknown as Record<string, number>;
  if (mode === 0xb && s.castShort !== '') {
    const isPvp = s.castShort === s.PvP_PvpSpell1 || s.castShort === s.PvP_PvpSpell2;
    if (isPvp) {
      const e = currentTarget(s);
      if (e && e.type === 1) {
        if (s.castShort === s.PvP_PvpSpell1) e.flags |= 0x20;
        if (s.castShort === s.PvP_PvpSpell2) e.flags |= 0x40;
      }
      return;
    }
  }
  fields[field] = (fields[field] ?? 0) + 9999;
  if (s.f_e364 !== 0 && s.state === 0xe) s.f_a62c = s.Spells_HealCasts;
}

/**
 * `0x426420`: in a fight with hostile monsters here, when for 15 seconds
 * there has been no combat message, no round and no move, combat is reset:
 * "Resetting Combat...".
 */
export function resetCombat(s: Session): number {
  if (s.inCombat === 0 || enemiesHere(s, 0) === 0) return 0;
  const quiet = (t: number): boolean => t !== 0 && s.now - t > 0xe;
  if (quiet(s.f_322d8) && quiet(s.f_322e8) && quiet(s.f_32320)) {
    s.host.activity('Resetting Combat...');
    s.host.show('[Reset Combat: No player combat messages seen after multiple rounds]');
    s.inCombat = 0;
    s.f_e1d8 = 0;
    s.f_a580 = 0;
    s.f_e2b8 = 1;
    clearNoMessageRounds(s);
    clearCastMode(s);
    setState(s, 0);
    s.f_e290 = 1;
    return 1;
  }
  return 0;
}
