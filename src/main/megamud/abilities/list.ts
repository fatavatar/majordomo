/**
 * `0x4056d0`: `User abilities: 1(5) 32(1) …` (a MUD op's view of a
 * character's abilities), read 2026-10-12: each ability shown by MegaMUD's
 * name for it, then a summary of the realm's quests, worked out from the
 * quest abilities' values (125–134, 32, 57, 186, 187). Display only.
 */
import type { Session } from '../Session';
import { ABILITY_NAMES } from './names';

/** A quest's step: its text when the value is listed, else `fallback` (the buffer as it was). */
type Steps = Record<number, string>;

const MOD1_GOOD: Steps = {
  1: 'need to speak with Guildmaster',
  2: 'need to accept mission',
  3: 'need to speak with Chancellor Annora',
  4: 'need to speak with Commander Markus',
  5: 'need to return to Chancellor Annora'
};
const MOD1_NEUTRAL: Steps = {
  1: 'need to speak with Jorah',
  2: 'need to speak with Grey Lord',
  3: 'need to speak with Commander Markus',
  4: 'need to return box to Grey Lord',
  5: 'need to return box to Chancellor Annora',
  6: 'need to return to Grey Lord'
};
const MOD1_EVIL: Steps = {
  1: 'need to speak with Balthazar',
  2: 'need to return head to Balthazar'
};
const MOD2_GOOD: Steps = {
  6: 'need to speak with Chancellor Annora',
  7: 'need to kill Goru-Nezar'
};
const MOD4_GOOD: Steps = {
  8: 'need to speak with Chancellor Annora',
  9: 'need to speak with King Kulgar',
  10: 'need to speak with Loremaster',
  11: 'need to get gleaming dagger',
  12: 'need to get enchanted dagger',
  13: 'need to kill spectral knight',
  14: 'need to kill Gulgluthra',
  15: 'need to return to King Kulgar',
  16: 'need to return to Chancellor Annora'
};
const MOD4_NEUTRAL: Steps = {
  8: 'need to pray at shrine',
  9: 'need to return items to shrine',
  10: 'need to return to Grey Lord'
};
const MOD4_EVIL: Steps = {
  4: 'need to speak with Balthazar',
  5: 'need to give crown to shifty dwarf',
  6: 'need to harvest mushrooms',
  7: 'need to give mushrooms/retchweed to Duegar Lord',
  8: 'need to transport to kitchen',
  9: "need to poison the King's food",
  10: 'need to return to Duegar Lord',
  11: 'need to return to Balthazar'
};
const MOD5: Steps = {
  [-1]: 'need to speak with old man',
  0: 'need to speak with old man',
  1: 'need to kill dread mystic',
  2: 'need to kill smuggler boss',
  3: 'need to speak with Orfeo Tailspinner',
  4: 'need to find Morukai',
  5: 'need to return ingredients to Morukai',
  6: 'need to get glowing quartz rod',
  7: 'need to return egg to Morukai',
  8: 'need to release Phoenix'
};
const MOD6: Steps = {
  [-1]: 'need to speak with elder nekojin',
  0: 'need to speak with elder nekojin',
  1: 'need to speak with seargent',
  2: 'need to speak with Tolgard and Meia',
  3: 'need to return to Tolgard',
  4: 'need to speak with Seeress',
  5: 'need to read blue book in palace library',
  6: 'need to read red book in palace library',
  7: 'need to return to Seeress',
  8: 'need to help withered old man',
  9: 'need to kill Pharoah',
  10: 'need to kill Dao Lord',
  11: 'need to speak with Orfeo'
};
const MOD7_GOOD: Steps = {
  17: 'need to kill dark phoenix',
  18: 'need to return to Chancellor Annora'
};
const MOD7_NEUTRAL: Steps = {
  11: 'need to kill dark phoenix',
  12: 'need to return to Grey Lord'
};
const MOD7_EVIL: Steps = {
  12: 'need to kill dark phoenix',
  13: 'need to return to Balthazar'
};

