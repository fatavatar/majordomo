/**
 * The ability monitors (MegaMUD's "Event Details"), read 2026-10-12. Each
 * watches one ability's value (`abil N`, or the player's own `abil` lines)
 * and, when it compares to a set value, casts a spell or sends a command.
 * Monitors run in chains: a monitor chained to the one before it is checked
 * with it, and one firing can have its chain checked again.
 *
 * A check is due every so often, around rests and meditations, after a
 * spell, or on a line; the scheduler (`0x403c70`) asks `abil N` for the
 * earliest due, the reply (`Damage(1) 12`, or parts after `granted:`,
 * `worn:`, `spells:`, `race:`, `class:`) is read line by line (`0x4045b0`)
 * and judged at the prompt (`0x403280`). A second chained monitor of the
 * same ability reuses a reply read within two seconds. Three asks without
 * a reply, or `Ability N not found`, suspend a monitor.
 *
 * Their settings are the character's `[AbilMon]` (`0x404140`); the settings
 * window that edits them is left out.
 */
import { atoi, indexOf, stricmp } from '../cstr';
import type { AbilityMonitor, Session } from '../Session';
import { newMonitor } from '../Session';
import { expandMacros, queueCommand, send } from '../script/send';
import { setState } from '../script/state';
import { findSpell } from '../spells/lookup';

/** The parts an `abil` reply can give, after the total (the table at `0x55f01c`). */
const PARTS = ['', 'granted:', 'worn:', 'spells:', 'race:', 'class:'];

function live(m: AbilityMonitor): boolean {
  return m.disabled === 0 && m.state !== 2;
}

/** `0x4012c0`: the first monitor of `i`'s chain. */
function chainStart(s: Session, i: number): number {
  while (i > 0 && s.monitors[i]!.chained !== 0) i -= 1;
  return i;
}

/** `0x401280`: the last monitor of `i`'s chain. */
function chainEnd(s: Session, i: number): number {
  while (i < s.monitors.length - 1 && s.monitors[i + 1]!.chained !== 0) i += 1;
  return i;
}

/** `0x4014d0`: when anything in `i`'s chain is checked. */
function chainWhen(s: Session, i: number): number {
  let when = 0;
  for (let j = chainStart(s, i); j <= chainEnd(s, i); j += 1) when |= s.monitors[j]!.when;
  return when;
}

/** `0x401300`: something in `i`'s chain is urgent. */
function chainUrgent(s: Session, i: number): boolean {
  for (let j = chainStart(s, i); j <= chainEnd(s, i); j += 1) {
    const m = s.monitors[j]!;
    if (live(m) && m.urgent !== 0) return true;
  }
  return false;
}

/** `0x401220`: one before `i` in its chain is due or being checked. */
function earlierBusy(s: Session, i: number): boolean {
  for (let j = chainStart(s, i); j < i; j += 1) {
    const m = s.monitors[j]!;
    if (live(m) && (m.due !== 0 || m.state !== 0)) return true;
  }
  return false;
}

/** `0x401460`: another in `i`'s chain is due or being checked. */
function otherBusy(s: Session, i: number): boolean {
  for (let j = chainStart(s, i); j <= chainEnd(s, i); j += 1) {
    const m = s.monitors[j]!;
    if (j !== i && live(m) && (m.due !== 0 || m.state !== 0)) return true;
  }
  return false;
}

/** `0x401170`: the last reply is not to be reused. */
function forgetReply(s: Session): void {
  s.lastAbil.valid = 0;
}

/** `0x401360`: `i`'s chain is due a check (`byChain`: because the chain fired). */
function markDue(s: Session, i: number, byChain: number): void {
  const start = chainStart(s, i);
  const end = chainEnd(s, i);
  const last = s.lastAbil.monitor;
  if (s.lastAbil.valid !== 0 && last >= 0 && last < s.monitors.length) {
    if (chainStart(s, last) === start) forgetReply(s);
  }
  for (let j = start; j <= end; j += 1) {
    const m = s.monitors[j]!;
    if (!live(m)) continue;
    m.due = 1;
    m.dueAt = s.now;
    if (byChain !== 0) m.byChain = 1;
  }
}

