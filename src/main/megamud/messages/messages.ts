/**
 * Messages.md, running (`0x46a920`): each row whose start matches a line
 * sets the conditions its effect bits name and does what its number says;
 * its end clears them (`0x46bb70`). A row named after a spell is that
 * spell's message, and is how MegaMUD counts a cast of the fight's spell.
 * Read 2026-10-12.
 *
 * The dispatcher calls this twice a line: first (`anywhere` 1) for the rows
 * flagged `0x100`, early; then (0) for the rest, after the room handlers.
 */
import { spellCastSeen } from '../abilities/monitors';
import {
  countCast,
  inAttackCast,
  resetNoMessage,
  spellTakesTarget,
  castSpellFor
} from '../combat/casts';
import { clearCastMode } from '../combat/engaged';
import { atoi, indexOf, stricmp } from '../cstr';
import type { MessageRec, SpellRec } from '../data';
import { findItem, hangupAllowed } from '../room/checkNames';
import { forgetLastTarget } from '../room/roomName';
import { findEntity } from '../room/entities';
import { hangUp } from '../script/game';
import { expandMacros, noteCommands, queue, queueCommand, send } from '../script/send';
import { forgetAwaited, setState } from '../script/state';
import { ARENA, type Session } from '../Session';
import { findSpell, findSpellByName, stateSpell } from '../spells/lookup';
import { blessCommand } from '../player/cast';
import { blowStruck, castForgotten } from '../combat/timer';
import { State } from '../states';
import { LineFlag, MessageFlag, MessageEffect, EntityFlag, EntityType } from '../flags';
import { castTook } from '../stats/window';

/** What a template's fields captured (`0x59c300`…), kept on the session when it matches. */
interface Captures {
  dmg: number;
  source: string;
  target: string;
  args: string[];
}

/**
 * `0x467ec0`: a start (or end) with `{fields}` matched against a line. The
 * text before the first field may be anywhere in the line; after that the
 * template must follow on, each field taking what lies before the template's
 * next literal text (or the rest of the line). `{1}`–`{5}` not in the
 * template keep what they held.
 */
export function templateMatch(s: Session, template: string, line: string): number {
  const brace = template.indexOf('{');
  const prefix = brace === -1 ? template.length : brace;
  if ((prefix === 0 && template[0] !== '{') || template.length === 0 || line.length === 0) return 0;
  let src: number;
  if (prefix === 0) {
    src = 0;
  } else {
    src = -1;
    for (let p = 0; p < line.length; p += 1) {
      if (line.startsWith(template.slice(0, prefix), p)) {
        src = p + prefix;
        break;
      }
    }
    if (src === -1) return 0;
  }
  const got: Captures = { dmg: 0, source: '', target: '', args: [...s.msgArgs] };
  let t = prefix;
  for (;;) {
    if (t >= template.length) {
      s.msgDamage = got.dmg;
      s.msgSource = got.source.slice(0, 0x50);
      s.msgTarget = got.target.slice(0, 0x50);
      s.msgArgs = got.args.map((a) => a.slice(0, 0x50));
      return 1;
    }
    if (template[t] === '{') {
      const close = template.indexOf('}', t);
      if (close === -1) {
        if (template[t] !== line[src]) return 0;
        t += 1;
        src += 1;
        continue;
      }
      const field = template.slice(t, close + 1);
      let litEnd = close + 1;
      while (litEnd < template.length && template[litEnd] !== '{') litEnd += 1;
      const literal = template.slice(close + 1, litEnd);
      const rest = line.slice(src);
      let take: number;
      if (literal.length === 0) {
        take = rest.length;
      } else {
        take = rest.length;
        for (let u = 0; u < rest.length; u += 1) {
          if (rest.startsWith(literal, u)) {
            take = u;
            break;
          }
        }
      }
      const text = rest.slice(0, Math.min(take, 100));
      if (field.startsWith('{source}')) got.source = text;
      if (field.startsWith('{target}')) got.target = text;
      for (let n = 1; n <= 5; n += 1) if (field.startsWith(`{${n}}`)) got.args[n - 1] = text;
      if (field.startsWith('{dmg}')) got.dmg = atoi(rest);
      src += take;
      t = close + 1;
      continue;
    }
    if (template[t] !== line[src]) return 0;
    t += 1;
    src += 1;
  }
}

