/**
 * Sending: straight to the socket (`0x42d9f0`), or onto the pending list
 * (`0x48ab80`) that the scheduler drains one command a pass (`0x48ad60`).
 * Read 2026-10-12.
 *
 * MegaMUD watches what it sends: the same command sent 20 times running,
 * while in the game, resets its waits ("[reset]"), and 40 times resets harder
 * ("[reset+]"). A bare Enter or `par` neither counts nor breaks the run.
 */
import { findNoCase, strcmp } from '../cstr';
import type { Session } from '../Session';
import { unported } from '../unported';
import { setState } from './state';

/** One pending command (`0x5c6d40`, `0x5c76a0`, `0x5c7380`, `0x5c7060`). */
export interface Pending {
  text: string;
  /** Expand macros (`{target}` and the rest, `0x4acc40`) when it is sent. */
  expand: number;
  /** It came from the player or a remote, and is checked against its target (`0x48b370`). */
  checked: number;
  /** `0x240c` when it was queued. */
  tag: number;
}

/** `0x42d9f0`: send `text` now. Returns 1. */
export function send(s: Session, text: string): number {
  s.f_2410 = 0;
  if (text !== '\r' && text !== 'par\r') {
    s.f_db8c = 0;
    s.f_db88 = 0;
  }
  if (s.f_2408 === 0) {
    if (s.f_e57c === 0 && s.inGame !== 0) {
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
    s.f_2408 = 0;
  }
  s.f_322a0 = s.now;
  s.host.write(text);
  if (s.f_30e14 < 1) {
    if (s.Display_ShowSend !== 0 && s.task > 10) s.host.echo?.(text);
  } else {
    s.f_30e14 -= 1;
  }
  return 1;
}

function resetWaits(s: Session, harder: boolean): void {
  if (harder) unported('48b180');
  unported('40a6c0');
  unported(harder ? '40ad70' : '40a9c0');
  s.f_e29c = 1;
  s.f_e2ac = 1;
  s.f_8468 = 0;
  s.f_32348 = 0;
  s.f_32390 = 0;
  s.f_e290 = 1;
  s.lineFlags |= 1;
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
    s.lineFlags |= 1;
    return 1;
  }
  s.pending.push({ text, expand, checked, tag: s.f_240c });
  s.lineFlags |= 1;
  return 1;
}

/** `0x48ad60`: send the first pending command. 1 when something was done. */
export function pendingPump(s: Session): number {
  s.pendingQuiet = 0;
  const first = s.pending[0];
  if (!first) return 0;
  const checked = unported('48b370');
  if (checked === 1) return 1;
  if (checked !== -1 && s.pending.length > 0) {
    const text = first.text;
    const killsSelf = findNoCase(text, 0, 'suicide') !== -1 || findNoCase(text, 0, 'reroll') !== -1;
    if ((!text.startsWith('drop ') || s.f_e1e0 === 0) && !killsSelf) {
      if (
        first.checked === 0 &&
        text !== '\r' &&
        !text.startsWith('set ') &&
        !text.startsWith('drop ')
      ) {
        s.f_32390 = 0;
        s.f_e290 = 1;
      }
      const out = first.expand === 0 ? text.slice(0, 299) : expandMacros(s, text);
      if (first.checked !== 0) {
        unported('47a540');
        unported('48bce0');
      }
      if (s.pendingQuiet === 0) setState(s, 0x2d);
      s.waitLines = 2;
      send(s, out);
      if (text.startsWith('/') && (s.following !== 0 || s.f_e2ec !== 0 || s.holdingLeader !== 0)) {
        const waitCmd = s.Party_PartyWaitCmd !== '' ? s.Party_PartyWaitCmd : '@wait';
        const isWait = findNoCase(text, 0, waitCmd) !== -1;
        const isComeback = findNoCase(text, 0, '@comeback') !== -1;
        if (!isWait && !isComeback) {
          const okCmd = s.Party_PartyResumeCmd !== '' ? s.Party_PartyResumeCmd : '@ok';
          if (findNoCase(text, 0, okCmd) !== -1) {
            s.lastResumeSent = out.slice(0, 299);
            s.f_32340 = s.now;
            s.holdingLeader = 0;
          }
        } else {
          s.lastWaitSent = out.slice(0, 299);
          s.f_32338 = s.now;
          if (isWait) s.holdingLeader = 1;
        }
      }
      if (first.checked === 0) s.host.echo?.(out.split('\r')[0] ?? out);
    }
  }
  s.pending.shift();
  return 1;
}

/** `0x4acc40`: `{userid}`, `{pswd}`, `{source}`, `{target}`, `{dmg}`. Not ported yet. */
export function expandMacros(_s: Session, text: string): string {
  unported('4acc40');
  return text.slice(0, 299);
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
  s.f_a5f8 += equips;
  s.lineFlags &= ~1;
  return 1;
}
