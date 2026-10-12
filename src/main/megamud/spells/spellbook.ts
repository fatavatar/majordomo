/**
 * `0x4a2cf0`: the spellbook (`spells`), read 2026-10-12: under its heading
 * (`Level Mana Short Spell Name`, or `Kai`), each row's spell is marked as
 * known (`0x1000`, cleared by `0x495590` to ask again). A row that is not
 * `level cost short …` ends it (`lineFlags` `0x400000`).
 */
import { atoi, splitWord } from '../cstr';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { findSpell } from './lookup';

export function spellbookLine(s: Session, line: string): number {
  if (s.inGame === 0) return 0;
  if ((s.lineFlags & 0x400000) === 0) {
    if (
      line.indexOf('Level Mana Short Spell Name') === -1 &&
      line.indexOf('Level Kai  Short Spell Name') === -1
    ) {
      return 0;
    }
    setState(s, 0x2e);
    s.lineFlags |= 0x400000;
    return 1;
  }
  if ((s.lineFlags & 1) === 0) {
    let rest = line.replace(/^ +/, '');
    let level: string;
    let cost: string;
    let short: string;
    [level, rest] = splitWord(rest, ' ', 10);
    [cost, rest] = splitWord(rest, ' ', 10);
    [short] = splitWord(rest, ' ', 10);
    if (atoi(level) !== 0 && atoi(cost) !== 0 && short !== '') {
      const spell = findSpell(s, short);
      if (spell) spell.flags |= 0x1000;
      return 1;
    }
  }
  s.lineFlags &= ~0x400000;
  return 0;
}
