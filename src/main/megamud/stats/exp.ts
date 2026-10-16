/**
 * `Exp: 1234 Level: 5 Exp needed for next level: 600 (…)` (`0x494d70`).
 * A level that is not the one known asks for the character's stats and
 * spells again (`0x495590`). Read 2026-10-12.
 */
import { indexOf } from '../cstr';
import type { Session } from '../Session';
import { SpellFlag } from '../flags';

/** `0x4ad460`: a 64-bit number at the front (after spaces, with `-`), and where it ends. */
function bigNumber(text: string, at: number): [number, number] {
  let i = at;
  while (text[i] === ' ') i += 1;
  const negative = text[i] === '-';
  if (negative) i += 1;
  let n = 0;
  while (i < text.length && /[0-9]/.test(text[i]!)) {
    n = n * 10 + (text.charCodeAt(i) - 48);
    i += 1;
  }
  return [negative ? -n : n, i];
}

/** `0x495590`: exp, stats and spells to be asked for again (the spells' learned marks cleared). */
export function recheckStats(s: Session): void {
  s.statDue = 1;
  for (const spell of s.data.spells) spell.flags &= ~SpellFlag.Known;
}

export function expLine(s: Session, line: string): number {
  const at = indexOf(line, 'Exp: ');
  if (at === -1) return 0;
  const [exp, afterExp] = bigNumber(line, at + 4);
  if (!line.startsWith(' Level: ', afterExp)) return 0;
  const [level, afterLevel] = bigNumber(line, afterExp + 8);
  if (!line.startsWith(' Exp needed for next level: ', afterLevel)) return 0;
  const [needed] = bigNumber(line, afterLevel + 0x1c);
  if (level !== s.Player_Level) {
    s.host.trace(`Level extracted from "exp" command (${level}) doesnt match current level`);
    recheckStats(s);
    return 1;
  }
  s.exp = exp;
  s.expToLevel = needed;
  return 1;
}
