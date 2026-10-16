/**
 * Sending: straight to the socket (`0x42d9f0`), or onto the pending list
 * (`0x48ab80`) that the scheduler drains one command a pass (`0x48ad60`).
 * Read 2026-10-12.
 *
 * MegaMUD watches what it sends: the same command sent 20 times running,
 * while in the game, resets its waits ("[reset]"), and 40 times resets harder
 * ("[reset+]"). A bare Enter or `par` neither counts nor breaks the run.
 */
import { abbrev, findNoCase, splitWord, strcmp, stricmp, typedDirection } from '../cstr';
import { resetNoMessage, spellTakesTarget } from '../combat/casts';
import { rememberTarget, setTarget } from '../combat/engaged';
import type { SpellRec } from '../data';
import { castSpell } from '../health/cast';
import { findEntity } from '../room/entities';
import { findSpell } from '../spells/lookup';
import type { Session } from '../Session';
import { setState } from './state';
import { clearPending, sixtySeconds, tenSeconds, thirtySeconds } from './waits';
import { State } from '../states';
import { LineFlag, SpellFlag } from '../flags';
import { Task } from './task';

/** One pending command (`0x5c6d40`, `0x5c76a0`, `0x5c7380`, `0x5c7060`). */
export interface Pending {
  text: string;
  /** Expand macros (`{target}` and the rest, `0x4acc40`) when it is sent. */
  expand: number;
  /** It came from the player or a remote, and is checked against its target (`0x48b370`). */
  checked: number;
  /** `monitorQueuing` when it was queued. */
  tag: number;
}

/** `0x42d9f0`: send `text` now. Returns 1. */
/**
 * How long a command's echo is waited for before lines count toward its
 * answer anyway, for a realm (or a moment) that does not echo.
 */
const ECHO_WAIT_MS = 3000;

/**
 * Ours, not MegaMUD's: each command sent in the game remembered until the
 * realm echoes it back. MegaMUD takes any two lines after a command, and any
 * prompt in a fight, as its answer (`0x47b070`); a room redraw already on the
 * way then answered a heal before it had been read, so the next step was
 * taken (the double step) or the attack sent again and again (2026-10-14).
 */
function noteEchoes(s: Session, text: string): void {
  if (s.inGame === 0) return;
  const at = s.host.tickMs();
  for (const part of text.split('\r')) {
    const command = part.replace(/\x01/g, '').trim().toLowerCase();
    if (command !== '') s.echoes.push({ text: command, at });
  }
}

/**
 * A line heard: if it is (after any prompt) a command's echo, that command
 * and any sent before it are no longer waited on. Then whether a command's
 * echo is still awaited, those waited on too long let go.
 */
export function echoAwaited(s: Session, rest: string | null): boolean {
  if (s.echoes.length === 0) return false;
  if (rest !== null) {
    const heard = rest.trim().toLowerCase();
    const at = heard === '' ? -1 : s.echoes.findIndex((echo) => echo.text === heard);
    if (at !== -1) s.echoes.splice(0, at + 1);
  }
  const now = s.host.tickMs();
  while (s.echoes.length > 0 && now - s.echoes[0]!.at > ECHO_WAIT_MS) s.echoes.shift();
  return s.echoes.length > 0;
}

export function send(s: Session, text: string): number {
  s.lastAbil.valid = 0;
  if (text !== '\r' && text !== 'par\r') {
    s.loginQuietStrikes = 0;
    s.loginQuietTens = 0;
  }
  if (s.abilSending === 0) {
    if (s.unknown_e57c === 0 && s.inGame !== 0) {
      const last = s.lastSent;
      if (last.length > 1 && strcmp(text, last) === 0) {
        s.sameSent += 1;
        if (s.sameSent === 0x14) {
          s.host.trace('[reset]');
          resetWaits(s, false);
        } else if (s.sameSent > 0x27) {
          s.host.trace('[reset+]');
          s.sameSent = 0;
          s.lastSent = '';
          resetWaits(s, true);
        }
      } else if (!(last.length > 1 && text === '\r')) {
        s.lastSent = text.slice(0, 0x100);
        s.sameSent = 1;
      }
    } else {
      s.sameSent = 0;
      s.lastSent = '';
    }
  } else {
    s.abilSending = 0;
  }
  s.lastSentAt = s.now;
  noteEchoes(s, text);
  s.host.write(text);
  if (s.silentSends < 1) {
    if (s.Display_ShowSend !== 0 && s.task > Task.LoggingOn) s.host.echo?.(text);
  } else {
    s.silentSends -= 1;
  }
  return 1;
}

