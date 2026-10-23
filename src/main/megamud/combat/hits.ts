/**
 * This character's own blows and spells landing (`0x429bb0`): damage dealt,
 * misses, backstabs and their surprise, and what a hit says about immunity.
 * Read 2026-10-12. Of the tallies it keeps for MegaMUD's statistics window,
 * the rungs' (`0x426ef0`, `0x426f70`) are counted (`stats/window.ts`); the
 * hit, miss, crit and backstab ones (`0x32540`–`0x32584`) are what the
 * stream counts already.
 *
 * Only lines drawn in the colours the server uses for combat (`\t`, `\f`, 6,
 * `\v`) are read, and only while fighting or casting at a monster.
 */
import { atoi, indexOf, stricmp, abbrev } from '../cstr';
import type { SpellRec } from '../data';
import { findItem } from '../room/checkNames';
import { findEntity, stopToKill } from '../room/entities';
import type { Session } from '../Session';
import { landsAs, stateSpell } from '../spells/lookup';
import { CAST_STATES, isCastState, State } from '../states';
import { castSpellFor, countCast, inAttackCast, resetNoMessage, spellTakesTarget } from './casts';
import { blowStruck, castForgotten } from './timer';
import { EntityFlag, LineFlag, WEAPON_KINDS, WeaponKind, EntityType } from '../flags';
import { castTook, rungBlow } from '../stats/window';

const FOES = [
  ' your foe',
  ' your foes',
  ' your enemy',
  ' your enemies',
  ' your opponent',
  ' your opponents',
  ' your adversary',
  ' your adversaries'
];

/** `0x426c30`: an area spell's damage line (`… your foes for 12 damage`), not healing. */
export function areaDamage(line: string): number {
  if (indexOf(line, ' damage') === -1 || indexOf(line, ' healing ') !== -1) return 0;
  for (const foe of FOES) {
    const at = indexOf(line, foe);
    if (at === -1) continue;
    const after = line[at + foe.length];
    if (after === undefined || ' ,.!?;:'.includes(after)) return 1;
  }
  return 0;
}

/** `0x426b20`: this character's own damage line, `You … for 12 damage!` (or an area one). */
function ownDamage(line: string): number {
  if (areaDamage(line) !== 0) return 1;
  if (!(line.startsWith('You ') || line.startsWith('Your inaccurate '))) return 0;
  if (line.startsWith('You are ') || line.startsWith('You take ')) return 0;
  const end = indexOf(line, ' damage!');
  if (end <= 0) return 0;
  let start = end;
  while (line[start - 1] !== ' ') {
    start -= 1;
    if (start < 1) return 0;
  }
  if (start >= end) return 0;
  for (let i = start; i < end; i += 1) if (!/[0-9]/.test(line[i]!)) return 0;
  return start > 4 && line.slice(start - 5, start) === ' for ' ? 1 : 0;
}

/** `0x4263c0`: a weapon kind's immunity mark. */
export function immunityOf(weapon: number): number {
  if (weapon === WeaponKind.Normal) return EntityFlag.ImmuneNormalWeapon;
  if (weapon === WeaponKind.Alt) return EntityFlag.ImmuneAltWeapon;
  return weapon === WeaponKind.Backstab ? EntityFlag.ImmuneBackstabWeapon : 0;
}

/** `0x4263f0`: a weapon kind's "maybe immune" mark. */
export function maybeImmunityOf(weapon: number): number {
  if (weapon === WeaponKind.Normal) return EntityFlag.MaybeImmuneNormalWeapon;
  if (weapon === WeaponKind.Alt) return EntityFlag.MaybeImmuneAltWeapon;
  return weapon === WeaponKind.Backstab ? EntityFlag.MaybeImmuneBackstabWeapon : 0;
}