/** `0x401190`: the last reply is for `i`'s ability, read for one before it in its chain under two seconds ago. */
function replyFresh(s: Session, i: number): boolean {
  const last = s.lastAbil;
  if (last.valid === 0 || last.monitor < 0 || last.monitor >= s.monitors.length) return false;
  if (s.monitors[i]!.ability !== last.ability || last.monitor >= i) return false;
  if (chainStart(s, i) !== chainStart(s, last.monitor)) return false;
  return s.host.tickMs() - last.at < 0x7d1;
}

/** `0x4036e0`: the monitors cannot act (switched off, all-off, dead, or not in the game). */
function cannotAct(s: Session): boolean {
  return !(
    s.MegaMud_DisableAbilMon === 0 &&
    s.f_a32c === 0 &&
    s.hp > 0 &&
    s.online !== 0 &&
    s.inGame !== 0
  );
}

/** `0x402f00`: why the monitors were not checked. */
function blocked(s: Session, why: number): void {
  if (s.monitorBlocked === why) return;
  s.monitorBlocked = why;
  if (why !== 0 && s.debug !== 0) s.host.trace(`{am-b${why}}`);
}

/** `0x403a00`: the value a monitor tests, from a reply's values (`parts`: given separately). */
function valueOf(s: Session, m: AbilityMonitor, values: number[], parts: number): number {
  if (parts !== 0) {
    if (m.part !== 0) return values[m.part]!;
    return values[1]! + values[2]! + values[3]! + values[4]! + values[5]!;
  }
  if (m.part === 0 || values[0] === 0) return values[0]!;
  if (m.warnedPart === 0) {
    m.warnedPart = 1;
    s.host.show(
      `[Ability monitor: ability ${m.ability} reports no separate "${PARTS[m.part]!.slice(0, -1)}" value - testing its total instead]`
    );
  }
  return values[0]!;
}

/** `0x401750`: monitor `i`'s value read: fire when it compares. */
function judge(s: Session, i: number, value: number): void {
  const m = s.monitors[i]!;
  m.lastValue = value;
  if (s.debug !== 0) s.host.trace(`{am=${value}}`);
  const byChain = m.byChain;
  m.byChain = 0;
  m.state = 0;
  const fires =
    m.compare === 0 ? value < m.value : m.compare === 2 ? value > m.value : value === m.value;
  if (fires) fire(s, i);
  else if (byChain !== 0 && s.debug !== 0) s.host.trace('{am-ok}');
}

/** `0x401810`: monitor `i` fires: its spell or command, and perhaps its chain checked again. */
function fire(s: Session, i: number): void {
  if (cannotAct(s)) return;
  const m = s.monitors[i]!;
  if (s.debug !== 0) s.host.trace(`{am!${m.ability}}`);
  let cmd = m.command;
  if (m.useCommand === 0) {
    cmd = m.spell;
    const spell = findSpell(s, m.spell);
    if (spell && spell.item !== '') cmd = spell.item;
  }
  if (cmd === '') return;
  sendCommand(s, cmd, chainUrgent(s, i));
  if (m.chainOn !== 0) {
    if (s.debug !== 0 && chainStart(s, i) < chainEnd(s, i)) s.host.trace('{am-ch}');
    markDue(s, i, 1);
  }
}

/** `0x4032c0`: a monitor's command queued (ahead of the rest when urgent). */
function sendCommand(s: Session, cmd: string, urgent: boolean): void {
  let text = expandMacros(s, cmd);
  if (text === '') return;
  if (!text.endsWith('\r')) text += '\r';
  forgetReply(s);
  s.monitorQueuing = urgent ? 2 : 1;
  queueCommand(s, text, 1, 0, 1);
  s.monitorQueuing = 0;
}

