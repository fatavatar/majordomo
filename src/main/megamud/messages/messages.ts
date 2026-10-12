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
import {
  countCast,
  f_426ab0,
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
import type { Session } from '../Session';
import { findSpell, findSpellByName } from '../spells/lookup';
import { unported } from '../unported';
import { blessCommand } from '../player/cast';
import { blowStruck, castForgotten } from '../combat/timer';

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
  if ((rec.flags & 4) !== 0) return templateMatch(s, rec.msg, line) !== 0;
  if ((rec.effects & 0x400) !== 0) return indexOf(line, rec.msg) !== -1;
  return line.startsWith(rec.msg);
}

/** The spell a cast state is configured to cast. */
function stateSpell(s: Session, state: number): SpellRec | null {
  const short: Record<number, string> = {
    9: s.Combat_PreMultAttack,
    0xa: s.Combat_MultAttack,
    0xb: s.Combat_PreAttack,
    0xc: s.Combat_AttackSpl2,
    0xd: s.Combat_AttackSpl,
    0xe: s.altSpell,
    0xf: s.userSpell
  };
  const name = short[state];
  return name ? findSpell(s, name) : null;
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
    if ((eff & 0x8000) !== 0) continue;
    if (anywhere === 0 ? (eff & 0x100) !== 0 : (eff & 0x100) === 0) continue;
    if (!chasing && (eff & 0x4000) !== 0) continue;
    if (!starts(s, rec, line)) {
      if ((rec.flags & 1) !== 0 && messageEnded(s, line, rec) !== 0) result = 1;
      continue;
    }
    s.msgSpell = rec.name.slice(0, 30);
    if ((eff & 1) !== 0) s.blind = 1;
    if ((eff & 2) !== 0) s.confused = 1;
    if ((eff & 4) !== 0) s.poisoned = 1;
    if ((eff & 0x40) !== 0) s.diseased = 1;
    if ((eff & 8) !== 0) s.losingHp = 1;
    if ((eff & 0x80) !== 0) s.hpRegen = 1;
    if ((eff & 0x200) !== 0) s.manaRegen = 1;
    if ((eff & 0x10) !== 0) s.held = 1;
    if ((eff & 0x20) !== 0) {
      s.f_e218 = 1;
      forgetLastTarget(s);
    }
    if ((eff & 0x1000) !== 0) {
      s.inCombat = 0;
      forgetLastTarget(s);
      s.target = '';
      s.f_e290 = 1;
      setState(s, 0);
    }
    if ((eff & 0x2000) !== 0) {
      forgetLastTarget(s);
      if (s.state === 0x19) s.f_e2e4 = 1;
      setState(s, 0);
      if (s.following !== 0 || s.f_e2ec !== 0 || s.f_e2f8 !== 0) resendPartyHold(s);
    }
    result = 1;
    if (rec.endMsg === '') {
      if (s.msgDamage !== 0 || s.msgTarget !== '') {
        result = 0;
        if (s.msgSource === '') {
          if (
            s.msgDamage !== 0 &&
            f_426ab0(s, 1) !== 0 &&
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
          if ((s.state === 0x11 || s.state === 0x12) && s.msgDamage !== 0) {
            const weapon = findItem(s, s.msgSpell);
            if (weapon && weapon.name === s.s_b060) return 0;
          }
        }
      }
    } else {
      rec.flags |= 1;
      rec.firedAt = s.now;
    }
    if ((eff & 4) !== 0 && (rec.flags & 1) !== 0 && s.Other_IgnorePoison !== 0) return result;
    if (chasing && (eff & 0x4000) !== 0) {
      if (stricmp(s.msgTarget, s.chaseTarget) === 0 || stricmp(s.msgTarget, s.leaderName) === 0) {
        if (rec.action !== '' && s.f_a32c === 0) {
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
    if ((eff & 0x10) !== 0 && s.following !== 0 && s.f_e2f8 === 0 && s.f_a32c === 0) {
      s.f_32338 = s.now;
      s.f_e2f8 = 1;
      if (s.restReason === '') s.restReason = "can't move";
      const wait = s.Party_PartyWaitCmd !== '' ? s.Party_PartyWaitCmd : '@wait';
      queue(s, `/${s.leaderName} ${wait} (can't move)\r`);
    }
    if (indexOf(line, 'You are blind') !== -1 && s.state === 0x16) setState(s, 0);
    if (result === 0 && s.msgTarget === '') continue;
    if (s.msgDamage === 0 && f_426ab0(s, 1) !== 0) {
      const fromMe =
        s.msgSource === '' ||
        stricmp(s.msgSource, 'you') === 0 ||
        stricmp(s.msgSource, 'your') === 0;
      if (fromMe) {
        if (s.castName !== '' && stricmp(s.castName, s.msgSpell) === 0) {
          configured ??= castSpellFor(s, s.f_a448, 0);
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
  resetNoMessage(s, s.f_a448);
  countCast(s, s.f_a448, 1);
  s.lineFlags |= 0x20;
  s.f_e1c4 = 0;
  s.hidden = 0;
  s.f_e1d8 = 0;
  s.f_a44c = 1;
  if (area !== 0) {
    blowStruck(s);
  }
  if (
    s.f_a448 === 0xb &&
    s.castShort !== '' &&
    (s.castShort === s.PvP_PvpSpell1 || s.castShort === s.PvP_PvpSpell2)
  ) {
    let e = findEntity(s, s.target, 0);
    if (!e && s.room.length > 0 && s.room[0]!.type === 1) e = s.room[0]!;
    if (e && e.type === 1) {
      if (s.castShort === s.PvP_PvpSpell1) e.flags |= 0x20;
      if (s.castShort === s.PvP_PvpSpell2) e.flags |= 0x40;
    }
  }
  if (area === 0) {
    clearCastMode(s);
    setState(s, 0);
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
  const okAt = s.f_32340;
  const waitAt = s.f_32338;
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
      s.f_32390 = 0;
      s.f_e290 = 1;
      break;
    case 2: {
      if ((rec.flags & 2) !== 0) break;
      let eff = rec.effects;
      if (s.Other_IgnoreBlind !== 0) eff &= ~1;
      if (s.Other_IgnoreConfusion !== 0) eff &= ~2;
      if (s.Other_IgnorePoison !== 0) eff &= ~4;
      if (eff !== 0 || rec.effects === 0) {
        rec.flags |= 2;
        s.restUntilOff += 1;
        s.s_742d = rec.name.slice(0, 30);
      }
      break;
    }
    case 3:
      s.f_e224 = 1;
      break;
    case 4:
      s.f_e228 = 1;
      break;
    case 5:
      s.runCount = s.Combat_RunRooms;
      if (s.debug !== 0) s.host.trace(`{run-msg:${rec.name}}`);
      if (!s.warnedStashRun && (s.state === 0x1e || s.f_e2c0 !== 0)) {
        s.warnedStashRun = true;
        s.host.show(
          `[Warning: message '${rec.name}' triggered a run-away while stashing - if a stash room is full this can loop the path; edit that message entry if unintended]`
        );
      }
      break;
    case 6:
      if (s.f_8130 !== 0x67110001 && hangupAllowed(s) !== 0) {
        s.host.trace(`[Hangup message detected (${rec.name})]`);
        s.f_30de4 = 1;
        s.f_30de8 = 1;
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
  unported('402f90');
  if (first && s.state === 0x10) {
    s.f_a3e0 += 1;
    s.f_a3e4 += 1;
    const slot = s.blessSlot;
    if (slot >= 0 && slot < 10) {
      const cmd = blessCommand(s, slot);
      if (cmd !== '' && stricmp(first.short, cmd) === 0) {
        s.blessCastAt[slot] = s.now;
        s.blessSeenAt[slot] = s.now;
        forgetAwaited(s, 0x10);
        setState(s, 0);
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
      (rec.effects & 0x400) === 0 ? line.startsWith(rec.endMsg) : indexOf(line, rec.endMsg) !== -1;
  }
  const stale = (rec.flags & 1) !== 0 && s.now - rec.firedAt > 599;
  if (!stale && !ends) return 0;
  const eff = rec.effects;
  if ((eff & 1) !== 0) s.blind = 0;
  if ((eff & 2) !== 0) s.confused = 0;
  if ((eff & 4) !== 0) {
    s.poisoned = 0;
    s.f_e1f8 = 0;
  }
  if ((eff & 0x40) !== 0) s.diseased = 0;
  if ((eff & 8) !== 0) s.losingHp = 0;
  if ((eff & 0x80) !== 0) s.hpRegen = 0;
  if ((eff & 0x200) !== 0) s.manaRegen = 0;
  if ((eff & 0x10) !== 0) {
    s.held = 0;
    s.f_32300 = 0;
  }
  if ((eff & 0x20) !== 0) s.f_e218 = 0;
  const flags = rec.flags;
  rec.flags = flags & ~1;
  if ((flags & 2) !== 0) {
    rec.flags = flags & ~3;
    s.restUntilOff = Math.max(0, s.restUntilOff - 1);
  }
  if (line !== null) {
    for (const other of s.data.messages ?? []) {
      if ((other.effects & 0x8000) !== 0 || (other.flags & 1) === 0) continue;
      if (
        other.msg === rec.msg ||
        (other.effects !== 0 && (eff & other.effects) === other.effects)
      ) {
        messageEnded(s, null, other);
      }
    }
  }
  s.restUntilOff = Math.max(0, s.restUntilOff);
  if ((eff & 1) !== 0) s.f_e290 = 1;
  const spell = findSpellByName(s, rec.name);
  if (spell) {
    for (let i = 0; i < 10; i += 1) {
      if (stricmp(spell.short, blessCommand(s, i)) === 0) s.blessCastAt[i] = 0;
    }
  }
  return 1;
}