/** `0x4262a0`: which of the configured weapons this is (`WeaponKind` bits). */
export function weaponKinds(s: Session, name: string): number {
  if (name === '') return 0;
  let kinds = 0;
  if (s.Combat_NrmWeapon !== '' && s.Combat_NrmWeapon === name) kinds |= WeaponKind.Normal;
  if (s.Combat_AltWeapon !== '' && s.Combat_AltWeapon === name) kinds |= WeaponKind.Alt;
  if (s.Combat_BsWeapon !== '' && s.Combat_BsWeapon === name) kinds |= WeaponKind.Backstab;
  return kinds;
}

/** `0x4747f0`: clear a mark from the monsters of this name, and from the marks remembered. */
function unmarkMonsters(s: Session, name: string, flags: number): number {
  let n = 0;
  for (const e of s.room) {
    if (e.type !== EntityType.Monster) continue;
    if (stricmp(e.name, name) === 0 || (e.mon && stricmp(e.mon.name, name) === 0)) {
      e.flags &= ~flags;
      n += 1;
    }
  }
  const mark = s.monsterMarks.find((m) => stricmp(m.name, name) === 0);
  if (mark) mark.flags &= ~flags;
  return n;
}

/** The attack command, when it is MegaMUD's own `attack` (or unset). */
function attacksPlainly(s: Session): boolean {
  return s.Combat_AttackCmd === '' || abbrev('attack', s.Combat_AttackCmd, 1) !== 0;
}

/** A backstab that did not surprise: run when told to, else go on attacking. */
function backstabFailed(s: Session, stopsToKill: number): void {
  s.backstabResolved = 1;
  if (stopsToKill === 0 && s.Combat_RunIfBsFails !== 0 && s.held === 0) {
    s.runCount = s.Combat_RunRooms;
  } else if (!attacksPlainly(s) || (s.owedPostBackstab !== 0 && s.Combat_PostBsCmd === '')) {
    s.attackDue = 1;
  }
}