function resetWaits(s: Session, harder: boolean): void {
  if (harder) clearPending(s);
  tenSeconds(s);
  if (harder) sixtySeconds(s);
  else thirtySeconds(s);
  s.statDue = 1;
  s.parDue = 1;
  s.weightMax = 0;
  s.inventoryAskedAt = 0;
  s.roomLookedAt = 0;
  s.lookDue = 1;
  s.lineFlags |= LineFlag.Prompted;
}

/** `0x42e0e0`: wake the scheduler. */
export function wake(s: Session): number {
  s.lineFlags |= LineFlag.Prompted;
  s.dialState = 4;
  return 1;
}

/** `0x48ab60`: queue `text`, macros expanded, unchecked. */
export function queue(s: Session, text: string): number {
  return queueCommand(s, text, 0, 1, 0);
}

/**
 * `0x48ab80`: queue a command, or send it now when not in the game. A
 * command already pending is not queued again (unless `again`). More than
 * 200 pending is refused ("[Pending command overflow]").
 */
export function queueCommand(
  s: Session,
  text: string,
  again: number,
  expand: number,
  checked: number
): number {
  if (s.inGame === 0) {
    send(s, text);
    return 1;
  }
  if (s.pending.length >= 200) {
    s.host.trace('[Pending command overflow]');
    return 0;
  }
  if (again === 0 && s.pending.some((p) => p.text === text)) {
    s.lineFlags |= LineFlag.Prompted;
    return 1;
  }
  s.pending.push({ text, expand, checked, tag: s.monitorQueuing });
  s.lineFlags |= LineFlag.Prompted;
  return 1;
}

/** `0x48ad60`: send the first pending command. 1 when something was done. */
export function pendingPump(s: Session): number {
  s.pendingQuiet = 0;
  if (s.pending.length === 0) return 0;
  const checked = msgSpells(s);
  if (checked === 1) return 1;
  const first = s.pending[0];
  if (checked !== -1 && first) {
    const text = first.text;
    const killsSelf = findNoCase(text, 0, 'suicide') !== -1 || findNoCase(text, 0, 'reroll') !== -1;
    if ((!text.startsWith('drop ') || s.cannotDropHere === 0) && !killsSelf) {
      if (
        first.checked === 0 &&
        text !== '\r' &&
        !text.startsWith('set ') &&
        !text.startsWith('drop ')
      ) {
        s.roomLookedAt = 0;
        s.lookDue = 1;
      }
      const out = first.expand === 0 ? text.slice(0, 299) : expandMacros(s, text);
      if (first.checked !== 0) {
        noteCommands(s, text);
        attackCommand(s, text);
      }
      if (s.pendingQuiet === 0) setState(s, State.PendingCmd);
      s.waitLines = 2;
      send(s, out);
      if (
        text.startsWith('/') &&
        (s.following !== 0 || s.partyLost !== 0 || s.holdingLeader !== 0)
      ) {
        const waitCmd = s.Party_PartyWaitCmd !== '' ? s.Party_PartyWaitCmd : '@wait';
        const isWait = findNoCase(text, 0, waitCmd) !== -1;
        const isComeback = findNoCase(text, 0, '@comeback') !== -1;
        if (!isWait && !isComeback) {
          const okCmd = s.Party_PartyResumeCmd !== '' ? s.Party_PartyResumeCmd : '@ok';
          if (findNoCase(text, 0, okCmd) !== -1) {
            s.lastResumeSent = out.slice(0, 299);
            s.okSentAt = s.now;
            s.holdingLeader = 0;
          }
        } else {
          s.lastWaitSent = out.slice(0, 299);
          s.waitSentAt = s.now;
          if (isWait) s.holdingLeader = 1;
        }
      }
      if (first.checked === 0) s.host.echo?.(out.split('\r')[0] ?? out);
    }
    s.pending.shift();
    return 1;
  }
  // A spell waiting for its round holds the list (-1), as `0x48ad60` does.
  return 0;
}

