/**
 * A command typed by the player, or sent from the pending list, read for
 * what it starts (`0x465d90`, reached through window message `0x4a9`). Read
 * 2026-10-12.
 *
 * Moving by hand stops the path; `rest`, `search`, `look`, `who`, `inv`,
 * `sneak`, `hide`, `picklock`, `open` and `bash` set the matching state; an
 * attack (`attack`, `aa`, `smash`, `bash <monster>`, `punch`, `kick`,
 * `jumpkick`) or a backstab engages; and a spell's short name typed is a cast:
 * a non-attack spell sets Casting, an attack spell the attack mode it is
 * configured as (or the user attack, with its own spell). `from` is 0 for the
 * player, 1 for a recorded path command, -1 for a remote.
 */
import { resetNoMessage, spellTakesTarget } from '../combat/casts';
import { clearCastMode, rememberTarget, setTarget } from '../combat/engaged';
import { abbrev, splitWord, stricmp, trimSpaces, typedDirection } from '../cstr';
import { preBackstab } from '../health/prepost';
import { enemiesHere } from '../room/entities';
import { forgetAwaited, setState } from '../script/state';
import { setTask, Task } from '../script/task';
import type { Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { castStamp } from '../combat/timer';
import { move } from '../move/go';
import { State } from '../states';
import { SpellFlag } from '../flags';

export function typedCommand(s: Session, from: number, text: string): void {
  s.lastTyped = text.slice(0, 0x100);
  s.typedAt = s.host.tickMs();
  let command = text;
  if (from === 0) {
    command = trimSpaces(command);
    if (command === '') return;
  }
  const [first, rest] = splitWord(command, ' ', 0x1f);
  const [second, rest2] = splitWord(rest, ' ', 0x1f);
  const word1 = first.toLowerCase();
  const word2 = second.toLowerCase();
  if (stricmp(word1, s.relogCmd) === 0) {
    s.host.show('[Manual Relog]');
    s.inGame = 0;
  }
  if (s.inGame !== 0) {
    inGame(s, from, command, word1, word2, rest);
  }
  // `0x460bb0` logs a page to MegaMUD's talk window, which is our talk
  // panel's; `0x488700` records the step for MegaMUD's path recorder
  // (`recording`), which the app does not have.
  void s.recording;
  void rest2;
}

function inGame(
  s: Session,
  from: number,
  command: string,
  word1: string,
  word2: string,
  rest: string
): void {
  if (s.speechPrefix.length === 1 && word1[0] === s.speechPrefix) return;
  const dir = typedDirection(word1);
  if (dir !== -1 && from !== -1 && word2 === '' && move(s, dir, 0) !== 0) {
    s.walking = 0;
    s.looping = 0;
    s.roaming = 0;
    s.importing = 0;
    if (s.following !== 0) {
      s.partySize = 0;
      s.following = 0;
    }
    setTask(s, Task.InGame);
  }
  if (abbrev(word1, 'bash', 3) !== 0) {
    const d = typedDirection(word2);
    if (d !== -1) {
      s.moveDir = d;
      setState(s, State.Bashing);
    }
  }
  if (abbrev(word1, 'break', 3) !== 0) {
    s.combatOffExpected = 0;
    s.engagedMode = State.Nothing;
    s.stateAwaited = State.Nothing;
    forgetAwaited(s, s.state);
    setState(s, State.Nothing);
  }
  if (s.inCombat === 0) {
    const stealthy = s.Player_Stealth > 0 || s.Other_SuperStealth !== 0;
    if (stealthy && abbrev(word1, 'sneak', 2) !== 0) {
      if (s.Combat_CanBackStab !== 0 && s.allOff === 0 && s.MegaMud_AutoSneak !== 0)
        preBackstab(s, 0);
      s.sneaking = 1;
      s.sneakAsked = 0;
      s.wasSneaking = 0;
      s.waitLines = 2;
      setState(s, State.Sneaking);
      s.host.activity('Attempting to sneak');
    }
    if (s.inCombat === 0 && stealthy && abbrev(word1, 'hide', 3) !== 0) {
      if (s.Combat_CanBackStab !== 0 && s.allOff === 0 && s.MegaMud_AutoHide !== 0)
        preBackstab(s, 0);
      s.hidden = 1;
      s.hideAgain = 0;
      s.hiddenAt = s.now;
      s.waitLines = 2;
      setState(s, State.Hiding);
      s.host.activity('Attempting to hide');
    }
  }
  if (abbrev(word1, 'picklock', 2) !== 0) {
    s.moveDir = typedDirection(word2);
    setState(s, State.Picking);
  }
  if (abbrev(word1, 'open', 2) !== 0) {
    s.moveDir = typedDirection(word2);
    setState(s, State.Opening);
  }
  if ((abbrev(word1, 'inventory', 1) !== 0 || abbrev(word1, 'wealth', 3) !== 0) && word2 === '')
    setState(s, State.Inventory);
  if ((abbrev(word1, 'who', 3) !== 0 || abbrev(word1, 'scan', 2) !== 0) && word2 === '')
    setState(s, State.Who);
  if (abbrev(word1, 'look', 1) !== 0) setState(s, State.Looking);
  if (abbrev(word1, 'search', 3) !== 0) setState(s, State.Searching);
  if (abbrev(word1, 'rest', 4) !== 0 && word2 === '') setState(s, State.RestAsked);

  const attackVerb =
    abbrev('attack', word1, 1) !== 0 ||
    stricmp(word1, 'aa') === 0 ||
    stricmp(word1, 'smash') === 0 ||
    (stricmp(word1, 'bash') === 0 && typedDirection(word2) === -1) ||
    abbrev('punch', word1, 2) !== 0 ||
    abbrev('jumpkick', word1, 2) !== 0 ||
    abbrev('kick', word1, 3) !== 0;
  if (attackVerb && (s.inCombat !== 0 || word2 !== '')) {
    s.engagedMode = State.Attacking;
    s.combatOffExpected = 1;
    s.engagedHere = 1;
    if (s.debug !== 0) s.host.trace('{I8+}');
    if (word2 !== '') {
      setTarget(s, word2);
      rememberTarget(s);
    }
    setState(s, State.Attacking);
  } else if (word2 !== '' && (stricmp(word1, 'bs') === 0 || abbrev('backstab', word1, 5) !== 0)) {
    s.engagedMode = State.Nothing;
    clearCastMode(s);
    s.combatOffExpected = 1;
    s.engagedHere = 1;
    s.backstabResolved = 0;
    s.backstabSurprised = 0;
    if (s.debug !== 0) s.host.trace('{I9+}');
    setTarget(s, word2);
    rememberTarget(s);
    setState(s, State.Backstabbing);
  } else if (!attackVerb && (word1.length === 3 || word1.length === 4)) {
    typedSpell(s, word1, word2);
  }
  // A telepath or a gangpath typed is logged to MegaMUD's talk window
  // (`0x460bb0`): our talk panel's.

  if (abbrev(word1, 'sysop', 2) !== 0) setState(s, State.Looking);
  void rest;
}

/** A spell's short name typed: what `0x465d90` makes of it. */
function typedSpell(s: Session, word1: string, word2: string): void {
  const spell = findSpell(s, word1);
  if (!spell) return;
  if ((spell.flags & SpellFlag.EvilInCombat) === 0) {
    s.lastCast = spell.short.slice(0, 0x50);
    if (s.inCombat !== 0 || enemiesHere(s, 0) > 0) {
      if (s.debug !== 0 && s.combatOffExpected !== 0) s.host.trace('{I9-}');
      s.combatOffExpected = 0;
      s.attackDue = 1;
      s.waitLines = 2;
    }
    castStamp(s);
    s.skipTick = 1;
    setState(s, State.Casting);
    return;
  }
  const area = spellTakesTarget(spell);
  s.engagedMode = State.Nothing;
  const untargeted = word2 === '' || (spell.flags & SpellFlag.Area) !== 0;
  if (word2 === '' && (spell.flags & SpellFlag.Area) === 0) return;
  s.lastCast = spell.short.slice(0, 0x50);
  let next: number;
  if (area === 0) {
    if (s.inCombat === 0 && enemiesHere(s, 1) < 1) return;
    if (s.debug !== 0 && s.combatOffExpected !== 0) s.host.trace('{I8-}');
    s.combatOffExpected = 0;
    s.engagedHere = 1;
    s.attackDue = 1;
    s.waitLines = 2;
    castStamp(s);
    s.skipTick = 1;
    if (untargeted) s.target = '';
    else setTarget(s, word2);
    next = State.Casting;
  } else {
    if (stricmp(word1, s.Combat_MultAttack) === 0) {
      next = State.CastMulti;
      s.castsMulti = 0;
      s.engagedMode = State.CastMulti;
    } else if (stricmp(word1, s.Combat_PreMultAttack) === 0) {
      next = State.CastPreMulti;
      s.castsPreMulti = 0;
      s.engagedMode = State.CastPreMulti;
    } else if (stricmp(word1, s.Combat_PreAttack) === 0) {
      next = State.CastPre;
      s.castsPre = 0;
      s.engagedMode = State.CastPre;
    } else if (stricmp(word1, s.Combat_AttackSpl2) === 0) {
      next = State.CastAux;
      s.castsAux = 0;
      s.engagedMode = State.CastAux;
    } else if (stricmp(word1, s.Combat_AttackSpl) === 0) {
      next = State.CastMain;
      s.castsMain = 0;
      s.engagedMode = State.CastMain;
    } else {
      s.castsUser = 0;
      next = State.CastUser;
      s.userSpell = spell.short.slice(0, 10);
    }
    if (s.debug !== 0) s.host.trace('{I10+}');
    s.combatOffExpected = 1;
    s.engagedHere = 1;
    resetNoMessage(s, next);
    if (untargeted) {
      s.target = '';
      s.multiAttacking = 1;
    } else {
      setTarget(s, word2);
    }
  }
  setState(s, next);
}
