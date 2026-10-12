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
import { setTask } from '../script/task';
import type { Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { unported } from '../unported';
import { castStamp } from '../combat/timer';

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
  if (stricmp(word1, s.s_7cf7) === 0) {
    s.host.show('[Manual Relog]');
    s.inGame = 0;
  }
  if (s.inGame !== 0) {
    inGame(s, from, command, word1, word2, rest);
  }
  if (abbrev(word1, '/page', 2) !== 0) unported('460bb0');
  if (s.f_e174 !== 0) unported('488700');
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
  if (s.s_7d21.length === 1 && word1[0] === s.s_7d21) return;
  const dir = typedDirection(word1);
  if (dir !== -1 && from !== -1 && word2 === '' && unported('408540') !== 0) {
    s.f_e184 = 0;
    s.f_e188 = 0;
    s.f_e18c = 0;
    s.f_e178 = 0;
    if (s.following !== 0) {
      s.partySize = 0;
      s.following = 0;
    }
    setTask(s, 0xb);
  }
  if (abbrev(word1, 'bash', 3) !== 0) {
    const d = typedDirection(word2);
    if (d !== -1) {
      s.f_db30 = d;
      setState(s, 0x17);
    }
  }
  if (abbrev(word1, 'break', 3) !== 0) {
    s.f_e1d8 = 0;
    s.engagedMode = 0;
    s.stateAwaited = 0;
    forgetAwaited(s, s.state);
    setState(s, 0);
  }
  if (s.inCombat === 0) {
    const stealthy = s.Player_Stealth > 0 || s.Other_SuperStealth !== 0;
    if (stealthy && abbrev(word1, 'sneak', 2) !== 0) {
      if (s.Combat_CanBackStab !== 0 && s.f_a32c === 0 && s.MegaMud_AutoSneak !== 0)
        preBackstab(s, 0);
      s.sneaking = 1;
      s.f_e2bc = 0;
      s.f_e1c8 = 0;
      s.waitLines = 2;
      setState(s, 0x1b);
      s.host.activity('Attempting to sneak');
    }
    if (s.inCombat === 0 && stealthy && abbrev(word1, 'hide', 3) !== 0) {
      if (s.Combat_CanBackStab !== 0 && s.f_a32c === 0 && s.MegaMud_AutoHide !== 0)
        preBackstab(s, 0);
      s.hidden = 1;
      s.f_e1d0 = 0;
      s.f_32300 = s.now;
      s.waitLines = 2;
      setState(s, 0x13);
      s.host.activity('Attempting to hide');
    }
  }
  if (abbrev(word1, 'picklock', 2) !== 0) {
    s.f_db30 = typedDirection(word2);
    setState(s, 0x18);
  }
  if (abbrev(word1, 'open', 2) !== 0) {
    s.f_db30 = typedDirection(word2);
    setState(s, 0x1a);
  }
  if ((abbrev(word1, 'inventory', 1) !== 0 || abbrev(word1, 'wealth', 3) !== 0) && word2 === '')
    setState(s, 0x25);
  if ((abbrev(word1, 'who', 3) !== 0 || abbrev(word1, 'scan', 2) !== 0) && word2 === '')
    setState(s, 0x23);
  if (abbrev(word1, 'look', 1) !== 0) setState(s, 0x20);
  if (abbrev(word1, 'search', 3) !== 0) setState(s, 0x21);
  if (abbrev(word1, 'rest', 4) !== 0 && word2 === '') setState(s, 2);

  const attackVerb =
    abbrev('attack', word1, 1) !== 0 ||
    stricmp(word1, 'aa') === 0 ||
    stricmp(word1, 'smash') === 0 ||
    (stricmp(word1, 'bash') === 0 && typedDirection(word2) === -1) ||
    abbrev('punch', word1, 2) !== 0 ||
    abbrev('jumpkick', word1, 2) !== 0 ||
    abbrev('kick', word1, 3) !== 0;
  if (attackVerb && (s.inCombat !== 0 || word2 !== '')) {
    s.engagedMode = 0x11;
    s.f_e1d8 = 1;
    s.f_8be4 = 1;
    if (s.debug !== 0) s.host.trace('{I8+}');
    if (word2 !== '') {
      setTarget(s, word2);
      rememberTarget(s);
    }
    setState(s, 0x11);
  } else if (word2 !== '' && (stricmp(word1, 'bs') === 0 || abbrev('backstab', word1, 5) !== 0)) {
    s.engagedMode = 0;
    clearCastMode(s);
    s.f_e1d8 = 1;
    s.f_8be4 = 1;
    s.f_e1b8 = 0;
    s.f_e1bc = 0;
    if (s.debug !== 0) s.host.trace('{I9+}');
    setTarget(s, word2);
    rememberTarget(s);
    setState(s, 0x12);
  } else if (!attackVerb && (word1.length === 3 || word1.length === 4)) {
    typedSpell(s, word1, word2);
  }
  if (word1[0] === '/') {
    if (command.length > 1 && abbrev(word1, '/page', 2) === 0) unported('460bb0');
  } else if (word1[0] === '>' && command.length > 1) {
    unported('460bb0');
  }
  if (abbrev(word1, 'sysop', 2) !== 0) setState(s, 0x20);
  void rest;
}