/** `0x401520`: the asked-for reply is complete: its monitor judged, the reply kept for its chain. */
function replyDone(s: Session): void {
  const i = s.monitorAsked;
  s.abilAsking = 0;
  s.monitorAsked = -1;
  if (s.state === 0x2e) setState(s, 0);
  if (i < 0 || i >= s.monitors.length) return;
  const m = s.monitors[i]!;
  const value = valueOf(s, m, s.abilValues, s.abilParts);
  m.noReply = 0;
  s.lastAbil = {
    valid: 1,
    ability: m.ability,
    monitor: i,
    parts: s.abilParts,
    at: s.host.tickMs(),
    values: [...s.abilValues]
  };
  judge(s, i, value);
}

/** `0x403120`: an `abil` reply not asked for is complete: every monitor of its ability judged. */
function unaskedDone(s: Session): void {
  const ability = s.abilUnaskedNo;
  s.abilUnasked = 0;
  s.abilUnaskedNo = 0;
  if (cannotAct(s) || s.pending.length > 0) return;
  for (let i = 0; i < s.monitors.length; i += 1) {
    const m = s.monitors[i]!;
    if (!live(m) || m.ability !== ability) continue;
    if (chainStart(s, i) < chainEnd(s, i) || s.pending.length > 0) {
      markDue(s, i, 0);
      continue;
    }
    m.due = 0;
    if ((m.when & 1) !== 0 && m.byChain === 0) m.nextAt = s.now + Math.max(5, m.interval);
    if (s.debug !== 0) s.host.trace(`{am-p${m.ability}}`);
    judge(s, i, valueOf(s, m, s.abilValues, s.abilParts));
  }
}

/** `0x403280`: at the prompt, a reply read is complete. */
export function abilityPrompt(s: Session): void {
  if (s.abilAsking === 0) {
    if (s.abilUnasked !== 0 && s.abilGot !== 0) unaskedDone(s);
  } else if (s.abilGot !== 0) {
    replyDone(s);
  }
}

/** `0x403370`: no prompt came after the reply (or no reply came). */
export function abilTimedOut(s: Session): void {
  if (s.abilAsking === 0) {
    if (s.abilUnasked === 0) return;
    if (s.abilGot === 0) {
      s.abilUnasked = 0;
      s.abilUnaskedNo = 0;
      return;
    }
    unaskedDone(s);
    return;
  }
  if (s.abilGot !== 0) {
    replyDone(s);
    return;
  }
  const i = s.monitorAsked;
  s.abilAsking = 0;
  s.monitorAsked = -1;
  forgetReply(s);
  if (s.debug !== 0) s.host.trace('{am-x}');
  if (i < 0 || i >= s.monitors.length) return;
  const m = s.monitors[i]!;
  m.state = 0;
  m.byChain = 0;
  m.nextAt = s.now + 0x3c;
  m.noReply += 1;
  if (m.noReply > 2) {
    m.state = 2;
    s.host.show(`[Ability monitor: no reply to "abil ${m.ability}" - monitor suspended]`);
  }
}

/**
 * `0x402e80`: the monitors checked on `bit` are due: 4 after resting, 8 after
 * a combat round (`0x402f60`), 0x10 at the start of a path or loop
 * (`0x402f40`), 0x40 after meditating.
 */
export function dueOn(s: Session, bit: number): number {
  if (s.monitors.length === 0 || s.MegaMud_DisableAbilMon !== 0) return 0;
  let any = 0;
  for (let i = 0; i < s.monitors.length; i += 1) {
    const m = s.monitors[i]!;
    if (live(m) && (m.when & bit) !== 0) {
      markDue(s, i, 0);
      any = 1;
    }
  }
  return any;
}

/** `0x403980`: a chain checked on `bit` is still due or being checked. */
function stillGoing(s: Session, bit: number): number {
  for (let i = 0; i < s.monitors.length; i += 1) {
    const m = s.monitors[i]!;
    if (live(m) && (chainWhen(s, i) & bit) !== 0 && (m.due !== 0 || m.state !== 0)) return 1;
  }
  return 0;
}