/** Whether a row's start matches: as a template, anywhere (`0x400`), or at the line's start. */
function starts(s: Session, rec: MessageRec, line: string): boolean {
  if ((rec.flags & MessageFlag.StartHasFields) !== 0) return templateMatch(s, rec.msg, line) !== 0;
  if ((rec.effects & MessageEffect.Anywhere) !== 0) return indexOf(line, rec.msg) !== -1;
  return line.startsWith(rec.msg);
}

/** `0x46a920`. 1 when a row matched (or one ended). */
export function messageLine(s: Session, line: string, anywhere: number): number {
  let chasing = s.chaseTarget !== '';
  if (chasing && s.following !== 0 && s.chaseTarget === s.leaderName) chasing = false;
  s.msgSpell = '';
  s.msgSource = '';
  s.msgTarget = '';
  s.msgDamage = 0;
  const rows = s.data.messages ?? [];
  let result = 0;
  let configured: SpellRec | null = null;
  for (const rec of rows) {
    const eff = rec.effects;
    if ((eff & MessageEffect.Disabled) !== 0) continue;
    if (
      anywhere === 0
        ? (eff & MessageEffect.InConversations) !== 0
        : (eff & MessageEffect.InConversations) === 0
    )
      continue;
    if (!chasing && (eff & MessageEffect.WhenChasing) !== 0) continue;
    if (!starts(s, rec, line)) {
      if ((rec.flags & MessageFlag.Active) !== 0 && messageEnded(s, line, rec) !== 0) result = 1;
      continue;
    }
    s.msgSpell = rec.name.slice(0, 30);
    if ((eff & MessageEffect.Blinded) !== 0) s.blind = 1;
    if ((eff & MessageEffect.Confused) !== 0) s.confused = 1;
    if ((eff & MessageEffect.Poisoned) !== 0) s.poisoned = 1;
    if ((eff & MessageEffect.Diseased) !== 0) s.diseased = 1;
    if ((eff & MessageEffect.LosingHp) !== 0) s.losingHp = 1;
    if ((eff & MessageEffect.HpRegen) !== 0) s.hpRegen = 1;
    if ((eff & MessageEffect.ManaRegen) !== 0) s.manaRegen = 1;
    if ((eff & MessageEffect.MovementPrevented) !== 0) s.held = 1;
    if ((eff & MessageEffect.AttackPrevented) !== 0) {
      s.attackPrevented = 1;
      forgetLastTarget(s);
    }
    if ((eff & MessageEffect.EndsCombat) !== 0) {
      s.inCombat = 0;
      forgetLastTarget(s);
      s.target = '';
      s.lookDue = 1;
      setState(s, State.Nothing);
    }
    if ((eff & MessageEffect.LastActionFailed) !== 0) {
      forgetLastTarget(s);
      if (s.state === State.Disarming) s.trapDisarmed = 1;
      setState(s, State.Nothing);
      if (s.following !== 0 || s.partyLost !== 0 || s.holdingLeader !== 0) resendPartyHold(s);
    }
    result = 1;
    if (rec.endMsg === '') {
      if (s.msgDamage !== 0 || s.msgTarget !== '') {
        result = 0;
        if (s.msgSource === '') {
          if (
            s.msgDamage !== 0 &&
            inAttackCast(s, 1) !== 0 &&
            s.castName !== '' &&
            stricmp(s.castName, s.msgSpell) === 0
          ) {
            if (s.debug !== 0) s.host.trace(`{${s.msgSpell}}`);
            return 0;
          }
          if (s.state >= 9 && s.state <= 0xf) {
            configured = stateSpell(s, s.state);
            if (configured && s.msgDamage !== 0 && configured.name === s.msgSpell) {
              if (s.debug !== 0) s.host.trace(`{${s.msgSpell}*}`);
              return 0;
            }
          }
          if (
            (s.state === State.Attacking || s.state === State.Backstabbing) &&
            s.msgDamage !== 0
          ) {
            const weapon = findItem(s, s.msgSpell);
            if (weapon && weapon.name === s.weaponWielded) return 0;
          }
        }
      }
    } else {
      rec.flags |= MessageFlag.Active;
      rec.firedAt = s.now;
    }
    if (
      (eff & MessageEffect.Poisoned) !== 0 &&
      (rec.flags & MessageFlag.Active) !== 0 &&
      s.Other_IgnorePoison !== 0
    )
      return result;
    if (chasing && (eff & MessageEffect.WhenChasing) !== 0) {
      if (stricmp(s.msgTarget, s.chaseTarget) === 0 || stricmp(s.msgTarget, s.leaderName) === 0) {
        if (rec.action !== '' && s.allOff === 0) {
          noteCommands(s, rec.action);
          let out = expandMacros(s, rec.action);
          if (!out.endsWith('\r')) out += '\r';
          send(s, out);
          return 1;
        }
      }
    }
    actOnNumber(s, rec);
    blessingsSeen(s, rec);
    if (rec.action !== '') {
      let out = expandMacros(s, rec.action);
      if (out.length === 0 || !out.endsWith('\r')) out += '\r';
      queueCommand(s, out, 1, 0, 1);
    }
    if (
      (eff & MessageEffect.MovementPrevented) !== 0 &&
      s.following !== 0 &&
      s.holdingLeader === 0 &&
      s.allOff === 0
    ) {
      s.waitSentAt = s.now;
      s.holdingLeader = 1;
      if (s.restReason === '') s.restReason = "can't move";
      const wait = s.Party_PartyWaitCmd !== '' ? s.Party_PartyWaitCmd : '@wait';
      queue(s, `/${s.leaderName} ${wait} (can't move)\r`);
    }
    if (indexOf(line, 'You are blind') !== -1 && s.state === State.Moving)
      setState(s, State.Nothing);
    if (result === 0 && s.msgTarget === '') continue;
    if (s.msgDamage === 0 && inAttackCast(s, 1) !== 0) {
      const fromMe =
        s.msgSource === '' ||
        stricmp(s.msgSource, 'you') === 0 ||
        stricmp(s.msgSource, 'your') === 0;
      if (fromMe) {
        if (s.castName !== '' && stricmp(s.castName, s.msgSpell) === 0) {
          configured ??= castSpellFor(s, s.castMode, 0);
          return countedByMessage(s, configured);
        }
        if (configured && s.castShort !== '' && stricmp(configured.short, s.castShort) === 0) {
          return countedByMessage(s, configured);
        }
      }
    }
  }
  return result;
}