/** `0x429bb0`. 1 when the line was one of this character's blows or spells landing. */
export function hitLine(s: Session, line: string): number {
  const colour = s.line.attr[0];
  if (
    (s.inCombat === 0 && inAttackCast(s, 1) === 0) ||
    (colour !== 9 && colour !== 0xc && colour !== 6 && colour !== 0xb)
  ) {
    return 0;
  }
  let spell: SpellRec | null = null;
  let weaponHit = false;
  let surprised = false;
  let own = ownDamage(line);
  if (areaDamage(line) !== 0 && inAttackCast(s, 1) === 0 && inAttackCast(s, 0) === 0) own = 0;
  let mode = s.state;

  if (s.msgSpell !== '') {
    // A damage line another spell's row carries may be this one's (`landsAs`).
    const borrowed = (cast: string): boolean => s.msgDamage !== 0 && landsAs(s, s.msgSpell, cast);
    if (
      inAttackCast(s, 1) !== 0 &&
      s.castName !== '' &&
      (stricmp(s.castName, s.msgSpell) === 0 || borrowed(s.castName))
    ) {
      if (
        s.msgSource === '' ||
        stricmp(s.msgSource, 'you') === 0 ||
        stricmp(s.msgSource, 'your') === 0
      ) {
        s.msgSource = 'you';
        mode = s.castMode;
      }
    }
    for (const st of CAST_STATES) {
      if (s.msgSource === '' && s.state === st) {
        spell = stateSpell(s, st);
        if (spell && (spell.name === s.msgSpell || borrowed(spell.name))) s.msgSource = 'you';
      }
    }
    if (s.msgSource === '') {
      const weapon = findItem(s, s.msgSpell);
      if (weapon && weapon.name === s.weaponWielded) {
        s.msgSource = 'you';
        weaponHit = true;
      }
    }
  }
  if (s.msgSpell === '') {
    if (inAttackCast(s, 1) === 0 || own === 0) {
      if (inAttackCast(s, 0) === 0) mode = State.Attacking;
    } else {
      mode = s.castMode;
    }
  }

  if (
    indexOf(line, 'You deliver a ') !== -1 &&
    indexOf(line, ' to ') !== -1 &&
    indexOf(line, 'damage') === -1
  ) {
    s.blowContinues = 1;
    return 1;
  }
  if (
    line.startsWith('Your ') &&
    indexOf(line, 'glances off') !== -1 &&
    indexOf(line, ' damage!') === -1
  ) {
    castForgotten(s);
    landed(s);
    return 1;
  }
  if (indexOf(line, 'You are ') !== -1 || indexOf(line, 'You take ') !== -1) return 0;
  if (indexOf(line, 'You ') === -1 && indexOf(line, 'Your inaccurate') === -1 && own === 0) {
    if (
      stricmp(s.msgSource, 'you') !== 0 &&
      stricmp(s.msgSource, 'your') !== 0 &&
      s.blowContinues === 0
    )
      return 0;
  }
  const stopsToKill = stopToKill(s);
  const damageAt = indexOf(line, ' damage!');
  let numberAt: number;
  if (damageAt === -1) {
    if (s.msgDamage === 0) {
      if (indexOf(line, ' healing ') !== -1) return 0;
      if (!MISSES.some((phrase) => indexOf(line, phrase) !== -1)) return 0;
      if (s.state === State.Backstabbing) {
        if (s.backstabResolved === 0) backstabFailed(s, stopsToKill);
      } else {
      }
      castForgotten(s);
      landed(s);
      return 1;
    }
    s.blowContinues = 0;
    numberAt = -1;
  } else {
    numberAt = damageAt - 1;
    s.blowContinues = 0;
    while (numberAt > 0 && line[numberAt - 1] !== ' ') numberAt -= 1;
  }
  let dealt = s.msgDamage !== 0 ? s.msgDamage : atoi(numberAt < 0 ? '' : line.slice(numberAt));
  if (s.msgDamage !== 0) dealt = s.msgDamage;
  const casting = isCastState(mode);
  if (casting) {
    spell ??= castSpellFor(s, mode, 1);
    if (spell && spellTakesTarget(spell) !== 0) {
      castForgotten(s);
      s.skipTick = 1;
    }
  }
  if (mode >= State.CastPreMulti && mode <= State.CastMain) {
    rungBlow(s, mode, dealt);
  } else {
    const surprise = SURPRISES.some((phrase) => indexOf(line, phrase) !== -1);
    if (!surprise) {
      const critical = indexOf(line, ' critically ') !== -1;
      if ((critical || !weaponHit) && s.state === State.Backstabbing && s.backstabResolved === 0)
        backstabFailed(s, stopsToKill);
    } else {
      s.backstabResolved = 1;
      s.backstabSurprised = 1;
      surprised = true;
      castForgotten(s);
      if (!attacksPlainly(s) || (s.owedPostBackstab !== 0 && s.Combat_PostBsCmd === ''))
        s.attackDue = 1;
    }
  }
  if (
    s.state === State.Backstabbing &&
    !surprised &&
    stopsToKill === 0 &&
    s.Combat_RunIfBsFails !== 0 &&
    s.held === 0
  ) {
    s.runCount = s.Combat_RunRooms;
  }
  blowStruck(s);
  s.roundDamage += dealt;
  s.fightDamage += dealt;
  if (dealt >= 1 && !weaponHit && !casting && sameTargetHere(s)) clearWeaponImmunity(s);
  if (mode === State.CastMulti || mode === State.CastPreMulti) s.multiDamage += dealt;
  if (casting) {
    castTook(s, mode, 1);
    countCast(s, mode, 1);
    resetNoMessage(s, mode);
    if (mode === s.castMode || (s.castMode === State.Nothing && mode === s.state)) {
      if (s.debug !== 0 && s.castMessageSeen === 0) s.host.trace('{#}');
      s.castMessageSeen = 1;
    }
  }
  s.lineFlags |= LineFlag.FightLineSeen;
  s.lastHitAt = s.now;
  s.sneaking = 0;
  s.hidden = 0;
  if (s.debug !== 0 && s.combatOffExpected !== 0) s.host.trace('{I7-}');
  s.combatOffExpected = 0;
  if (dealt > 0 && s.allOff === 0 && s.MegaMud_AutoCombat !== 0) staleCombat(s);
  return 1;
}