/** `0x42e0e0`: wake the scheduler. */
function wake(s: Session): void {
  s.lineFlags |= 1;
  s.f_e544 = 4;
}

/**
 * `0x403720` (the one-second timer): a reply given up on after
 * `Comms.LagWait` + 12 seconds; the monitors checked after a rest or a
 * meditation, and the timed ones, made due; the scheduler woken for them.
 */
export function monitorTimer(s: Session): void {
  if (s.monitors.length === 0) return;
  let woke = false;
  if ((s.abilAsking !== 0 || s.abilUnasked !== 0) && s.abilWaitSince !== 0) {
    if (s.now - s.abilWaitSince >= s.Comms_LagWait + 0xc) {
      if (s.debug !== 0) s.host.trace('{am-to}');
      abilTimedOut(s);
      s.abilWaitSince = 0;
    }
  }
  if (s.resting !== s.monitorSawRest) {
    s.restMonitor.on = 0;
    if (s.resting === 0) woke = dueOn(s, 4) !== 0;
    s.monitorSawRest = s.resting;
  }
  if (s.meditating !== s.monitorSawMeditate) {
    s.meditateMonitor.on = 0;
    if (s.meditating === 0 && dueOn(s, 0x40) !== 0) woke = true;
    s.monitorSawMeditate = s.meditating;
  }
  for (let i = 0; i < s.monitors.length; i += 1) {
    const m = s.monitors[i]!;
    if (!live(m) || (m.when & 1) === 0) continue;
    if (m.nextAt === 0) {
      m.nextAt = s.now + Math.max(5, m.interval);
      markDue(s, i, 0);
      woke = true;
    } else if (m.nextAt <= s.now && m.due === 0 && m.state === 0 && !otherBusy(s, i)) {
      markDue(s, i, 0);
      woke = true;
    }
  }
  if (!woke && !s.monitors.some((m) => m.disabled === 0 && m.state === 0 && m.due !== 0)) return;
  if (
    s.MegaMud_DisableAbilMon === 0 &&
    s.f_a32c === 0 &&
    s.online !== 0 &&
    s.inGame !== 0 &&
    s.abilAsking === 0
  ) {
    wake(s);
  }
}

/**
 * `0x403c70` (the scheduler's D50): the earliest due monitor checked: its
 * value from a chained monitor's fresh reply, or `abil N` asked (no more than
 * once a second, unless chained).
 */
export function abilityMonitors(s: Session): number {
  let n = s.monitors.length;
  if (n === 0) return 0;
  const anyDue = s.monitors.some((m) => live(m) && m.due !== 0);
  if (cannotAct(s)) {
    if (anyDue) blocked(s, 6);
    return 0;
  }
  if (s.abilAsking !== 0 || s.abilUnasked !== 0 || s.pending.length > 0) {
    if (anyDue) blocked(s, s.abilAsking !== 0 ? 1 : s.abilUnasked !== 0 ? 2 : 3);
    return 0;
  }
  const askedThisSecond = s.now <= s.abilAskedAt;
  let lastIndex = -1;
  let lastAt = 0;
  while (n > 0) {
    let best = -1;
    let bm: AbilityMonitor | null = null;
    for (let j = 0; j < s.monitors.length; j += 1) {
      const m = s.monitors[j]!;
      if (!live(m) || m.due === 0 || m.state !== 0) continue;
      if (m.dueAt < lastAt || (m.dueAt === lastAt && j <= lastIndex)) continue;
      if (bm && m.dueAt >= bm.dueAt) continue;
      best = j;
      bm = m;
    }
    if (!bm) break;
    lastAt = bm.dueAt;
    if (earlierBusy(s, best)) {
      blocked(s, 4);
    } else if (!replyFresh(s, best)) {
      if (bm.byChain !== 0 || bm.chained !== 0 || !askedThisSecond) {
        blocked(s, 0);
        s.abilValues = [0, 0, 0, 0, 0, 0];
        s.abilGot = 0;
        s.abilParts = 0;
        s.monitorAsked = best;
        s.abilAsking = 1;
        s.abilAskedAt = s.now;
        s.abilWaitSince = s.now;
        bm.due = 0;
        bm.state = 1;
        if ((bm.when & 1) !== 0 && bm.byChain === 0) bm.nextAt = s.now + Math.max(5, bm.interval);
        s.waitLines = 2;
        setState(s, 0x2e);
        s.host.activity('Checking ability');
        if (s.debug !== 0) s.host.trace(`{am-q${bm.ability}}`);
        s.abilSending = 1;
        send(s, `abil ${bm.ability}\r`);
        s.abilSending = 0;
        return 1;
      }
      blocked(s, 5);
    } else {
      blocked(s, 0);
      bm.due = 0;
      if ((bm.when & 1) !== 0 && bm.byChain === 0) bm.nextAt = s.now + Math.max(5, bm.interval);
      if (s.debug !== 0) s.host.trace(`{am-r${bm.ability}}`);
      judge(s, best, valueOf(s, bm, s.lastAbil.values, s.lastAbil.parts));
      if (s.pending.length > 0) return 1;
    }
    n -= 1;
    lastIndex = best;
  }
  if (anyDue) return 0;
  blocked(s, 0);
  return 0;
}