/** `0x48b270`: `n` characters of the first pending command sent; the whole of it, and it goes. */
function consumePending(s: Session, n: number): void {
  const first = s.pending[0];
  if (!first) return;
  if (first.text.length <= n) s.pending.shift();
  else first.text = first.text.slice(n);
}

/** `0x48b370`'s waiting spell given up. */
function noWaitingSpell(s: Session): void {
  s.waitingSpell = '';
  s.waitingSpellTarget = '';
  s.waitingSpellAt = 0;
  s.waitingSpellTargeted = 0;
}

/** A blank, as `0x48b370` skips them. */
function blank(c: string | undefined): boolean {
  return c === ' ' || c === '\t';
}

/**
 * `0x48b370`: the first pending command, when it came from the player or a
 * message (checked) and message spell processing is on, sent a part at a
 * time — each up to `\r` or `^M`. A part that is a spell's short name (one
 * cast by itself, not from an item) and a target is cast through the round
 * timer (`castSpell`), into the cast state MegaMUD's own casts use: one too
 * soon waits in the list (-1) until its round, or five seconds; a target
 * gone or changed meanwhile, or never here, drops the command. Other parts
 * are sent as they are. 1 when something was sent, 0 when the list is left
 * to the pump, -1 to hold it.
 */
function msgSpells(s: Session): number {
  let sent = false;
  let lastText: string | null = null;
  for (;;) {
    const first = s.pending[0];
    if (!first || first.text === '') return sent ? 1 : 0;
    if (first.checked === 0 || (s.Other_DisableMsgSpellProcessing !== 0 && first.tag === 0))
      return sent ? 1 : 0;
    const text = first.text;
    if (text === lastText) {
      if (s.debug !== 0) s.host.trace('{pending-no-progress}');
      return sent ? 1 : 0;
    }
    lastText = text;
    let end = 0;
    while (end < text.length && text[end] !== '\r' && !(text[end] === '^' && text[end + 1] === 'M'))
      end += 1;
    const piece = end + (end < text.length ? (text[end] === '\r' ? 1 : 2) : 0);
    if (piece <= 0) return sent ? 1 : 0;
    if (piece >= 300) {
      if (s.debug !== 0) s.host.trace(`{pending-oversize:${piece}}`);
      consumePending(s, piece);
      if (sent) return 1;
      continue;
    }

    // A spell's short name, six characters down to three, then its target.
    let start = 0;
    while (start < end && blank(text[start])) start += 1;
    let spell: SpellRec | null = null;
    let target = '';
    for (let len = 6; len >= 3; len -= 1) {
      const at = start + len;
      if (at > end || (at < end && !blank(text[at]))) continue;
      const found = findSpell(s, text.slice(start, at));
      if (!found || found.item !== '') continue;
      let from = at;
      while (from < end && blank(text[from])) from += 1;
      let to = end;
      while (to > from && blank(text[to - 1])) to -= 1;
      if (to - from >= 200) continue;
      spell = found;
      target = text.slice(from, to);
      break;
    }
    if (!sent && spell === null && text.length <= piece) return 0;

    let waitedOut = false;
    if (spell !== null) {
      const short = spell.short;
      const area = (spell.flags & SpellFlag.Area) !== 0 ? 1 : 0;
      const takes = spellTakesTarget(spell);
      const waiting = s.waitingSpell !== '' && stricmp(s.waitingSpell, short) === 0;
      if (waiting && s.waitingSpellTarget !== '') {
        const e = findEntity(s, s.waitingSpellTarget, 0);
        const changed = takes !== 0 && area === 0 && s.waitingSpellTargeted === 0;
        if (!e || changed) {
          s.host.show(e ? `[${short}: target changed]` : `[${short}: target gone]`);
          consumePending(s, text.length);
          noWaitingSpell(s);
          return 1;
        }
      }
      if (
        (spell.flags & (SpellFlag.Self | SpellFlag.Area)) === 0 &&
        (target === '' || !findEntity(s, target, 0))
      ) {
        s.host.show(
          target === '' ? `[${short}: target not found]` : `[${short}: ${target} not found]`
        );
        consumePending(s, text.length);
        noWaitingSpell(s);
        return 1;
      }
      if (waiting && s.waitingSpellAt !== 0 && s.now - s.waitingSpellAt > 5) {
        noWaitingSpell(s);
        if (s.debug !== 0) s.host.trace(`{${short}:X}`);
        if (!sent) return 0;
        waitedOut = true;
      } else {
        if (castSpell(s, short, target === '' ? null : target) === 0) {
          if (!waiting) {
            s.waitingSpell = short.slice(0, 7);
            s.waitingSpellAt = s.now;
            s.waitingSpellTarget = '';
            s.waitingSpellTargeted = 0;
            if (target !== '' && findEntity(s, target, 0)) {
              s.waitingSpellTarget = target.slice(0, 199);
              s.waitingSpellTargeted = 1;
            }
          }
          if (s.debug !== 0 && s.now - s.waitingSpellAt > 0)
            s.host.trace(`{${short}:${s.now - s.waitingSpellAt}s}`);
          return sent ? 1 : -1;
        }
        if (takes === 0) {
          if (s.pendingQuiet === 0) setState(s, State.PendingCmd);
        } else {
          s.engagedMode = State.Nothing;
          s.lastCast = short.slice(0, 0x50);
          const mode = castMode(s, short);
          if (s.debug !== 0) s.host.trace('{I14+}');
          s.combatOffExpected = 1;
          resetNoMessage(s, mode);
          if (target === '' || area !== 0) {
            s.target = '';
            s.multiAttacking = 1;
          } else {
            setTarget(s, target);
          }
          setState(s, mode);
          s.pendingQuiet = mode;
        }
        noWaitingSpell(s);
        consumePending(s, piece);
        sent = true;
        continue;
      }
    }

    // A part that is not a spell, or one whose wait ran out: sent as it is.
    const part = text.slice(0, piece);
    const out = first.expand === 0 ? part : expandMacros(s, part);
    noteCommands(s, part);
    s.waitLines = 2;
    attackCommand(s, part);
    if (s.pendingQuiet === 0) setState(s, State.PendingCmd);
    send(s, out);
    consumePending(s, piece);
    if (waitedOut || !sent) return 1;
  }
}