/** `0x426cf0`: the target is the monster fought last, in this room. */
function sameTargetHere(s: Session): boolean {
  return (
    s.target !== '' &&
    s.targetProtected === 0 &&
    s.equipsPending === 0 &&
    s.lastTarget !== '' &&
    stricmp(s.lastTarget, s.target) === 0 &&
    s.lastTargetRoom === s.roomSignature
  );
}

/** A weapon hit on a monster marked immune to it: the mark was wrong. */
function clearWeaponImmunity(s: Session): void {
  if (s.noEffectCount >= 1 || s.noEffectTarget !== '') {
    s.noEffectTarget = '';
    s.noEffectCount = 0;
    if (s.debug !== 0) s.host.trace('{W-hit}');
  }
  const e = findEntity(s, s.target, 0);
  if (!e?.mon || e.mon.name === '') return;
  const kinds = weaponKinds(s, s.weaponWielded);
  for (const [weapon, letter] of WEAPON_KINDS) {
    if ((kinds & weapon) === 0) continue;
    const maybe = maybeImmunityOf(weapon);
    if ((e.flags & maybe) !== 0) {
      unmarkMonsters(s, e.mon.name, maybe);
      s.weaponsSuspect &= ~weapon;
      if (s.debug !== 0) s.host.trace(`{W-clr:${letter}}`);
    }
    const sure = immunityOf(weapon);
    if ((e.flags & sure) !== 0) {
      unmarkMonsters(s, e.mon.name, sure);
      s.host.show(`[${s.weaponWielded} works vs ${e.mon.name} after all - clearing immunity]`);
    }
  }
}

/** The bookkeeping every blow ends with (`0x426eb0` and around it). */
function landed(s: Session): void {
  s.lineFlags |= LineFlag.FightLineSeen;
  s.lastHitAt = s.now;
  s.sneaking = 0;
  s.hidden = 0;
  if (s.debug !== 0 && s.combatOffExpected !== 0) s.host.trace('{I6-}');
  s.combatOffExpected = 0;
  blowStruck(s);
}

/**
 * Damage dealt with no combat frame, round, move or message for half a
 * minute: MegaMUD decides it is fighting without knowing it (`{combat??}`)
 * and asks for the room.
 */
function staleCombat(s: Session): void {
  const quiet = (t: number): boolean => s.now - t > 0x1e;
  if (
    [
      s.lastHitAt,
      s.attackSentAt,
      s.combatOnAt,
      s.combatOffAt,
      s.movedAt,
      s.lastKeyAt,
      s.castAt
    ].every(quiet)
  ) {
    if (s.debug !== 0) s.host.trace('{combat??}');
    s.inCombat = 0;
    s.attackDue = 1;
    s.roomLookedAt = 0;
    s.lookDue = 1;
  }
}

const MISSES = [
  ' with your ',
  'You miss ',
  'You fire at ',
  'You flail at ',
  'You hurl at ',
  'You hurl your ',
  'You lash at ',
  'You lunge at ',
  'You shoot at ',
  'You double-shoot at ',
  'You snap at ',
  'You spray at ',
  'You swing at ',
  'You swipe at ',
  'You thrust at ',
  ' and barely miss ',
  'Your inaccurate ',
  'You stumble and ',
  'You slip and scramble',
  'You circle and ',
  'You advance, looking',
  'You jumpkick',
  'You punch',
  'You kick'
];

const SURPRISES = [
  'You surprise ',
  'You feint and surprise ',
  'You spin and surprise ',
  'You leap and surprise ',
  'You lunge and surprise ',
  'You skillfully surprise ',
  'You quickly surprise ',
  'You roll and surprise ',
  'You duck and surprise '
];