/** `0x4018f0`: a monitor's urgent command is pending, or an urgent chain is due. */
export function monitorsWaiting(s: Session): number {
  if (s.monitors.length === 0 || s.MegaMud_DisableAbilMon !== 0 || s.f_a32c !== 0) return 0;
  if (s.pending.some((p) => p.tag === 2)) return 1;
  for (let i = 0; i < s.monitors.length; i += 1) {
    const m = s.monitors[i]!;
    if (live(m) && (m.due !== 0 || m.state !== 0) && chainUrgent(s, i)) return 1;
  }
  return 0;
}

/** `0x402f90`: a spell cast (by its name): the monitors casting it (`0x80`) are due. */
export function spellCastSeen(s: Session, name: string): void {
  if (s.monitors.length === 0 || s.MegaMud_DisableAbilMon !== 0) return;
  for (let i = 0; i < s.monitors.length; i += 1) {
    const m = s.monitors[i]!;
    if (!live(m) || (m.when & 0x80) === 0 || m.useCommand !== 0 || m.spell === '') continue;
    const spell = findSpell(s, m.spell);
    if (!spell || stricmp(spell.name, name) !== 0) continue;
    if (s.debug !== 0) s.host.trace('{am-sp}');
    markDue(s, i, 0);
  }
}

/** `0x403040`: `Name(N) value`: the ability and its value. */
function abilReply(text: string): [number, number] | null {
  const open = text.indexOf('(');
  if (open === -1) return null;
  const m = /^\((\d+)\) *(-?)(\d+)[ \r]*$/.exec(text.slice(open));
  if (!m) return null;
  const value = Number(m[3]) | 0;
  return [Number(m[1]) | 0, m[2] === '-' ? -value : value];
}

/**
 * `0x4045b0`: a line for the monitors: one starting with a monitor's message
 * makes it due; `Ability N not found` suspends the one asking; and a line of
 * an `abil` reply is read (one not asked for, when a monitor watches its
 * ability and nothing is pending).
 */
