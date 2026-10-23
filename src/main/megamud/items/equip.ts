/**
 * `0x454320`: wearing and removing, read 2026-10-12: `You are now holding …`
 * / `wearing …` (equipped; a weapon is the one in hand, any other weapon put
 * away), `You have removed …`, `You now have no weapon readied.`, `You are
 * already wearing …` / `You do not have … left unequipped` (as equipped), and
 * the refusals (`… may not be worn!`, `You may not wear that item!`: no
 * longer auto-equipped). Each answers an equip (`equipsPending` counts them down).
 */
import { indexOf, splitWord, stricmp, trimSpaces } from '../cstr';
import { weaponKinds } from '../combat/hits';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { findCarried } from './inventory';
import { State } from '../states';
import { CarriedFlag, ItemFlag, WEAPON_KINDS } from '../flags';

function oneAnswered(s: Session): number {
  s.equipsPending = Math.max(s.equipsPending - 1, 0);
  return 1;
}

/** The weapon now in hand: every other weapon put away, the configured weapons marked as tried. */
function inHand(s: Session, name: string): void {
  s.weaponWielded = name.slice(0, 30);
  for (const c of s.inventory) if (c.item && c.item.type === 1) c.flags &= ~CarriedFlag.Equipped;
  const kinds = weaponKinds(s, name);
  if (kinds !== 0) {
    s.weaponsInHand |= kinds;
    if (s.debug !== 0) {
      const tag = WEAPON_KINDS.map(([kind, letter]) => (kinds & kind ? letter : '')).join('');
      s.host.trace(`{W-conf:${tag}}`);
    }
  }
}

/** The state an equip or removal ends. */
function settle(s: Session): void {
  forgetAwaited(s, s.state);
  setState(s, State.Nothing);
}

function nowWearing(s: Session, line: string, at: number): number {
  const [name] = splitWord(line.slice(at + 0x14), '.', 100);
  const c = findCarried(s, name);
  if (c) {
    if (c.item && c.item.type === 1) inHand(s, name);
    c.flags |= CarriedFlag.Equipped;
  }
  const st = s.state;
  const resting = st === State.RestAsked || st === State.Resting;
  if (
    (resting && s.BBS_GreaterMUD !== 0) ||
    (
      [
        State.CastPreMulti,
        State.CastMulti,
        State.CastPre,
        State.CastAux,
        State.CastMain,
        State.CastAlt,
        State.CastUser,
        State.Attacking,
        State.Backstabbing,
        State.Hiding,
        State.Sneaking,
        State.Equipping
      ] as readonly number[]
    ).includes(st)
  ) {
    settle(s);
  }
  return oneAnswered(s);
}

function removed(s: Session, line: string, at: number): number {
  const [name] = splitWord(line.slice(at + 0x11), '.', 100);
  const c = findCarried(s, name);
  if (c) c.flags &= ~CarriedFlag.Equipped;
  if (s.weaponWielded !== '' && stricmp(name, s.weaponWielded) === 0) s.weaponWielded = '';
  const kinds = weaponKinds(s, name);
  if (kinds !== 0) {
    s.weaponsInHand &= ~kinds;
    s.weaponsProbing &= ~kinds;
  }
  const st = s.state;
  if (st >= 2 && st <= 5) {
    if (s.BBS_GreaterMUD === 0) settle(s);
  } else if (
    (
      [
        State.CastPreMulti,
        State.CastMulti,
        State.CastPre,
        State.CastAux,
        State.CastMain,
        State.CastAlt,
        State.CastUser,
        State.Attacking
      ] as readonly number[]
    ).includes(st)
  ) {
    if (s.inCombat !== 0) {
      s.attackDue = 1;
      if (s.debug !== 0) s.host.trace('{I13+}');
      s.combatOffExpected = 1;
    }
  } else if (st === State.Backstabbing || st === State.Hiding || st === State.Sneaking) {
    settle(s);
  }
  return 1;
}

