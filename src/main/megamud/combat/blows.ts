/**
 * Blows aimed at this character or the party (`0x428e60`): `The orc slashes
 * you for 12 damage!`, `A rat bites at you!`, `X casts …`. Read 2026-10-12.
 *
 * This is how MegaMUD learns who is fighting it: the attacker is named from
 * the line (before the verb, or the Messages.md row's `{source}`), found in
 * the room (or added, when it cannot see), marked as attacking (`0x11`) and
 * hostile, and an unknown monster becomes an enemy for good. Damage taken
 * comes off HP at once, and off a party member's when the target is one.
 */
import { atoi, indexOf, stricmp, trimSpaces } from '../cstr';
import { checkNames, findMonster, partyIndex } from '../room/checkNames';
import { prioritize } from '../room/alsoHere';
import { addEntity, findEntity, newMonsterEntity } from '../room/entities';
import { escapeCheck } from '../script/escape';
import { setState } from '../script/state';
import { ARENA, type RoomEntity, type Session } from '../Session';
import { partyRefresh } from '../party/members';
import { pvpAttack } from './events';
import { areaDamage } from './hits';
import { roundEvent, RoundEvent } from './timer';
import { State } from '../states';
import { LineFlag, PartyFlag, EntityFlag, EntityType, Darkness, Stance } from '../flags';

/** The verbs a blow is struck with (the table at `0x5603e0`). */
const VERBS = [
  'attempts',
  'bites',
  'bludgeons',
  'breathes',
  'burned',
  'butts',
  'charges',
  'chills',
  'chokes',
  'chomps',
  'chops',
  'circles',
  'claws',
  'cleaves',
  'clubs',
  'crushes',
  'darts',
  'dices',
  'fires',
  'flails',
  'goes',
  'gouges',
  'grabs',
  'guts',
  'hacks',
  'hits',
  'hurls',
  'impales',
  'kicks',
  'lashes',
  'leaps',
  'lunges',
  'mauls',
  'oozes',
  'picks',
  'pounces',
  'pounds',
  'pummels',
  'punches',
  'rakes',
  'rams',
  'reaches',
  'rips',
  'saps',
  'sears',
  'shield-rushes',
  'shocked',
  'shoots',
  'skewers',
  'slams',
  'slaps',
  'slashes',
  'slices',
  'smacks',
  'smashes',
  'snaps',
  'spins',
  'sprays',
  'stabs',
  'stings',
  'stomps',
  'strikes',
  'swings',
  'swipes',
  'swoops',
  'swung',
  'tears',
  'throws',
  'thrusts',
  'touches',
  'tramples',
  'whacks',
  'whaps',
  'whips',
  'whomps'
];

/** The adverbs an attacker's name is cut at ("The orc savagely …"). */
const ADVERBS = [
  'all-out',
  'critically',
  'savagely',
  'surprise',
  'viciously',
  'skillfully',
  'quickly'
];

/** The damage number before ` damage` (the digits just before it). */
function damageIn(line: string): number {
  let at = indexOf(line, ' damage');
  if (at === -1 || indexOf(line, ' healing ') !== -1) return -1;
  let i = at;
  do {
    at = i;
    i = at - 1;
    if (i < 1) return atoi(line.slice(Math.max(i, 0)));
  } while (!/[0-9]/.test(line[i]!));
  while (i > 0 && /[0-9]/.test(line[i - 1] ?? '')) i -= 1;
  return atoi(line.slice(i));
}

/** `0x428e60`. 1 when the line was a blow at this character (or the party). */
export function blowLine(s: Session, line: string): number {
  const colour = s.line.attr[0];
  if (colour !== 9 && colour !== 0xc && colour !== 6) return 0;
  if (areaDamage(line) !== 0) return 0;
  if (indexOf(line, ' looking at you') !== -1) return 0;
  let damage = 0;
  let hasDamage = false;
  const parsed = damageIn(line);
  if (parsed !== -1) {
    s.lineFlags |= LineFlag.FightLineSeen;
    hasDamage = true;
    damage = parsed;
  }
  let atMe = false;
  let isBlow = hasDamage;
  if (s.msgSpell !== '') {
    if (stricmp(s.msgTarget, 'you') === 0 || stricmp(s.msgTarget, 'your') === 0) atMe = true;
    if (s.msgDamage !== 0) {
      isBlow = true;
      damage = s.msgDamage;
    }
  }
  let attacker = '';
  const you = indexOf(line, ' you');
  const aimedAtYou =
    you !== -1 &&
    line[you + 4] !== 'n' &&
    (!line.startsWith(' your', you) || (areaDamage(line) === 0 && damage !== 0));
  let findVerb = false;
  if (aimedAtYou) {
    atMe = true;
    findVerb = true;
  } else if (indexOf(line, 'You are ') === -1 && indexOf(line, 'You take ') === -1) {
    if (damage === 0) {
      findVerb = atMe;
    } else {
      // A blow at somebody else: a party member's HP drops by it.
      let target = '';
      if (s.msgSpell === '') {
        const forAt = indexOf(line, ' for ');
        if (forAt !== -1) {
          let start = forAt - 1;
          while (start > 0 && line[start - 1] !== ' ') start -= 1;
          target = line.slice(start, start + 10).split(' ')[0] ?? '';
        }
      } else {
        target = s.msgTarget.slice(0, 99);
      }
      const member = target === '' ? -1 : partyIndex(s, target);
      if (member === -1) {
        findVerb = true;
      } else {
        const m = s.party[member]!;
        if (m.maxHp > 0) {
          m.hp -= damage;
          m.flags28 |= PartyFlag.ChangedSinceListing;
        }
        partyRefresh(s, 1);
        findVerb = true;
        attacker = '';
      }
    }
  } else if (damage !== 0) {
    atMe = true;
    findVerb = true;
  } else if (!atMe) {
    findVerb = false;
  } else {
    findVerb = true;
  }
  if (findVerb && attacker === '') {
    let space = line.indexOf(' ');
    while (space !== -1 && space < line.length) {
      const verb = VERBS.find(
        (v) => line.startsWith(v, space + 1) && line[space + 1 + v.length] === ' '
      );
      if (verb) {
        attacker = line.slice(0, Math.min(space, 99));
        isBlow = true;
        break;
      }
      let next = space;
      while (line[next] === ' ') next += 1;
      space = line.indexOf(' ', next);
    }
  }
  if (s.msgSpell !== '' && s.msgSource !== '') attacker = s.msgSource.slice(0, 99);
  if (attacker === '' && atMe && hasDamage) {
    const casts = indexOf(line, ' casts ');
    if (casts !== -1) {
      attacker = line.slice(0, Math.min(casts, 99));
      isBlow = true;
    }
  }
  if (attacker.startsWith('The ')) attacker = attacker.slice(4);
  for (const adverb of ADVERBS) {
    const at = indexOf(attacker, adverb);
    if (at > 0) attacker = attacker.slice(0, at - 1);
  }
  attacker = matchRoomName(s, attacker);
  attacker = trimSpaces(attacker);
  if (!atMe) {
    if (attacker === '' || attacker.length > 0x1e || stricmp(attacker, 'you') === 0) return 0;
  }
  if (indexOf(line, ' healing ') !== -1 || !isBlow || !atMe) return 0;
  return struck(s, line, attacker, damage);
}

