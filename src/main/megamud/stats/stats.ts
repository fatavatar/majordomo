/**
 * `0x494e70`: the `stat` display, read 2026-10-12. Each line is read by its
 * columns: name, surname, lives and CPs; race and experience; class and
 * level; HP and armour class; mana (or kai); the abilities. The name line
 * starts a fresh reading: every condition and blessing is taken as gone (the
 * display would show them). The last line (wisdom) brings this character's
 * own player record up to date.
 */
import { atoi, indexOf, leadingNumber, splitWord, trimSpaces } from '../cstr';
import { findClassByName, findRaceByName } from '../data';
import { findPlayer } from '../room/checkNames';
import type { Session } from '../Session';

/** `0x4ad430` at column `at`: the number there, and the text after it. */
function numberAt(line: string, at: number): [number, string] {
  const text = line.slice(at);
  const [n, end] = leadingNumber(text);
  return [n, text.slice(end)];
}

/** `0x4ad430` twice, across a `/` (`500/600`). */
function pairAt(line: string, at: number): [number, number] {
  const [a, rest] = numberAt(line, at);
  return [a, atoi(rest.replace(/^\/+/, ''))];
}

/** The name line: a fresh reading. */
function nameLine(s: Session, line: string): void {
  const [name, rest] = splitWord(line.slice(6), ' ', 100);
  if (name !== s.Player_Name) {
    s.Player_Name = name.slice(0, 10);
    s.f_e240 = 1;
  }
  const start = line.length - rest.length;
  let surname = trimSpaces(line.slice(start, Math.max(start, 0x26)).slice(0, 18));
  if (surname.startsWith('Lives/CP:')) surname = '';
  s.Player_Surname = surname;
  const [lives, cps] = pairAt(line.slice(0x30).replace(/^ +/, ''), 0);
  s.Player_Lives = lives;
  s.Player_CPs = cps;
  s.f_32378 = s.now;
  s.blind = 0;
  s.confused = 0;
  s.poisoned = 0;
  s.f_e1f8 = 0;
  s.diseased = 0;
  s.losingHp = 0;
  s.held = 0;
  s.f_e218 = 0;
  s.hpRegen = 0;
  for (let i = 0; i < 10; i += 1) s.blessCastAt[i] = 0;
  s.restUntilOff = 0;
  for (const rec of s.data.messages ?? []) rec.flags &= ~3;
  s.host.blessingsCleared?.();
}

/** The wisdom line: this character's player record, kept to what `stat` shows. */
function updateRecord(s: Session): void {
  const p = findPlayer(s, s.Player_Name);
  if (!p) return;
  const next = {
    surname: s.Player_Surname.slice(0, 18),
    flags: p.flags & ~3,
    race: s.Player_Race,
    cls: s.Player_Class,
    level: s.Player_Level,
    exp: s.exp,
    f74: 0
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => p[k] !== next[k]);
  if (!changed) return;
  Object.assign(p, next);
  s.f_e24c = 1;
}

export function statLine(s: Session, line: string): number {
  if (s.inGame === 0 || line.length < 0x39) return 0;
  if (s.state === 0x20 || s.f_e2a0 !== 0) return 0;
  if (indexOf(line, 'Name: ') === 0 && indexOf(line, 'Lives/CP:') !== -1) {
    nameLine(s, line);
    return 1;
  }
  if (indexOf(line, 'Race: ') === 0) {
    const race = findRaceByName(s.data, trimSpaces(line.slice(6, 6 + 12)));
    s.Player_Race = race ? race.id : 0;
    s.exp = Number(/^ *(-?[0-9]*)/.exec(line.slice(0x17))![1] || 0);
    s.Player_Perception = numberAt(line, 0x34)[0];
    return 1;
  }
  if (indexOf(line, 'Class: ') === 0) {
    const [name] = splitWord(line.slice(7), ' ', 100);
    const cls = findClassByName(s.data, name);
    s.Player_Class = cls ? cls.id : 0;
    s.Player_Level = numberAt(line, 0x19)[0];
    s.Player_Stealth = numberAt(line, 0x34)[0];
    return 1;
  }
  if (indexOf(line, 'Hits: ') === 0) {
    [s.hp, s.Player_MaxHP] = pairAt(line, 6);
    [s.armourClass, s.damageResist] = pairAt(line, 0x1f);
    s.Player_Thievery = numberAt(line, 0x34)[0];
    return 1;
  }
  if (indexOf(line, 'Traps: ') === 0x27) {
    let [mana, max] = pairAt(line, 7);
    if (max <= mana) mana = max;
    s.mana = mana;
    s.Player_MaxMana = max;
    s.Player_SpellCasting = numberAt(line, 0x1f)[0];
    s.Player_Traps = numberAt(line, 0x34)[0];
    return 1;
  }
  if (indexOf(line, 'Picklocks: ') === 0x27) {
    s.Player_Picklocks = numberAt(line, 0x34)[0];
    return 1;
  }
  if (indexOf(line, 'Strength: ') === 0) {
    s.Player_Strength = numberAt(line, 10)[0];
    s.Player_Agility = numberAt(line, 0x1a)[0];
    s.Player_Tracking = numberAt(line, 0x34)[0];
    return 1;
  }
  if (indexOf(line, 'Intellect: ') === 0) {
    s.Player_Intellect = numberAt(line, 10)[0];
    s.Player_Health = numberAt(line, 0x1a)[0];
    s.Player_MartialArts = numberAt(line, 0x34)[0];
    return 1;
  }
  if (indexOf(line, 'Wisdom: ') !== 0 && indexOf(line, 'Willpower: ') !== 0) return 0;
  s.Player_Wisdom = numberAt(line, 10)[0];
  s.Player_Charm = numberAt(line, 0x1a)[0];
  s.Player_MagicRes = numberAt(line, 0x34)[0];
  updateRecord(s);
  return 1;
}