/** The part of `0x46a920` after `0x46b8b6`: the fight's spell is seen working, by its message. */
function countedByMessage(s: Session, spell: SpellRec | null): number {
  const area = spellTakesTarget(spell);
  if (area !== 0) {
    castForgotten(s);
    s.skipTick = 1;
  }
  if (s.debug !== 0) s.host.trace(`{${s.msgSpell}+}`);
  resetNoMessage(s, s.castMode);
  castTook(s, s.castMode, 1);
  countCast(s, s.castMode, 1);
  s.lineFlags |= LineFlag.FightLineSeen;
  s.sneaking = 0;
  s.hidden = 0;
  s.combatOffExpected = 0;
  s.castMessageSeen = 1;
  if (area !== 0) {
    blowStruck(s);
  }
  if (
    s.castMode === State.CastPre &&
    s.castShort !== '' &&
    (s.castShort === s.PvP_PvpSpell1 || s.castShort === s.PvP_PvpSpell2)
  ) {
    let e = findEntity(s, s.target, 0);
    if (!e && s.room.length > 0 && s.room[0]!.type === EntityType.Player) e = s.room[0]!;
    if (e && e.type === EntityType.Player) {
      if (s.castShort === s.PvP_PvpSpell1) e.flags |= EntityFlag.PvpSpell1Cast;
      if (s.castShort === s.PvP_PvpSpell2) e.flags |= EntityFlag.PvpSpell2Cast;
    }
  }
  if (area === 0) {
    clearCastMode(s);
    setState(s, State.Nothing);
  }
  return 1;
}

