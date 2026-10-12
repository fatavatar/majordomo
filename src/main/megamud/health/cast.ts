/**
 * Casting a spell by its short name (`0x40c8a0`) and equipping the item a
 * spell is cast from (`0x40cc80`). Read 2026-10-12.
 *
 * A spell with a command (Spells.md's `+0x2a`, "use wand" and the like) is
 * sent as that command, macros expanded, instead of its short name. A spell
 * that costs mana waits for the round timer (`0x49af50`), and stamps it.
 */
import { spellTakesTarget } from '../combat/casts';
import { castAllowed, castStamp } from '../combat/timer';
import { enemiesHere } from '../room/entities';
import { expandMacros, noteCommands, send } from '../script/send';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { castable, findSpell } from '../spells/lookup';
import { unported } from '../unported';

/** `0x4ad9a0`: a trailing `^M` dropped. */
function dropCaretM(text: string): string {
  return text.length > 1 && text.endsWith('^M') ? text.slice(0, -2) : text;
}

/**
 * `0x40c8a0`: cast `short` (at `target`, when the spell takes one). 1 when
 * sent; 0 when it can't be: dead, too soon this round, short of mana, or a
 * target it needs is missing.
 */
export function castSpell(s: Session, short: string, target: string | null): number {
  if (target === '') target = null;
  if (s.hp < 1) return 0;
  const spell = findSpell(s, short);
  let stamp = true;
  let arg: string | null = null;
  const timed =
    spell === null || ((spell.cost !== 0 || s.BBS_GreaterMUD !== 0) && (spell.flags & 6) !== 4);
  if (timed) {
    if (!castAllowed(s, s.inCombat !== 0 ? 1 : 0)) return 0;
    arg = target;
  } else {
    stamp = false;
  }
  if (spell !== null) {
    if (spell.cost !== 0 && spell.cost > s.mana) return 0;
    if ((spell.flags & 0x80) !== 0) target = null;
    arg = (spell.flags & 0x60) !== 0 ? target : null;
    if ((spell.flags & 0x90) === 0 && arg === null) return 0;
  }
  s.f_e1c4 = 0;
  s.hidden = 0;
  s.f_a3e0 = 0;
  s.f_a3e4 = 0;
  s.f_32310 = 0;
  let command = '';
  if (spell !== null && spell.item !== '') {
    command = expandMacros(s, dropCaretM(spell.item.slice(0, 99)));
    if (arg !== null && command.length + arg.length + 1 < 100) command += ` ${arg}`;
  }
  s.lastCast = short.slice(0, 0x50);
  if (stamp) {
    castStamp(s);
    s.skipTick = 1;
  }
  if (spell !== null && command !== '') noteCommands(s, spell.item);
  if (s.inCombat !== 0 || enemiesHere(s, 0) > 0) {
    s.f_e1d8 = 1;
    if (s.debug !== 0) s.host.trace('{I0+}');
    if (spellTakesTarget(spell) === 0) s.f_e2b8 = 1;
  }
  s.waitLines = 2;
  setState(s, 0x15);
  s.host.activity(`Casting spell ${short}`);
  if (spell !== null && command !== '') return send(s, `${command}\r`);
  return send(s, arg === null ? `${short}\r` : `${short} ${arg}\r`);
}

/**
 * `0x40cc80`: a spell cast from an item (it has a command) whose item is
 * carried but not equipped: equip it first. 1 when equipping (or held off by
 * a post-rest or post-meditate command), -1 when it is already equipped, 0
 * when the spell is not cast from an item this character has.
 */
export function equipForSpell(s: Session, short: string): number {
  if (s.hp < 1) return 0;
  const spell = findSpell(s, short);
  if (spell === null || (spell.cost !== 0 && spell.cost > s.mana)) return 0;
  if (spell.item === '' || castable(s, spell) === 0) return 0;
  unported('4530c0');
  return 0;
}