/**
 * The attacker's name as the room lists it: an exact name, else the room's
 * name that starts the text.
 */
function matchRoomName(s: Session, name: string): string {
  for (const e of s.room) if (e.type !== EntityType.Item && e.name === name) return name;
  for (const e of s.room) {
    if (e.type !== EntityType.Item && name.startsWith(e.name)) return e.name;
  }
  return name;
}

/** The part of `0x428e60` after the attacker is known: a blow at this character. */
function struck(s: Session, line: string, name: string, damage: number): number {
  if (damage !== 0) {
    s.hp -= damage;
    if (s.partySize !== 0) partyRefresh(s, 1);
  }
  s.sneaking = 0;
  s.hidden = 0;
  s.roundBlowSeen = 1;
  roundEvent(s, RoundEvent.Combat);
  const blind = s.blind !== 0 || s.darkness > Darkness.Dim;
  let e: RoomEntity | null = findEntity(s, name, 0);
  if (!e) {
    for (const x of s.room) {
      if (x.type === EntityType.Item) continue;
      if (x.type === EntityType.Player || x.player) {
        if (line.startsWith(x.name)) {
          const after = line[x.name.length];
          if (after === undefined || after === ' ' || after === '.' || after === ',') {
            name = x.name;
            e = x;
            break;
          }
        }
      } else if (indexOf(line, x.name) !== -1) {
        name = x.name;
        e = x;
        break;
      }
    }
  }
  if (
    e &&
    e.type === EntityType.Player &&
    e.kind !== Stance.Enemy &&
    e.kind !== Stance.Flee &&
    e.kind !== Stance.Hangup &&
    damage === 0 &&
    s.roomSignature !== ARENA
  ) {
    return 1;
  }
  s.lineFlags |= LineFlag.FightLineSeen;
  if (s.debug !== 0 && s.combatOffExpected !== 0) s.host.trace('{I5-}');
  s.combatOffExpected = 0;
  s.blowSeenAt = s.now;
  if (!e) {
    let added: RoomEntity | null = null;
    if (name !== '' && blind) {
      added = newMonsterEntity(s, name);
      if (added) s.attackDue = 1;
    }
    if (!added && name !== '' && damage !== 0 && s.roomSignature === ARENA) {
      added = addEntity(s);
      added.name = name.slice(0, 30);
      added.kind = Stance.Enemy;
    }
    if (added) {
      added.flags |= EntityFlag.Kept | EntityFlag.Fought;
    } else if (
      s.blind === 0 &&
      s.darkness < Darkness.Dark &&
      (s.runCount === 0 || s.following === 1 || s.held === 1)
    ) {
      if (name === '' && s.msgSpell !== '') {
        // A spell from someone unnamed: just read the room again below.
      } else if (
        s.dontAttackHere !== 0 &&
        (name === '' || !s.whoList.some((w) => name.startsWith(w.name)))
      ) {
        return 1;
      }
      if (!(name === '' && s.msgSpell !== '')) {
        s.lookDue = 1;
        if (s.inCombat === 0) setState(s, State.Nothing);
      }
    }
  } else {
    if (e.kind !== Stance.Enemy && e.kind !== Stance.Flee && e.kind !== Stance.Hangup)
      e.kind = Stance.Enemy;
    if (blind && s.inCombat === 0) s.attackDue = 1;
    e.flags |= EntityFlag.Kept | EntityFlag.Fought;
  }
  checkNames(s);
  if (name !== '') {
    const x = findEntity(s, name, 0);
    if (x && x.type === EntityType.Monster) {
      x.mon ??= findMonster(s, x.name);
      if (x.mon && x.mon.relationship === Stance.Unknown) {
        x.kind = Stance.Enemy;
        x.mon.relationship = Stance.Enemy;
        s.monstersChanged = 1;
        s.host.show(`[${x.name} marked as enemy]`);
      }
    }
  }
  prioritize(s);
  if (name !== '') {
    const x = findEntity(s, name, 0);
    if (x?.player) pvpAttack(s, name, 1);
  }
  escapeCheck(s, 'incoming attack');
  return 1;
}