/**
 * After a "can't move" (`0x2000`) row while following or holding: the last
 * `@ok` telepath is sent again if it was the more recent and within
 * `LagWait + 3` seconds, else the last `@wait` on the same terms.
 */
function resendPartyHold(s: Session): void {
  const window = s.Comms_LagWait + 3;
  const okAt = s.okSentAt;
  const waitAt = s.waitSentAt;
  if (okAt > 0 && s.now - okAt < window && !(okAt < waitAt)) {
    if (s.lastResumeSent.length > 1) queue(s, s.lastResumeSent);
    return;
  }
  if (waitAt > 0 && s.now - waitAt < window && s.lastWaitSent.length > 1) queue(s, s.lastWaitSent);
}

/** A row's number (`+0x118`): what MegaMUD does about it. */
function actOnNumber(s: Session, rec: MessageRec): void {
  switch (rec.number) {
    case 1:
      s.roomLookedAt = 0;
      s.lookDue = 1;
      break;
    case 2: {
      if ((rec.flags & MessageFlag.RestedOn) !== 0) break;
      let eff = rec.effects;
      if (s.Other_IgnoreBlind !== 0) eff &= ~MessageEffect.Blinded;
      if (s.Other_IgnoreConfusion !== 0) eff &= ~MessageEffect.Confused;
      if (s.Other_IgnorePoison !== 0) eff &= ~MessageEffect.Poisoned;
      if (eff !== 0 || rec.effects === 0) {
        rec.flags |= MessageFlag.RestedOn;
        s.restUntilOff += 1;
        s.lastRestRow = rec.name.slice(0, 30);
      }
      break;
    }
    case 3:
      s.restHpToFull = 1;
      break;
    case 4:
      s.restManaToFull = 1;
      break;
    case 5:
      s.runCount = s.Combat_RunRooms;
      if (s.debug !== 0) s.host.trace(`{run-msg:${rec.name}}`);
      if (!s.warnedStashRun && (s.state === State.Stashing || s.stashing !== 0)) {
        s.warnedStashRun = true;
        s.host.show(
          `[Warning: message '${rec.name}' triggered a run-away while stashing - if a stash room is full this can loop the path; edit that message entry if unintended]`
        );
      }
      break;
    case 6:
      if (s.roomSignature !== ARENA && hangupAllowed(s) !== 0) {
        s.host.trace(`[Hangup message detected (${rec.name})]`);
        s.skipRedialOnce = 1;
        s.noRedial = 1;
        hangUp(s, 1);
        s.host.alert?.('hangup');
      }
      break;
  }
}

/** A row named after a blessing's spell restarts that blessing's timer, and settles a blessing being cast. */
function blessingsSeen(s: Session, rec: MessageRec): void {
  let first: SpellRec | null = null;
  for (let i = 0; i < 10; i += 1) {
    const cmd = blessCommand(s, i);
    if (cmd === '') continue;
    const spell = findSpell(s, cmd);
    if (spell && stricmp(spell.name, rec.name) === 0) {
      first ??= spell;
      if (s.debug !== 0) s.host.trace(`{${rec.name}}`);
      s.blessCastAt[i] = s.now;
    }
  }
  spellCastSeen(s, rec.name);
  if (first && s.state === State.Blessing) {
    s.castAnswered += 1;
    s.castTook += 1;
    const slot = s.blessSlot;
    if (slot >= 0 && slot < 10) {
      const cmd = blessCommand(s, slot);
      if (cmd !== '' && stricmp(first.short, cmd) === 0) {
        s.blessCastAt[slot] = s.now;
        s.blessSeenAt[slot] = s.now;
        forgetAwaited(s, State.Blessing);
        setState(s, State.Nothing);
      }
    }
  }
}