export function abilitiesListLine(s: Session, line: string): number {
  if (!line.startsWith('User abilities: ')) return 0;
  const v: number[] = Array.from({ length: 0xbc }, () => -1);
  const show = (text: string): void => s.host.show(text);
  show('');
  let rest = line.slice(0x10);
  // The last ability's line stays in the buffer an unlisted quest step shows (a quirk).
  let buffer = '';
  while (rest !== '') {
    rest = rest.replace(/^ +/, '');
    const m = /^(\d*)\((\d*)\)/.exec(rest);
    if (!m) break;
    const id = Number(m[1] || 0);
    const value = Number(m[2] || 0);
    rest = rest.slice(m[0].length);
    buffer = `Ability ${String(id).padStart(3)}(${value}):     `.slice(0, 0x12);
    buffer += id < 0xbc ? ABILITY_NAMES[id]! : 'Unknown ability';
    show(buffer);
    if (id < 0xbc) v[id] = value;
  }
  const step = (steps: Steps, n: number): string => {
    buffer = steps[n] ?? buffer;
    return buffer;
  };
  const done = (n: number): string => (n > 0 ? 'done' : 'not yet done');
  const doneFrom0 = (n: number): string => (n < 0 ? 'not yet done' : 'done');
  const good = v[126]!;
  const neutral = v[127]!;
  const evil = v[128]!;
  show('');
  show('Quest Summary');
  show('-------------');
  show(`Ice Sorceress throne quest ${done(v[125]!)}.`);
  show(`High Druid gem quest ${done(v[129]!)}.`);
  show(`Champion of Blood altar quest ${done(v[130]!)}.`);
  show(`Adult She-dragon ruby quest ${done(v[131]!)}.`);
  show(`Gaunt one's level 15 quest (see hidden) ${doneFrom0(v[57]!)}.`);
  show(`Aldreth orc head quest (smash) ${doneFrom0(v[32]!)}.`);
  show(`Master assassin trap quest (super stealth) ${doneFrom0(v[186]!)}.`);
  show(`Dhelvanen black diamond quest (meditate) ${doneFrom0(v[187]!)}.`);

  const none = good < 1 && neutral < 1 && evil < 1;
  if (good >= 1) {
    if (good > 5) show('MOD 1 good quest done.');
    else show(`MOD 1 good quest incomplete (${step(MOD1_GOOD, good)}).`);
  } else if (none) {
    show('MOD 1 alignment quest not yet started.');
  }
  if (neutral >= 1) {
    if (neutral > 6) show('MOD 1 neutral quest done.');
    else show(`MOD 1 neutral quest incomplete (${step(MOD1_NEUTRAL, neutral)}).`);
  }
  if (evil > 0) {
    if (evil < 3) show(`MOD 1 evil quest incomplete (${step(MOD1_EVIL, evil)}).`);
    else show('MOD 1 evil quest done.');
  }

  if (none) show('MOD 2 alignment quest not yet possible.');
  if (good < 6) {
    if (good > 0) show('MOD 2 good quest not yet possible.');
  } else if (good < 8) {
    show(`MOD 2 good quest incomplete (${step(MOD2_GOOD, good)}).`);
  } else {
    show('MOD 2 good quest done.');
  }
  if (neutral < 7) {
    if (neutral > 0) show('MOD 2 neutral quest not yet possible.');
  } else {
    show(
      neutral > 7
        ? 'MOD 2 neutral quest done.'
        : 'MOD 2 neutral quest incomplete (return eye of beholder).'
    );
  }
  if (evil < 3) {
    if (evil > 0) show('MOD 2 evil quest not yet possible.');
  } else {
    show(
      evil > 3
        ? 'MOD 2 evil quest done.'
        : 'MOD 2 evil quest incomplete (return elf-lord head & 10 elf heads).'
    );
  }

  show(`MOD 3 wererat contraption quest ${v[132] === 1 ? 'done' : 'not yet done'}.`);

  if (none) show('MOD 4 alignment quest not yet possible.');
  if (good < 8) {
    if (good > 0) show('MOD 4 good quest not yet possible.');
  } else if (good > 0x10) {
    show('MOD 4 good quest done.');
  } else {
    show(`MOD 4 good quest incomplete (${step(MOD4_GOOD, good)}).`);
  }
  if (neutral < 8) {
    if (neutral > 0) show('MOD 4 neutral quest not yet possible.');
  } else if (neutral < 0xb) {
    show(`MOD 4 neutral quest incomplete (${step(MOD4_NEUTRAL, neutral)}).`);
  } else {
    show('MOD 4 neutral quest done.');
  }
  if (evil < 4) {
    if (evil > 0) show('MOD 4 evil quest not yet possible.');
  } else if (evil > 0xb) {
    show('MOD 4 evil quest done.');
  } else {
    show(`MOD 4 evil quest incomplete (${step(MOD4_EVIL, evil)}).`);
  }

  if (v[133] === 9) show('MOD 5 low-level quest done.');
  else show(`MOD 5 low-level quest incomplete (${step(MOD5, v[133]!)}).`);
  if (v[134] === 0xc) show('MOD 6 desert quest done.');
  else show(`MOD 6 desert quest incomplete (${step(MOD6, v[134]!)}).`);

  if (none) show('MOD 7 alignment quest not yet possible.');
  if (good < 0x11) {
    if (good > 0) show('MOD 7 good quest not yet possible.');
  } else if (good < 0x13) {
    show(`MOD 7 good quest incomplete (${step(MOD7_GOOD, good)}).`);
  } else {
    show('MOD 7 good quest done.');
  }
  if (neutral < 0xb) {
    if (neutral > 0) show('MOD 7 neutral quest not yet possible.');
  } else if (neutral < 0xd) {
    show(`MOD 7 neutral quest incomplete (${step(MOD7_NEUTRAL, neutral)}).`);
  } else {
    show('MOD 7 neutral quest done.');
  }
  if (evil < 0xc) {
    if (evil > 0) show('MOD 7 evil quest not yet possible.');
  } else if (evil > 0xd) {
    show('MOD 7 evil quest done.');
  } else {
    show(`MOD 7 evil quest incomplete (${step(MOD7_EVIL, evil)}).`);
  }
  return 1;
}
