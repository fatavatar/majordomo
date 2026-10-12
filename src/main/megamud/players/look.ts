/**
 * `0x489f50`: looking at a player, read 2026-10-12. `[ Name ]` selects the
 * player looked at; its description gives its race and class, and the words
 * that suggest its build (the tables at `0x562da0`–`0x563008`); a `shadowy
 * figure` is marked; and one with no race to it is no player at all but a
 * monster, learned as one. `You do not see …` ends it (and an invited party
 * member not here is out of step). The equipment it shows (`is equipped
 * with:`) is Players.md's alone, kept by the app.
 */
import { newMonster } from '../data';
import { trimSpaces } from '../cstr';
import {
  findItem,
  findMonster,
  findPlayer,
  markPlayers,
  partyIndex,
  stripAdjective
} from '../room/checkNames';
import { addEntity } from '../room/entities';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';

type Trait = 'health' | 'strength' | 'agility' | 'intellect' | 'wisdom' | 'charm';

/** Each trait's words, and the level each stands for. */
const TRAITS: [Trait, [number, string][]][] = [
  [
    'health',
    [
      [1, 'sickly'],
      [30, 'frail'],
      [40, 'thin'],
      [50, 'healthy'],
      [60, 'stout'],
      [70, 'solid'],
      [80, 'massive'],
      [90, 'gigantic'],
      [100, 'colossal']
    ]
  ],
  [
    'strength',
    [
      [1, 'puny'],
      [30, 'weak'],
      [40, 'slightly built'],
      [50, 'moderately built'],
      [60, 'well built'],
      [70, 'muscular'],
      [80, 'powerfully built'],
      [90, 'heroically'],
      [100, 'Herculean'],
      [110, 'physically']
    ]
  ],
  [
    'agility',
    [
      [1, 'slowly'],
      [30, 'clumsily'],
      [40, 'slugishly'],
      [50, 'cautiously'],
      [60, 'gracefully'],
      [70, 'swiftly'],
      [80, 'uncanny'],
      [90, 'catlike'],
      [100, 'blindingly']
    ]
  ],
  [
    'charm',
    [
      [1, 'revolting'],
      [30, 'unappealing'],
      [40, 'unfriendly'],
      [50, 'likable'],
      [60, 'attractive'],
      [70, 'outgoing'],
      [80, 'radiates'],
      [90, 'incredibly'],
      [100, 'overwhelmingly']
    ]
  ],
  [
    'intellect',
    [
      [1, 'moronic'],
      [30, 'stupid'],
      [40, 'dull'],
      [50, 'intelligent'],
      [60, 'bright'],
      [70, 'clever'],
      [80, 'brilliant'],
      [90, 'genius'],
      [100, 'all-knowing']
    ]
  ],
  [
    'wisdom',
    [
      [1, 'selfish'],
      [30, 'sullen'],
      [40, 'naive'],
      [50, 'knowledgeable'],
      [60, 'experienced'],
      [70, 'wordly'],
      [80, 'possess'],
      [90, 'enlightened'],
      [100, 'Gods']
    ]
  ]
];

function notHere(s: Session, line: string, at: number): number {
  s.lineFlags &= ~0x8c000;
  forgetAwaited(s, s.state);
  setState(s, 0);
  let end = line.indexOf(' here', at + 0xf);
  if (end === -1) end = line.length;
  const name = line.slice(at + 0xf, at + 0xf + Math.min(end - at - 0xf, 10));
  const i = partyIndex(s, name);
  if (i !== -1) {
    const m = s.party[i]!;
    if ((m.flags28 & 4) !== 0) {
      m.flags28 &= ~4;
      m.flags28 |= s.whoList.some((w) => w.name === name) ? 8 : 0x80;
    }
  }
  s.f_e290 = 1;
  return 1;
}

