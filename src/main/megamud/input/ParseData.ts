/**
 * Framing the server's characters into lines, as `ParseData` (`0x479630`)
 * does, each character keeping the colour it was drawn in.
 *
 * MegaMUD's handlers test colours: `Also here:` counts only in magenta or
 * green, a name in white or cyan is a player. So the line buffer holds two
 * strings: the text (`0x105aa`) and, beside it, the terminal's attribute byte
 * for each character (`0x205ab`), as `0x4170a0` reads it at the moment the
 * character is drawn. The attribute is `0x4183a0`'s: foreground in bits 0–2,
 * bold as bit 3, background in bits 4–6, reverse as bit 7; SGR 0 makes it 7.
 * A character drawn with attribute 0 is stored as 7.
 *
 * Read 2026-10-12. What is left out:
 * - the terminal itself (drawing, cursor moves, `ESC[K`): the display is ours;
 * - `ESC[6n`, which MegaMUD answers with the cursor position: our
 *   `terminal-queries` already answers it;
 * - the plugin hook `0x48f690`, which has no plugins to call.
 */
import { enemiesHere } from '../room/entities';
import { inAttackCast } from '../combat/casts';
import { runCheck } from '../script/run';
import { schedule } from '../script/scheduler';
import type { Session } from '../Session';
import { refreshStatus } from '../status';
import { dispatchLine } from './dispatch';
import { listingTimeouts } from './listings';
import { State } from '../states';
import { LineFlag, PROMPT_SEEN } from '../flags';
import { Task } from '../script/task';

/** The escape parser's state and parameters (`0x30db0`–`0x30dc0`) and the attribute. */
export interface TerminalState {
  /** 0x30db0: 0 not in an escape, 1 after ESC, 2 after `[`, 3–6 reading parameters. */
  escape: number;
  /** 0x30db4–0x30dc0: up to four numeric parameters, -1 when absent. */
  params: [number, number, number, number];
  /** The terminal's current attribute byte (its window's `+0x60`). */
  attr: number;
}

export function newTerminal(): TerminalState {
  return { escape: 0, params: [-1, -1, -1, -1], attr: 7 };
}

/** `0x4183a0`: one SGR parameter applied to the attribute. */
export function applySgr(attr: number, code: number): number {
  switch (code) {
    case 0:
      return 7;
    case 1:
      return attr | 8;
    case 7:
      return attr | 0x80;
    case 8:
      return (((attr >> 4) ^ attr) & 7) ^ attr;
    default:
      if (code >= 0x1e && code <= 0x25) return ((code - 0x1e) | (attr & 0xf8)) & 0xff;
      if (code >= 0x28 && code <= 0x2f) return (((code - 8) * 0x10) | (attr & 0x8f)) & 0xff;
      return attr;
  }
}

/**
 * `0x4789d0`: one character of an escape sequence. True when the character
 * belonged to the sequence (and is not drawn).
 */