export function abilityLine(s: Session, line: string): number {
  if (s.monitors.length === 0) return 0;
  let seen = 0;
  if (s.MegaMud_DisableAbilMon === 0) {
    for (let i = 0; i < s.monitors.length; i += 1) {
      const m = s.monitors[i]!;
      if (!live(m) || (m.when & 0x100) === 0 || m.message === '') continue;
      if (!line.startsWith(m.message)) continue;
      if (s.debug !== 0) s.host.trace('{am-m}');
      markDue(s, i, 0);
      seen = 1;
    }
  }
  const asked = s.monitorAsked;
  if (
    s.abilAsking !== 0 &&
    asked >= 0 &&
    asked < s.monitors.length &&
    line.startsWith('Ability ') &&
    indexOf(line, ' not found') !== -1
  ) {
    const m = s.monitors[asked]!;
    if (atoi(line.slice(8)) !== m.ability) return seen;
    s.host.show(`[Ability monitor: ability ${m.ability} not found - monitor suspended]`);
    m.state = 2;
    m.byChain = 0;
    s.abilAsking = 0;
    s.monitorAsked = -1;
    forgetReply(s);
    if (s.state === 0x2e) setState(s, 0);
    return 1;
  }
  let part = PARTS.findIndex((p, k) => k > 0 && line.startsWith(p));
  let rest = line;
  if (part > 0) {
    rest = line.slice(PARTS[part]!.length).replace(/^ +/, '');
  } else {
    part = 0;
    if (!/^[A-Za-z]/.test(line)) return seen;
  }
  const reply = abilReply(rest);
  if (!reply) return seen;
  const [ability, value] = reply;
  if (s.abilAsking === 0) {
    if (s.abilUnasked === 0) {
      if (s.MegaMud_DisableAbilMon !== 0 || s.pending.length > 0) return seen;
      if (!s.monitors.some((m) => m.disabled === 0 && m.state !== 2 && m.ability === ability))
        return seen;
      s.abilValues = [0, 0, 0, 0, 0, 0];
      s.abilUnaskedNo = ability;
      s.abilParts = 0;
      s.abilUnasked = 1;
      s.abilWaitSince = s.now;
    } else if (ability !== s.abilUnaskedNo) {
      return seen;
    }
  } else {
    if (asked < 0 || asked >= s.monitors.length) return seen;
    if (ability !== s.monitors[asked]!.ability) return seen;
  }
  s.abilValues[part] = value;
  s.abilGot = 1;
  if (part !== 0) s.abilParts = 1;
  return 1;
}

/** `0x403480`: every monitor idle, nothing awaited. */
export function resetMonitors(s: Session): void {
  for (const m of s.monitors) {
    m.state = 0;
    m.due = 0;
    m.dueAt = 0;
    m.byChain = 0;
    m.nextAt = 0;
    m.noReply = 0;
    m.warnedPart = 0;
  }
  s.monitorAsked = -1;
  s.abilAsking = 0;
  s.abilUnasked = 0;
  s.abilUnaskedNo = 0;
  s.abilGot = 0;
  s.abilParts = 0;
  s.restMonitor = { on: 0, since: 0, checkedAt: 0 };
  s.meditateMonitor = { on: 0, since: 0, checkedAt: 0 };
  s.abilSending = 0;
  s.monitorQueuing = 0;
  s.abilWaitSince = 0;
  s.monitorBlocked = 0;
  forgetReply(s);
}

/** A number at the front of `text` (`0x4ad430`), and the text after it and one `:` (`0x4acb90`). */
function field(text: string): [number, string] {
  const m = /^ *(-?\d*)/.exec(text)!;
  const rest = text.slice(m[0].length);
  return [Number(m[1]) | 0, rest.startsWith(':') ? rest.slice(1) : rest];
}

/**
 * `0x404140`: the monitors from the character's `[AbilMon]` (`read` gives a
 * key's value, '' when missing): `MonitorN` is
 * `disabled:ability:part:compare:value:command?:when:interval:chainOn[:chained][:urgent]:spell:command`,
 * `MonitorNMsg` its message; read until a `MonitorN` is missing. An ability
 * below 0 is skipped.
 */