/** A spell's short name typed: what `0x465d90` makes of it. */
function typedSpell(s: Session, word1: string, word2: string): void {
  const spell = findSpell(s, word1);
  if (!spell) return;
  if ((spell.flags & 4) === 0) {
    s.lastCast = spell.short.slice(0, 0x50);
    if (s.inCombat !== 0 || enemiesHere(s, 0) > 0) {
      if (s.debug !== 0 && s.f_e1d8 !== 0) s.host.trace('{I9-}');
      s.f_e1d8 = 0;
      s.f_e2b8 = 1;
      s.waitLines = 2;
    }
    castStamp(s);
    s.skipTick = 1;
    setState(s, 0x15);
    return;
  }
  const area = spellTakesTarget(spell);
  s.engagedMode = 0;
  const untargeted = word2 === '' || (spell.flags & 0x80) !== 0;
  if (word2 === '' && (spell.flags & 0x80) === 0) return;
  s.lastCast = spell.short.slice(0, 0x50);
  let next: number;
  if (area === 0) {
    if (s.inCombat === 0 && enemiesHere(s, 1) < 1) return;
    if (s.debug !== 0 && s.f_e1d8 !== 0) s.host.trace('{I8-}');
    s.f_e1d8 = 0;
    s.f_8be4 = 1;
    s.f_e2b8 = 1;
    s.waitLines = 2;
    castStamp(s);
    s.skipTick = 1;
    if (untargeted) s.target = '';
    else setTarget(s, word2);
    next = 0x15;
  } else {
    if (stricmp(word1, s.Combat_MultAttack) === 0) {
      next = 0xa;
      s.f_a3ec = 0;
      s.engagedMode = 0xa;
    } else if (stricmp(word1, s.Combat_PreMultAttack) === 0) {
      next = 9;
      s.f_a3e8 = 0;
      s.engagedMode = 9;
    } else if (stricmp(word1, s.Combat_PreAttack) === 0) {
      next = 0xb;
      s.f_a3f0 = 0;
      s.engagedMode = 0xb;
    } else if (stricmp(word1, s.Combat_AttackSpl2) === 0) {
      next = 0xc;
      s.f_a3f8 = 0;
      s.engagedMode = 0xc;
    } else if (stricmp(word1, s.Combat_AttackSpl) === 0) {
      next = 0xd;
      s.f_a3f4 = 0;
      s.engagedMode = 0xd;
    } else {
      s.f_a400 = 0;
      next = 0xf;
      s.userSpell = spell.short.slice(0, 10);
    }
    if (s.debug !== 0) s.host.trace('{I10+}');
    s.f_e1d8 = 1;
    s.f_8be4 = 1;
    resetNoMessage(s, next);
    if (untargeted) {
      s.target = '';
      s.f_a580 = 1;
    } else {
      setTarget(s, word2);
    }
  }
  setState(s, next);
}