export function escapeChar(t: TerminalState, s: Session, ch: number): boolean {
  if (ch === 0x1b) {
    t.escape = 1;
    return true;
  }
  if (ch === 0x5b) {
    t.escape = 2;
    return true;
  }
  const digit = ch - 0x30 >= 0 && ch - 0x30 < 10;
  switch (t.escape) {
    case 0:
      t.escape = 1;
      if (ch !== 0x2b) return true;
      t.escape = 0x5a;
      return true;
    case 1:
      // ESC D / ESC M scroll the terminal; nothing the engine keeps.
      if (ch === 0x44 || ch === 0x4d) {
        t.escape = 0;
        return true;
      }
      t.escape = 0;
      return false;
    case 2:
      t.params = [-1, -1, -1, -1];
      if (ch === 0x3f) {
        t.params[0] = 0;
        t.escape = 3;
        return true;
      }
      if (digit) {
        t.escape = 3;
        t.params[0] = ch - 0x30;
        return true;
      }
      break;
    case 3:
    case 4:
    case 5:
    case 6: {
      const i = t.escape - 3;
      if (digit) {
        t.params[i] = ch + t.params[i]! * 10 - 0x30;
        return true;
      }
      if (ch === 0x3b && t.escape < 6) {
        t.params[i + 1] = 0;
        t.escape += 1;
        return true;
      }
      break;
    }
    default:
      if (ch === 0x2b) {
        t.escape += 1;
        return t.escape > 0x5b;
      }
      t.escape = 0;
      return false;
  }
  // The final character.
  switch (ch) {
    case 0x41:
    case 0x42:
    case 0x43:
    case 0x44:
    case 0x48:
    case 0x66:
    case 0x4a:
    case 0x4b:
    case 0x52:
    case 0x68:
    case 0x6c:
    case 0x6e:
    case 0x72:
    case 0x73:
    case 0x75:
      // Cursor and screen controls: the terminal's, not the engine's.
      break;
    case 0x6d:
      for (const p of t.params) if (p !== -1) t.attr = applySgr(t.attr, p);
      break;
    default:
      t.escape = 0;
      return false;
  }
  t.escape = 0;
  return true;
}

/**
 * `0x479630`: what one chunk of received text does. Each character is drawn
 * (or taken by the escape parser), whole lines go to the dispatcher, the
 * partial line left over goes to it too (that is how a prompt, which has no
 * line end, is read), and then, when nothing is left over and a prompt has
 * been seen, the scheduler runs. Returns 1, as the C does.
 */
export function parseData(s: Session, t: TerminalState, chunk: string): number {
  listingTimeouts(s);
  for (let i = 0; i < chunk.length; i += 1) {
    const ch = chunk.charCodeAt(i) & 0xff;
    if (t.escape !== 0 && escapeChar(t, s, ch)) continue;
    switch (ch) {
      case 7:
        // A bell: MegaMUD beeps.
        break;
      case 8:
        if (s.line.text.length > 0) {
          s.line.text = s.line.text.slice(0, -1);
          s.line.attr.pop();
        }
        break;
      case 10:
      case 13:
        if (ch !== 10) break;
        s.lineFlags &= ~PROMPT_SEEN;
        dispatchLine(s, s.line, 1, 0);
        s.line = { text: '', attr: [] };
        s.lineFlags &= ~PROMPT_SEEN;
        refreshStatus(s);
        break;
      case 0x1b:
        escapeChar(t, s, ch);
        break;
      default:
        if (s.line.text.length < 0x10000) {
          s.line.text += String.fromCharCode(ch);
          s.line.attr.push(t.attr === 0 ? 7 : t.attr);
        } else {
          s.host.trace('[ParseData: line exceeded line-buffer capacity]');
        }
    }
  }
  if (dispatchLine(s, s.line, 0, 0) !== 0) s.line = { text: '', attr: [] };
  if (s.line.text.length === 0) {
    if ((s.lineFlags & LineFlag.Prompted) !== 0) {
      schedule(s);
      return 1;
    }
    if (
      s.lineRunChecked === 0 &&
      s.unknown_e57c === 0 &&
      s.equipsPending === 0 &&
      s.waitLines < 2 &&
      s.inGame !== 0 &&
      s.online !== 0 &&
      s.allOff === 0 &&
      s.attackDue !== 0 &&
      (s.inCombat !== 0 || enemiesHere(s, 0) > 0) &&
      (s.multiAttacking === 0 || s.inCombat !== 0) &&
      s.task !== Task.Exiting &&
      (s.state === State.Nothing || inAttackCast(s, 0) !== 0 || s.state === State.Attacking) &&
      runCheck(s) !== 0
    ) {
      if (s.debug !== 0) s.host.trace(`{D${s.state}${''}${0}!!}`);
      s.lineRunChecked = 1;
    }
  }
  return 1;
}