/** Which of the combat tab's spells this is, as the cast state names it: else the player's own (`State.CastUser`). */
function castMode(s: Session, short: string): number {
  if (stricmp(short, s.Combat_MultAttack) === 0) {
    s.castsMulti = 0;
    s.engagedMode = State.CastMulti;
    return State.CastMulti;
  }
  if (stricmp(short, s.Combat_PreMultAttack) === 0) {
    s.castsPreMulti = 0;
    s.engagedMode = State.CastPreMulti;
    return State.CastPreMulti;
  }
  if (stricmp(short, s.Combat_PreAttack) === 0) {
    s.castsPre = 0;
    s.engagedMode = State.CastPre;
    return State.CastPre;
  }
  if (stricmp(short, s.Combat_AttackSpl2) === 0) {
    s.castsAux = 0;
    s.engagedMode = State.CastAux;
    return State.CastAux;
  }
  if (stricmp(short, s.Combat_AttackSpl) === 0) {
    s.castsMain = 0;
    s.engagedMode = State.CastMain;
    return State.CastMain;
  }
  s.castsUser = 0;
  s.userSpell = short.slice(0, 10);
  return State.CastUser;
}

/**
 * `0x48bce0`: a command sent from the list that attacks — `attack` (or any
 * abbreviation), `aa`, `smash`, `bash` (not at a door), `punch`, `jumpkick`,
 * `kick` — at something in the room starts a fight on it (state `0x11`).
 * Not with `Other.DisableMsgEquipProcessing`. 1 when it did.
 */