/**
 * `0x46bb70`: an active row's end matched (or, with no line, ended by
 * another), or the row is ten minutes old: its conditions clear, so do the
 * other active rows with the same start or a subset of its effects, and a
 * blessing spell of that name is due again.
 */
export function messageEnded(s: Session, line: string | null, rec: MessageRec): number {
  let ends = true;
  if (line !== null) {
    ends =
      (rec.effects & MessageEffect.Anywhere) === 0
        ? line.startsWith(rec.endMsg)
        : indexOf(line, rec.endMsg) !== -1;
  }
  const stale = (rec.flags & MessageFlag.Active) !== 0 && s.now - rec.firedAt > 599;
  if (!stale && !ends) return 0;
  const eff = rec.effects;
  if ((eff & MessageEffect.Blinded) !== 0) s.blind = 0;
  if ((eff & MessageEffect.Confused) !== 0) s.confused = 0;
  if ((eff & MessageEffect.Poisoned) !== 0) {
    s.poisoned = 0;
    s.tooSickToRest = 0;
  }
  if ((eff & MessageEffect.Diseased) !== 0) s.diseased = 0;
  if ((eff & MessageEffect.LosingHp) !== 0) s.losingHp = 0;
  if ((eff & MessageEffect.HpRegen) !== 0) s.hpRegen = 0;
  if ((eff & MessageEffect.ManaRegen) !== 0) s.manaRegen = 0;
  if ((eff & MessageEffect.MovementPrevented) !== 0) {
    s.held = 0;
    s.hiddenAt = 0;
  }
  if ((eff & MessageEffect.AttackPrevented) !== 0) s.attackPrevented = 0;
  const flags = rec.flags;
  rec.flags = flags & ~MessageFlag.Active;
  if ((flags & MessageFlag.RestedOn) !== 0) {
    rec.flags = flags & ~(MessageFlag.Active | MessageFlag.RestedOn);
    s.restUntilOff = Math.max(0, s.restUntilOff - 1);
  }
  if (line !== null) {
    for (const other of s.data.messages ?? []) {
      if (
        (other.effects & MessageEffect.Disabled) !== 0 ||
        (other.flags & MessageFlag.Active) === 0
      )
        continue;
      if (
        other.msg === rec.msg ||
        (other.effects !== 0 && (eff & other.effects) === other.effects)
      ) {
        messageEnded(s, null, other);
      }
    }
  }
  s.restUntilOff = Math.max(0, s.restUntilOff);
  if ((eff & MessageEffect.Blinded) !== 0) s.lookDue = 1;
  const spell = findSpellByName(s, rec.name);
  if (spell) {
    for (let i = 0; i < 10; i += 1) {
      if (stricmp(spell.short, blessCommand(s, i)) === 0) s.blessCastAt[i] = 0;
    }
  }
  return 1;
}

/** The rows matching `which` are cured (`start` 0): no longer active, nor rested off; or started (`start` 1), now. */
function conditionRows(s: Session, which: (rec: MessageRec) => boolean, start: number): void {
  for (const rec of s.data.messages ?? []) {
    if (!which(rec)) continue;
    if (start !== 0) {
      rec.flags |= MessageFlag.Active;
      rec.firedAt = s.now;
      continue;
    }
    const was = rec.flags;
    rec.flags = was & ~MessageFlag.Active;
    if ((was & MessageFlag.RestedOn) !== 0) {
      rec.flags = was & ~(MessageFlag.Active | MessageFlag.RestedOn);
      s.restUntilOff -= 1;
    }
  }
}

/** `0x46c180`: the rows that poison (effect 4). */
export function poisonRows(s: Session, start: number): void {
  conditionRows(s, (rec) => (rec.effects & MessageEffect.Poisoned) !== 0, start);
}

/** `0x46c0f0`: the rows that hold (effect exactly 0x10). */
export function heldRows(s: Session, start: number): void {
  conditionRows(s, (rec) => rec.effects === MessageEffect.MovementPrevented, start);
}
