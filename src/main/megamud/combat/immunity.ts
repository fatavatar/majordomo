/**
 * A monster's immunity to a spell, remembered by the spell (asked for
 * 2026-10-21).
 *
 * MegaMUD marks a monster immune to a rung: the pre-attack (`0x800`), the
 * second attack spell (`0x2000`), the main one (`0x1000`) and the two drain
 * heals (`0x80`, `0x100`), whatever spell that rung casts now. A profile, a
 * changed setting or a monster's own attack spell then inherited a mark
 * another spell had earned: Skinny's `lite` had no effect on the black
 * rosebush, and profile 2's `dfur` was never tried on it.
 *
 * Here the mark names the spell (`monsterMarks[].spells`), and the rung bits
 * MegaMUD's checks read are worked out from it for the spells the rungs cast
 * now (`applyImmunity`), whenever a monster's marks are put on it and when
 * the settings change.
 */
import type { RoomEntity, Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { EntityFlag, EntityType } from '../flags';
import { stricmp } from '../cstr';

/** The rung bits, which `applyImmunity` alone sets. */
export const CAST_IMMUNITY =
  EntityFlag.ImmunePreCast |
  EntityFlag.ImmuneAuxCast |
  EntityFlag.ImmuneMainCast |
  EntityFlag.ImmuneMainDrain |
  EntityFlag.ImmuneMinorDrain;

/** How many monsters' marks are remembered (`markMonsters`' 500). */
const MARKS_KEPT = 500;

/** A spell as marks hold it: its short, in lower case, however the setting names it. */
export function spellKey(s: Session, word: string): string {
  const rec = word === '' ? null : findSpell(s, word);
  return (rec?.short ?? word).trim().toLowerCase();
}

/** The spell each rung would cast at `e` now, by its bit (the monster's own first, as `tailor`). */
function rungSpells(s: Session, e: RoomEntity): [number, string][] {
  return [
    [EntityFlag.ImmunePreCast, e.mon?.preSpell || s.Combat_PreAttack],
    [EntityFlag.ImmuneAuxCast, s.Combat_AttackSpl2],
    [EntityFlag.ImmuneMainCast, e.mon?.attackSpell || s.Combat_AttackSpl],
    [EntityFlag.ImmuneMainDrain, s.Spells_HealCmd],
    [EntityFlag.ImmuneMinorDrain, s.Spells_HealCmd2]
  ];
}

function markOf(s: Session, e: RoomEntity): Session['monsterMarks'][number] | undefined {
  return s.monsterMarks.find(
    (m) => stricmp(e.name, m.name) === 0 || (e.mon !== null && stricmp(e.mon.name, m.name) === 0)
  );
}

/** `e`'s rung bits, from the spells its marks name. */
export function applyImmunity(s: Session, e: RoomEntity): void {
  e.flags &= ~CAST_IMMUNITY;
  const spells = markOf(s, e)?.spells;
  if (!spells || spells.length === 0) return;
  for (const [flag, word] of rungSpells(s, e)) {
    if (word !== '' && spells.includes(spellKey(s, word))) e.flags |= flag;
  }
}

/** Every monster here's rung bits worked out again: the spells the rungs cast have changed. */
export function refreshImmunities(s: Session): void {
  for (const e of s.room) if (e.type === EntityType.Monster) applyImmunity(s, e);
}

/** The monsters of this name are immune to `short`. False when that was known. */
export function markImmuneTo(s: Session, name: string, short: string): boolean {
  const key = spellKey(s, short);
  if (key === '') return false;
  let mark = s.monsterMarks.find((m) => stricmp(m.name, name) === 0);
  if (mark?.spells?.includes(key)) return false;
  if (!mark) {
    if (s.monsterMarks.length >= MARKS_KEPT) return false;
    mark = { name: name.slice(0, 30), flags: 0 };
    s.monsterMarks.push(mark);
  }
  mark.spells = [...(mark.spells ?? []), key];
  refreshImmunities(s);
  return true;
}