export function attackCommand(s: Session, text: string): number {
  if (text === '' || s.Other_DisableMsgEquipProcessing !== 0 || text.length >= 300) return 0;
  const line = text.replace(/[\r\n \t]+$/, '');
  if (line === '') return 0;
  const [first, rest] = splitWord(line, ' ', 0x1f);
  const [second] = splitWord(rest, ' ', 0x1f);
  const verb = first.toLowerCase();
  const what = second.toLowerCase();
  const attacks =
    abbrev('attack', verb, 1) !== 0 ||
    verb === 'aa' ||
    verb === 'smash' ||
    (verb === 'bash' && typedDirection(what) === -1) ||
    abbrev('punch', verb, 2) !== 0 ||
    abbrev('jumpkick', verb, 2) !== 0 ||
    abbrev('kick', verb, 3) !== 0;
  if (!attacks || what === '' || !findEntity(s, what, 0)) return 0;
  s.engagedMode = State.Attacking;
  s.combatOffExpected = 1;
  if (s.debug !== 0) s.host.trace('{I15+}');
  setTarget(s, what);
  rememberTarget(s);
  setState(s, State.Attacking);
  s.pendingQuiet = State.Attacking;
  return 1;
}

/**
 * `0x4acc40`: one of a text's `||` alternatives at random, with `{userid}`,
 * `{pswd}` (only while logging on, task 10 or below), `{source}`,
 * `{target}` (else the first thing in the room), `{dmg}` and `{1}`–`{5}`
 * put in, `~` a half-second pause (`\x01`, unless `0x327a4` is 99), and
 * `^x` the control character (`^M` a return). Kept as the exe has them: an
 * empty `{userid}` or `{pswd}`, or a `^` at the end, cut the text there;
 * `{target}` with nothing to put in leaves its `{`; and `^^` and `^~` also
 * swallow the character after them.
 */
export function expandMacros(s: Session, text: string): string {
  const alts = alternatives(text);
  if (alts.length > 1) text = alts[rand(s) % alts.length]!;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    let next = i;
    if (c === '{' && text.startsWith('{userid}', i)) {
      if (s.BBS_UserID === '') break;
      out += s.BBS_UserID;
      next = i + 7;
    } else if (c === '{' && text.startsWith('{pswd}', i)) {
      if (s.BBS_Password === '' || s.task > Task.LoggingOn) break;
      out += s.BBS_Password;
      next = i + 5;
    } else if (c === '{' && text.startsWith('{source}', i)) {
      out += s.msgSource;
      next = i + 7;
    } else if (c === '{' && text.startsWith('{target}', i)) {
      const target = s.msgTarget !== '' ? s.msgTarget : s.target;
      if (target !== '') out += target;
      else if (s.room.length > 0) out += s.room[0]!.name;
      else out += c;
      next = i + 7;
    } else if (c === '{' && text.startsWith('{dmg}', i)) {
      out += String(s.msgDamage);
      next = i + 4;
    } else if (c === '{' && /^\{[1-5]\}/.test(text.slice(i, i + 3))) {
      out += s.msgArgs[Number(text[i + 1]) - 1] ?? '';
      next = i + 2;
    } else if (c === '~') {
      out += s.tildeMode !== 99 ? '\x01' : c;
    } else if (c === '^') {
      const d = text[i + 1];
      if (d === undefined) break;
      if (d === '^' || d === '~') {
        out += d;
        next = i + 2;
      } else {
        out += String.fromCharCode((d.charCodeAt(0) - 0x40) & 0xff);
        next = i + 1;
      }
    } else {
      out += c;
    }
    i = next + 1;
  }
  return out;
}