/** `[ Name ]`: the player looked at (this character too). */
function select(s: Session, line: string): void {
  const name = line.slice(2).trim().split(' ')[0]!;
  const i = s.room.findIndex((e) => e.type === 1 && e.name === name);
  if (i !== -1) {
    s.roomSelected = i;
    s.lineFlags = (s.lineFlags & ~0x8001) | 0x80000;
    return;
  }
  if (name === s.Player_Name) {
    const e = addEntity(s);
    e.name = s.Player_Name.slice(0, 30);
    e.type = 1;
    e.kind = 2;
    e.player = findPlayer(s, s.Player_Name);
    s.roomSelected = s.room.length - 1;
    s.lineFlags = (s.lineFlags & ~0x8001) | 0x80000;
  }
}

export function lookLine(s: Session, line: string): number {
  const notSee = line.indexOf('You do not see ');
  if (notSee !== -1) return notHere(s, line, notSee);
  if (line.startsWith('[ ')) select(s, line);
  if ((s.lineFlags & 0x80000) === 0) {
    s.lineFlags &= ~0xc000;
    return 0;
  }
  const e = s.room[s.roomSelected];
  const p = e && e.type === 1 ? e.player : null;
  if (!e || !p) {
    s.roomSelected = -1;
    s.lineFlags &= ~0x8c000;
    return 0;
  }
  if (line.includes('shadowy figure')) {
    s.lineFlags &= ~0x8c000;
    markPlayers(s, e.name, 2);
    return 1;
  }
  if (line !== '' && (s.lineFlags & 1) === 0) s.lineFlags |= 0x4000;
  if ((s.lineFlags & 1) !== 0) {
    // The description is over: one with no race is a monster after all.
    if (
      p.race === 0 &&
      (s.lineFlags & 0x4000) !== 0 &&
      (p.flags & 4) === 0 &&
      (e.flags & 2) === 0
    ) {
      const players = s.data.players ?? [];
      const at = players.indexOf(p);
      if (at !== -1) {
        players.splice(at, 1);
        s.f_e24c = 1;
      }
      e.type = 2;
      e.kind = 4;
      e.player = null;
      e.mon = findMonster(s, e.name);
      if (!e.mon) {
        const mon = newMonster(s.data);
        mon.name = stripAdjective(e.name).slice(0, 30);
        mon.relationship = 4;
        mon.flags |= 2;
        e.mon = mon;
        s.host.show(`[${mon.name} added to known monsters]`);
        s.f_e254 = 1;
      }
    }
    s.lineFlags &= ~0x8c000;
    s.roomSelected = -1;
    forgetAwaited(s, 0x20);
    setState(s, 0);
    return 1;
  }
  const seen: Partial<Record<Trait, number>> = {};
  for (const [trait, words] of TRAITS) {
    const word = words.find(([, w]) => line.includes(w));
    if (word) seen[trait] = word[0];
  }
  if (Object.keys(seen).length > 0) {
    p.flags |= 0x20000;
    p.greetedAt = s.now;
    s.f_e24c = 1;
    p.traits = {
      health: 0,
      strength: 0,
      agility: 0,
      intellect: 0,
      wisdom: 0,
      charm: 0,
      ...p.traits,
      ...seen
    };
  }
  for (const race of s.data.races ?? []) {
    const at = line.indexOf(` ${race.name} `);
    if (at === -1) continue;
    if (p.race !== race.id) {
      p.race = race.id;
      s.f_e24c = 1;
    }
    const after = line.slice(at + race.name.length + 2);
    const cls = (s.data.classes ?? []).find((c) => after.startsWith(c.name));
    if (cls && p.cls !== cls.id) {
      p.cls = cls.id;
      s.f_e24c = 1;
    }
    return 1;
  }
  if ((s.lineFlags & 0x8000) === 0) {
    if (!line.includes(' is equipped with:')) return 0;
    s.lineFlags |= 0x8000;
    return 1;
  }
  // One item of what it is equipped with (recorded in Players.md by the app): known items only.
  if (s.line.attr[0] !== 2) return 0;
  return findItem(s, trimSpaces(line.slice(0, 99).split('(')[0]!)) ? 1 : 0;
}
