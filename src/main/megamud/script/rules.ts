/**
 * The rules (MegaMUD 2.1's `[Rules]`), read 2026-10-12: named groups of
 * conditions (HP, mana, the party, monsters, who or what is here, the room)
 * and actions (rest, run, hang up, a command). Each scheduler pass (D21,
 * `0x49c570`) reads on from where the last stopped: an action runs when no
 * condition since the rule's name failed, and the pass ends on the first
 * action that does something.
 */
import { healthStep } from '../health/rest';
import { membersInStep, weakestMember } from '../party/members';
import { hangupAllowed } from '../room/checkNames';
import { enemiesHere, findEntity } from '../room/entities';
import { atoi, rowField, stricmp } from '../cstr';
import type { Rule, Session } from '../Session';
import { stamp } from './events';
import { hangUp } from './game';
import { expandMacros, send } from './send';

/** `0x49c3d0`: a condition holds. */
function holds(s: Session, r: Rule): boolean {
  let want = atoi(r.text);
  let value = 0;
  switch (r.what) {
    case 1:
      if (s.Player_MaxHP > 0) value = Math.trunc((s.hp * 100) / s.Player_MaxHP);
      break;
    case 2:
      if (s.Player_MaxMana > 0) value = Math.trunc((s.mana * 100) / s.Player_MaxMana);
      break;
    case 3: {
      const i = weakestMember(s, 0, 0x900);
      value = i < 0 ? 100 : s.party[i]!.hpPct;
      break;
    }
    case 4:
      value = membersInStep(s);
      break;
    case 5:
      value = enemiesHere(s, 0);
      break;
    case 6: {
      want = 1;
      const e = findEntity(s, r.text, 0);
      value = e && e.type !== 3 ? 1 : 0;
      break;
    }
    case 7:
      want = 1;
      value = stricmp(s.roomName, r.text) === 0 ? 1 : 0;
      break;
  }
  switch (r.test) {
    case 0:
      return value === want;
    case 1:
      return value !== want;
    case 2:
      return value > want;
    case 3:
      return value >= want;
    case 4:
      return value < want;
    case 5:
      return value <= want;
    default:
      return true;
  }
}

/** `0x49c1d0`: an action, 1 when it did something. */
function act(s: Session, r: Rule): boolean {
  switch (r.what) {
    case 0:
      return healthStep(s) !== 0;
    case 1:
      s.restHpToFull = 1;
      s.hpFullAt = 0;
      return healthStep(s) !== 0;
    case 2:
      s.restManaToFull = 1;
      s.manaFullAt = 0;
      return healthStep(s) !== 0;
    case 3:
      if (s.runCount !== 0) return false;
      s.runCount = s.Combat_RunRooms;
      return true;
    case 4:
      if (s.f_8130 === 0x67110001 || hangupAllowed(s) === 0) return false;
      s.host.trace(`[Hangup rule (${stamp(s)})]`);
      s.f_30de4 = 1;
      s.f_30de8 = 1;
      hangUp(s, 1);
      s.host.alert?.('hangup');
      return true;
    case 0xe: {
      let text = expandMacros(s, r.text);
      if (!text.endsWith('\r')) text += '\r';
      send(s, text);
      return true;
    }
    default:
      return false;
  }
}

/** D21 (`0x49c570`). */
export function rulesStep(s: Session): number {
  if (s.ruleAt < 0 || s.ruleAt >= s.rules.length) {
    s.ruleAt = 0;
    if (s.rules.length < 1) return 0;
  }
  let failed = false;
  for (;;) {
    const r = s.rules[s.ruleAt]!;
    if (r.kind === 0) {
      s.ruleName = r.text;
      failed = false;
    } else if (r.kind === 1 || r.kind === 2) {
      if (!failed && !holds(s, r)) failed = true;
    } else if (r.kind === 3 || r.kind === 4) {
      if (!failed && act(s, r)) {
        s.ruleAt += 1;
        return 1;
      }
    }
    s.ruleAt += 1;
    if (s.ruleAt >= s.rules.length) return 0;
  }
}

/** `0x49c820`: the rules from the character's `[Rules]`: `R1`, `R2`, … each `kind:what:test:text`. */
export function loadRules(s: Session, read: (key: string) => string): void {
  s.rules = [];
  for (let n = 1; ; n += 1) {
    let text = read(`R${n}`).slice(0, 199);
    if (text === '') break;
    let kind: number;
    let what: number;
    let test: number;
    [kind, text] = rowField(text);
    [what, text] = rowField(text);
    [test, text] = rowField(text);
    // `0x4ad0f0`: up to the next `:`, 40 characters.
    const colon = text.indexOf(':');
    s.rules.push({
      kind,
      what,
      test,
      text: (colon === -1 ? text : text.slice(0, colon)).slice(0, 0x28)
    });
  }
  s.rulesChanged = 0;
}