/** C's `rand()`, 0 to 32767: the host's, else `Math.random`. */
export function rand(s: Session): number {
  return s.host.rand?.() ?? Math.floor(Math.random() * 0x8000);
}

/** `0x4ad5f0`: a text's alternatives, `||` between them. */
function alternatives(text: string): string[] {
  return text === '' ? [] : text.split('||');
}

/**
 * `0x4ad7c0`: a text as plain words: one of its alternatives at random, each
 * `{userid}`, `{pswd}`, `{source}`, `{target}`, `{dmg}` and `{1}`–`{5}` cut to
 * its `{`, `~` dropped (unless `0x327a4` is 99), `^M` a carriage return and
 * any other `^x` dropped.
 */
export function plainText(s: Session, text: string): string {
  const alts = alternatives(text);
  if (alts.length > 1) {
    text = alts[rand(s) % alts.length]!;
  }
  const tokens = [
    '{userid}',
    '{pswd}',
    '{source}',
    '{target}',
    '{dmg}',
    '{1}',
    '{2}',
    '{3}',
    '{4}',
    '{5}'
  ];
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === '{') {
      const token = tokens.find((k) => text.startsWith(k, i));
      out += c;
      if (token) i += token.length - 1;
    } else if (c === '~') {
      if (s.tildeMode === 99) out += c;
    } else if (c === '^') {
      i += 1;
      if (text[i] === 'M') out += '\r';
    } else {
      out += c;
    }
  }
  return out;
}

/** The length of an equip verb at `at` (`eq`, `equ`, `equi`, `equip`, `wea`, `wear`), or 0. */
function equipVerb(text: string, at: number, end: number): number {
  const c = (i: number): string => (at + i < end ? text[at + i]!.toLowerCase() : '');
  if (c(0) === 'e' && c(1) === 'q') {
    if (c(2) !== 'u') return 2;
    if (c(3) !== 'i') return 3;
    return c(4) === 'p' ? 5 : 4;
  }
  if (at + 3 <= end && c(0) === 'w' && c(1) === 'e' && c(2) === 'a') return c(3) === 'r' ? 4 : 3;
  return 0;
}

/**
 * `0x47a540`: what MegaMUD is about to send, read for what it will do. Its
 * commands (split on `\r` or `^M`) are prompts to wait for; the equip
 * commands among them (`eq`, `equip`, `wear` and the like, with an argument
 * and no `^`) are the "Mass Equip" count. 1 when it holds an equip.
 */
export function noteCommands(s: Session, text: string): number {
  if (text === '' || s.Other_DisableMsgEquipProcessing !== 0) return 0;
  const n = text.length;
  let commands = 0;
  let equips = 0;
  let i = 0;
  for (;;) {
    let end = i;
    while (
      end < n &&
      text[end] !== '\r' &&
      !(text[end] === '^' && end + 1 < n && text[end + 1] === 'M')
    )
      end += 1;
    const term = end < n ? (text[end] === '\r' ? 1 : 2) : 0;
    let p = i;
    if (end < n || p < end) {
      commands += 1;
      while (p < end && (text[p] === ' ' || text[p] === '\t')) p += 1;
    }
    if (p + 2 <= end) {
      const verb = equipVerb(text, p, end);
      if (verb > 0) {
        let q = p + verb;
        if (q < end && (text[q] === ' ' || text[q] === '\t')) {
          while (q < end && (text[q] === ' ' || text[q] === '\t')) q += 1;
          if (q < end && !text.slice(q, end).includes('^')) equips += 1;
        }
      }
    }
    if (end >= n) break;
    i = end + term;
    if (i >= n) break;
  }
  if (commands >= 2) s.waitPrompt += commands;
  if (equips === 0) return 0;
  if (commands < 2) s.waitPrompt += commands;
  s.equipsPending += equips;
  s.lineFlags &= ~LineFlag.Prompted;
  return 1;
}