function noWeapon(s: Session): number {
  s.weaponWielded = '';
  const c = s.inventory.find(
    (x) => x.item && x.item.type === 1 && (x.flags & CarriedFlag.Equipped) !== 0
  );
  if (c) c.flags &= ~CarriedFlag.Equipped;
  s.weaponsInHand = 0;
  s.weaponsProbing = 0;
  if (s.state === State.Moving) return 1;
  settle(s);
  return 1;
}

/** `You are already wearing …` / `You do not have … left unequipped`: as equipped. */
function alreadyOn(s: Session, line: string): number {
  let name = '';
  const doNot = indexOf(line, 'You do not have ');
  const left = indexOf(line, ' left unequipped');
  if (doNot !== -1 && left !== -1 && left > doNot + 0x10) {
    name = line.slice(doNot + 0x10, Math.min(left, doNot + 0x10 + 99));
  } else {
    const already = indexOf(line, 'You are already wearing ');
    if (already !== -1)
      name = line.slice(already + 0x18, already + 0x18 + 99).replace(/[.! ]+$/, '');
  }
  name = trimSpaces(name);
  if (name === '' && s.state === State.Equipping) name = s.equipping;
  if (name !== '') {
    const c = findCarried(s, name);
    if (c && c.item && c.item.type === 1) {
      inHand(s, c.item.name);
      c.flags |= CarriedFlag.Equipped;
    }
  }
  if (s.state === State.Equipping) {
    s.weightMax = 0;
    forgetAwaited(s, State.Equipping);
    setState(s, State.Nothing);
  }
  return oneAnswered(s);
}

/** The refusals, and `You are not wearing …`. */
function refused(s: Session, line: string): number {
  let name = '';
  const worn = indexOf(line, ' may not be worn!');
  if (worn !== -1) {
    name = trimSpaces(line.slice(0, Math.min(worn, 99)));
    oneAnswered(s);
  } else if (indexOf(line, 'You may not wear that item!') !== -1) {
    oneAnswered(s);
    if (s.state === State.Equipping) name = s.equipping;
  }
  if (name === '') {
    const not = indexOf(line, 'You are not wearing ');
    if (not === -1) return 0;
    const [item] = splitWord(line.slice(not + 0x14), '.', 100);
    const c = findCarried(s, item);
    if (c) c.flags &= ~CarriedFlag.Equipped;
    if (
      (
        [
          State.RestAsked,
          State.Resting,
          State.MeditateAsked,
          State.Meditating,
          State.Hiding,
          State.Sneaking,
          State.Equipping
        ] as readonly number[]
      ).includes(s.state)
    )
      settle(s);
    return 1;
  }
  const c = findCarried(s, name);
  if (c && c.item && (c.item.flags & ItemFlag.Equip) !== 0) {
    s.host.show(`[${name} will no longer be auto-equipped]`);
    c.item.flags = (c.item.flags & ~ItemFlag.Equip) | ItemFlag.Changed;
    s.itemsChanged = 1;
  }
  if (s.state === State.Equipping) {
    forgetAwaited(s, State.Equipping);
    setState(s, State.Nothing);
  }
  return oneAnswered(s);
}

export function equipLine(s: Session, line: string): number {
  let at = indexOf(line, 'You are now holding ');
  if (at === -1) at = indexOf(line, 'You are now wearing ');
  if (at !== -1) return nowWearing(s, line, at);
  at = indexOf(line, 'You have removed ');
  if (at !== -1) return removed(s, line, at);
  if (indexOf(line, 'You now have no weapon readied.') !== -1) return noWeapon(s);
  if (
    indexOf(line, 'You are already wearing ') !== -1 ||
    (indexOf(line, 'You do not have ') !== -1 && indexOf(line, ' left unequipped') !== -1)
  ) {
    return alreadyOn(s, line);
  }
  if (indexOf(line, 'You may not wear an off-hand item') !== -1) {
    if (s.state === State.Equipping) {
      forgetAwaited(s, State.Equipping);
      setState(s, State.Nothing);
    }
    return oneAnswered(s);
  }
  return refused(s, line);
}
