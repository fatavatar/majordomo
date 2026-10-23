/**
 * Finding a spell by what is typed to cast it (`0x4a2410`), and whether this
 * character can cast it (`0x4a32b0`, `0x4a32f0`). Read 2026-10-12.
 */
import { stricmp } from '../cstr';
import type { MessageRec, SpellRec } from '../data';
import { findClass } from '../data';
import type { Session } from '../Session';
import { SpellFlag } from '../flags';

/**
 * `0x4a2410`: the spell whose short name is `short`. One with a magic class
 * that this character can cast is preferred; otherwise any it can cast.
 */
export function findSpell(s: Session, short: string): SpellRec | null {
  if (short === '') return null;
  /*
   * The one the character knows, where several share the word: mudrev's
   * `intr` is divine intervention and demonic intervention, and Skinny, who
   * casts the demonic, was taken for the divine (2026-10-21), its messages
   * never seen and its lasting bit holding it to the round timer.
   */
  for (const spell of s.data.spells) {
    if (
      stricmp(short, spell.short) === 0 &&
      ((spell.flags & SpellFlag.Known) !== 0 || s.spellbookNames.has(spell.name.toLowerCase())) &&
      castable(s, spell) !== 0
    )
      return spell;
  }
  for (const spell of s.data.spells) {
    if (spell.magic !== 0 && stricmp(short, spell.short) === 0 && castable(s, spell) !== 0)
      return spell;
  }
  for (const spell of s.data.spells) {
    if (stricmp(short, spell.short) === 0 && castable(s, spell) !== 0) return spell;
  }
  return null;
}

/** `0x4a32b0`: the character's level is enough, and its magic suits (`0x4a32f0`). */
export function castable(s: Session, spell: SpellRec): number {
  if (s.Player_Level !== 0 && spell.level !== 0) {
    if (s.Player_Level < spell.level) return 0;
    return magicSuits(s, spell);
  }
  return 1;
}

/** `0x4a32f0`: the spell's magic is within the character's class's range. */
function magicSuits(s: Session, spell: SpellRec): number {
  if (s.Player_Class === 0 || spell.magic === 0) return 1;
  const cls = findClass(s.data, s.Player_Class);
  let low: number;
  let high: number;
  const m = spell.magic;
  if (!cls) {
    switch (s.Player_Class) {
      case 3:
        [low, high] = [1, 1];
        break;
      case 4:
      case 6:
        [low, high] = [1, 2];
        break;
      case 5:
        [low, high] = [1, 3];
        break;
      case 9:
        return m === 10 || m === 0xc || m === 0xd ? 1 : 0;
      case 10:
      case 0xb:
        [low, high] = [4, 5];
        break;
      case 0xc:
        [low, high] = [4, 6];
        break;
      case 0xd:
        [low, high] = [7, 9];
        break;
      case 0xe:
        [low, high] = [7, 7];
        break;
      case 0xf:
        [low, high] = [0xb, 0xb];
        break;
      default:
        [low, high] = [0, 0];
    }
  } else {
    const level = cls.magic & 0xff;
    switch (cls.magic >> 8) {
      case 1:
        [low, high] = [4, level + 3];
        break;
      case 2:
        [low, high] = [1, level];
        break;
      case 3:
        [low, high] = [7, level + 6];
        break;
      case 4:
        if (m === 10) return 1;
        if (level > 2 && m === 0xc) return 1;
        if (level < 4) return 0;
        return m === 0xd ? 1 : 0;
      case 5:
        [low, high] = [0xb, 0xb];
        break;
      default:
        [low, high] = [0, 0];
    }
  }
  return low <= m && m <= high ? 1 : 0;
}

/** `0x4a24e0`: the spell this character can cast whose full name is `name`. */
export function findSpellByName(s: Session, name: string): SpellRec | null {
  for (const spell of s.data.spells) {
    if (castable(s, spell) !== 0 && stricmp(name, spell.name) === 0) return spell;
  }
  return null;
}

/** The configured spell a cast state casts. */
export function stateSpell(s: Session, state: number): SpellRec | null {
  const short: Record<number, string> = {
    9: s.Combat_PreMultAttack,
    0xa: s.Combat_MultAttack,
    0xb: s.Combat_PreAttack,
    0xc: s.Combat_AttackSpl2,
    0xd: s.Combat_AttackSpl,
    0xe: s.altSpell,
    0xf: s.userSpell
  };
  const name = short[state];
  return name ? findSpell(s, name) : null;
}

/** The spells the message table files a line under, by the table: so a line is looked up once. */
const filed = new WeakMap<readonly MessageRec[], Set<string>>();

function hasOwnLine(s: Session, name: string): boolean {
  const rows = s.data.messages ?? [];
  let names = filed.get(rows);
  if (names === undefined) {
    names = new Set(rows.map((row) => row.name.toLowerCase()));
    filed.set(rows, names);
  }
  return names.has(name.toLowerCase());
}

/**
 * Whether a damage line the message table files under the spell `named` is
 * the spell `cast` landing: by name, as megamud.exe matches it, or where
 * `named` is a spell this character does not know and `cast` has no line of
 * its own in the table (asked for 2026-10-21). The realm's table writes a
 * line once, under one spell, where several spells share it: mudrev's
 * lucifer's touch drains with deathtouch's "Dark energy drains {target} of
 * life for {dmg} damage!", and Skinny's every `ltch` read as somebody's
 * deathtouch, until his main attack spell was given up for the fight as
 * never seen and the Demon Trolloc, which his weapon could not hurt, was left
 * to Fatty.
 */
export function landsAs(s: Session, named: string, cast: string): boolean {
  if (named === '' || cast === '') return false;
  if (stricmp(named, cast) === 0) return true;
  if (hasOwnLine(s, cast)) return false;
  let spell = false;
  for (const rec of s.data.spells) {
    if (stricmp(rec.name, named) !== 0) continue;
    spell = true;
    if ((rec.flags & SpellFlag.Known) !== 0 || s.spellbookNames.has(rec.name.toLowerCase()))
      return false;
  }
  return spell;
}