export function loadMonitors(s: Session, read: (key: string) => string): void {
  s.monitors = [];
  for (let n = 0; ; n += 1) {
    let text = read(`Monitor${n}`).slice(0, 0xff);
    if (text === '') break;
    const m = newMonitor();
    let v: number;
    [v, text] = field(text);
    m.disabled = v !== 0 ? 1 : 0;
    [m.ability, text] = field(text);
    [m.part, text] = field(text);
    [m.compare, text] = field(text);
    [m.value, text] = field(text);
    [m.useCommand, text] = field(text);
    [v, text] = field(text);
    m.when = v >>> 0;
    [m.interval, text] = field(text);
    [v, text] = field(text);
    m.chainOn = v !== 0 ? 1 : 0;
    // The two later fields are there only in newer settings: digits and a colon.
    if (/^\d+:/.test(text)) {
      [v, text] = field(text);
      m.chained = v !== 0 ? 1 : 0;
    }
    if (/^\d+:/.test(text)) {
      [v, text] = field(text);
      m.urgent = v !== 0 ? 1 : 0;
    }
    const colon = text.indexOf(':');
    m.spell = (colon === -1 ? text : text.slice(0, colon)).slice(0, 6);
    text = colon === -1 ? '' : text.slice(colon + 1);
    m.command = text.slice(0, 0x50);
    m.message = read(`Monitor${n}Msg`).slice(0, 0x50);
    m.part = Math.min(Math.max(m.part, 0), 5);
    m.compare = Math.min(Math.max(m.compare, 0), 2);
    m.useCommand = Math.min(Math.max(m.useCommand, 0), 1);
    let when = m.when & 0x1ff;
    if ((m.when & 1) !== 0) m.interval = Math.max(m.interval, 5);
    if (m.useCommand !== 0) when = m.when & 0x17f;
    if (m.message === '') when &= ~0x100;
    if (m.chained !== 0 && s.monitors.length > 0) when &= 0x180;
    m.when = when;
    if (m.ability >= 0) s.monitors.push(m);
  }
  resetMonitors(s);
  s.monitorsChanged = 0;
}

/** `0x4048f0`: the monitors as `[AbilMon]` keys. */
export function saveMonitors(s: Session): Record<string, string> {
  const out: Record<string, string> = {};
  s.monitors.forEach((m, n) => {
    const flag = (v: number): number => (v !== 0 ? 1 : 0);
    out[`Monitor${n}`] = [
      flag(m.disabled),
      m.ability,
      m.part,
      m.compare,
      m.value,
      m.useCommand,
      m.when >>> 0,
      m.interval,
      flag(m.chainOn),
      flag(m.chained),
      flag(m.urgent),
      m.spell,
      m.command
    ].join(':');
    if (m.message !== '') out[`Monitor${n}Msg`] = m.message;
  });
  s.monitorsChanged = 0;
  return out;
}

/**
 * `0x401000`: hold off for the ability monitors flagged `bit` (2 rest, 0x20
 * meditate) that act before it: started when one does (`0x402e80`), and
 * holding for up to 20 seconds while one is still going (`0x403980`); a gap
 * over three seconds between checks lets one that has stopped end the hold.
 */
function monitorHold(
  s: Session,
  bit: number,
  gate: { on: number; since: number; checkedAt: number }
): number {
  const t = s.host.tickMs();
  if (s.monitors.length === 0 || s.MegaMud_DisableAbilMon !== 0 || s.f_a32c !== 0) return 0;
  if (gate.on !== 0 && t - gate.checkedAt > 3000 && stillGoing(s, bit) === 0) gate.on = 0;
  gate.checkedAt = t;
  if (gate.on === 0) {
    if (dueOn(s, bit) === 0) return 0;
    gate.on = 1;
    gate.since = s.now;
  }
  if (s.now - gate.since < 0x15) return stillGoing(s, bit);
  return 0;
}

/** `0x401130`: the monitors that act before a rest. */
export function beforeRest(s: Session): number {
  if (s.resting !== 0) return 0;
  return monitorHold(s, 2, s.restMonitor);
}

/** `0x4010f0`: the monitors that act before a meditation. */
export function beforeMeditate(s: Session): number {
  if (s.meditating !== 0) return 0;
  return monitorHold(s, 0x20, s.meditateMonitor);
}
