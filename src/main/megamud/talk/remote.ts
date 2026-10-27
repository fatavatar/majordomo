/**
 * `0x4ae4a0`: the remote commands (MegaMUD's help, "Remote control"), read
 * 2026-10-12. A command said to this character (`kind` 1), gangpathed (8),
 * telepathed (0x10) or paged (0x20; the sender by their BBS user ID), or
 * typed by the player (0). The reply goes back the way the command came
 * (`>Name`, `gb `, `/Name`, `/p userid`).
 *
 * What a sender may do is their player record's `remote` bits (all of them
 * for the player; none with `Talk.NoRemoteCmds`); a party member or the
 * leader also gets health (4) and 8. A command that mentions suicide or
 * rerolling, or carries another `@`/`!` command, gets none. The party's own
 * traffic needs no bits: `{HP=…}` reports, `@heal`, `@blind`, `@diseased`,
 * `@held`, `@panic!`, `@wait`/`!wait`, `@ok`/`!ok`, `@comeback`, `@OI!`,
 * `@forget`, `@kill`, `@share` and the leader's `@party`.
 *
 * Anything else that is not a command gets the AFK reply (`Talk.AfkReply`,
 * when active); a command not allowed gets `Talk.CmdReply`
 * (`Talk.WarnRemote`).
 *
 * Left out: the toolbar, party window and stats window refreshes, the
 * settings window's own switches (`0x48fd40`), and `@capture`'s file name.
 * The way to a room or a loop's start is the host's route (`0x43fd90`).
 */
import { expMeter } from '../stats/expMeter';
import { pvpAttack } from '../combat/events';
import { clearAlignment } from '../combat/engaged';
import {
  atoi,
  findNoCase,
  indexFrom,
  indexOf,
  indexOfNoCase,
  leadingNumber,
  strcmp,
  stricmp,
  strnicmp,
  trimSpaces
} from '../cstr';
import { classMagic, type PlayerRec } from '../data';
import { depositAll, dropAll, equipAll, getAll } from '../items/all';
import { removeMember } from '../party/members';
import { joinLeader } from '../party/ranks';
import { findPlayer, partyIndex } from '../room/checkNames';
import { whereAgo, whereText, roomKnown } from '../room/where';
import { hangUp, resetAll } from '../script/game';
import { combatChosen } from '../script/modes';
import { expandMacros, plainText, queue, send } from '../script/send';
import { goStop } from '../move/buttons';
import { clearDetours, goTo, headFor, startWalking } from '../move/destinations';
import { clearPath, copyPath, freeSteps, stepsShown } from '../move/path';
import type { PathRec, Session } from '../Session';
import { activateProfile, useProfile } from '../character';
import {
  PartyFlag,
  ItemFlag,
  PlayerFlag,
  RemoteFlag,
  REMOTE_ALL,
  Stance,
  EntityType
} from '../flags';
import { Task } from '../script/task';

/** The reply prefix for each kind (the table at `0x4b2fb4`); with no record, the sender's name. */
function replyPrefix(s: Session, p: PlayerRec | null, kind: number, sender: string): string {
  switch (kind) {
    case 0:
      return `>${s.Player_Name}`;
    case 1:
      return `>${p?.name ?? sender}`;
    case 8:
      return 'gb ';
    case 0x10:
      return `/${p?.name ?? sender}`;
    default:
      return `/p ${p !== null && p.userId !== '' ? p.userId : sender}`;
  }
}

/** The command in the line, from `start`: blanks off its front, and a said one cut at its quote. */
function commandText(line: string, start: number, kind: number): string {
  const raw = line.slice(start).replace(/^ +/, '').slice(0, 99);
  const quote = kind === 1 ? raw.indexOf('"') : -1;
  return quote === -1 ? raw : raw.slice(0, quote);
}

/** `0x491ac0`: the player whose BBS user ID this is. */
function findUserId(s: Session, id: string): PlayerRec | null {
  if (id === '') return null;
  return s.data.players?.find((p) => stricmp(id, p.userId) === 0) ?? null;
}

/** `0x4ad9e0`: a number with its thousands separated by commas. */
function commas(n: number): string {
  return (n >>> 0).toLocaleString('en-US');
}

/** What the reply goes to, and who sent it. */
interface Ctx {
  s: Session;
  /** `local_e4` */
  to: string;
  /** `local_1c`: the sender's name (or user ID). */
  sender: string;
  /** The sender's record. */
  p: PlayerRec;
  kind: number;
  /** `local_80`: the command, as plain words. */
  cmd: string;
}

/** `LAB_004b2950`: queued, unless the sender is `Stance.Unknown_7`. */
function reply(c: Ctx, text: string): number {
  if (c.p.kind !== Stance.Unknown_7) queue(c.s, text);
  return 0;
}

/** `LAB_004b294a`: a setting's reply, only to someone else. */
function settingReply(c: Ctx, text: string): number {
  if (c.kind === 0) return 0;
  return reply(c, text);
}

/** `on`/`off` in the command, else `flipped`. */
function onOff(cmd: string, flipped: number): number {
  let v = flipped;
  if (indexOfNoCase(cmd, ' on') !== -1) v = 1;
  if (indexOfNoCase(cmd, ' off') !== -1) v = 0;
  return v;
}

const ON = (v: number): string => (v !== 0 ? 'ON' : 'OFF');
const NOW = (was: number, is: number): string => (was !== is ? 'now' : 'was');

/** One of the `@auto-…` switches (`label` its name in the reply). */
type Switch =
  | 'MegaMud_AutoCombat'
  | 'MegaMud_AutoPreAttack'
  | 'MegaMud_AutoNuke'
  | 'MegaMud_AutoHeal'
  | 'MegaMud_AutoBless'
  | 'MegaMud_AutoLight'
  | 'MegaMud_AutoCash'
  | 'MegaMud_AutoGet'
  | 'MegaMud_AutoSneak'
  | 'MegaMud_AutoHide'
  | 'MegaMud_AutoSearch'
  | 'preferMelee';

function toggle(c: Ctx, key: Switch, label: string): number {
  const s = c.s;
  const was = s[key];
  s[key] = onOff(c.cmd, was === 0 ? 1 : 0);
  if (key === 'MegaMud_AutoCombat') combatChosen(s);
  if (key === 'MegaMud_AutoHeal' && s.MegaMud_AutoHeal === 0) {
    s.resting = 0;
    s.restHpToFull = 0;
    s.restManaToFull = 0;
    s.hpFullAt = 0;
    s.manaFullAt = 0;
  }
  return settingReply(c, `${c.to} {${label} ${NOW(was, s[key])} ${ON(s[key])}}\r`);
}

/** A switch whose setting is the other way round (`Disable…`, `NoHangup`): on is 0. */
function toggleOff(
  c: Ctx,
  key: 'MegaMud_DisableEvents' | 'MegaMud_DisableAbilMon' | 'MegaMud_NoHangup',
  label: string
): string {
  const s = c.s;
  const wasOn = s[key] === 0 ? 1 : 0;
  s[key] = wasOn;
  if (indexOfNoCase(c.cmd, ' on') !== -1) s[key] = 0;
  if (indexOfNoCase(c.cmd, ' off') !== -1) s[key] = 1;
  const on = s[key] === 0 ? 1 : 0;
  return `${c.to} {${label} ${NOW(wasOn, on)} ${ON(on)}}\r`;
}

/**
 * `@health`: `{HP=x/y,MA=x/y, Resting, …}`. Ours: a figure over its maximum
 * sent with the figure as its maximum. The maximum is the last stat sheet's,
 * a buff since can carry the figure past it, and the asking MegaMUD cannot
 * read a figure over its maximum (`healthReport`) and asks again: Skinny
 * answered Fatty `{HP=936/916,…}` fifty-two times on 2026-10-04.
 */
function health(c: Ctx): number {
  const s = c.s;
  let text = `${c.to} {HP=${s.hp}/${Math.max(s.Player_MaxHP, s.hp)}`;
  if (s.Player_MaxMana > 0) {
    text += classMagic(s.data, s.Player_Class) === 5 ? ',KAI=' : ',MA=';
    text += `${s.mana}/${Math.max(s.Player_MaxMana, s.mana)}`;
  }
  if (s.resting !== 0) text += ', Resting';
  if (s.lost !== 0) text += ', Lost';
  if (s.blind !== 0) text += ', Blind';
  if (s.confused !== 0) text += ', Confused';
  if (s.poisoned !== 0) text += ', Poisoned';
  if (s.diseased !== 0) text += ', Diseased';
  if (s.losingHp !== 0) text += ', Losing HPs';
  if (s.held !== 0) text += ', Cant move';
  if (s.attackPrevented !== 0) text += ', Cant attack';
  queue(s, `${text}}\r`);
  return 1;
}

/** A party member's `{HP=x/y,MA=x/y}`: their numbers, kept when they make sense. */
function healthReport(c: Ctx, i: number): number {
  const m = c.s.party[i]!;
  let rest = c.cmd.slice(4);
  let n: number;
  let end: number;
  [n, end] = leadingNumber(rest);
  m.hp = n;
  rest = rest.slice(end).replace(/^\/+/, '');
  [n, end] = leadingNumber(rest);
  m.maxHp = n;
  rest = rest.slice(end);
  if (m.maxHp > 0) m.hpPct = Math.trunc((m.hp * 100) / m.maxHp);
  const mana = rest.startsWith(',MA=') ? 4 : rest.startsWith(',KAI=') ? 5 : 0;
  if (mana !== 0) {
    rest = rest.slice(mana);
    [n, end] = leadingNumber(rest);
    m.mana = n;
    rest = rest.slice(end).replace(/^\/+/, '');
    m.maxMana = leadingNumber(rest)[0];
    if (m.maxMana > 0) m.manaPct = Math.trunc((m.mana * 100) / m.maxMana);
  }
  const bad = (v: number, max: number): boolean =>
    v < -99999 || v > 99999 || max >>> 0 > 99999 || max < v;
  if (bad(m.hp, m.maxHp)) {
    m.hp = 0;
    m.maxHp = 0;
    m.flags28 |= PartyFlag.HealthUnknown;
  } else {
    m.flags28 &= ~(PartyFlag.HealthUnknown | PartyFlag.ChangedSinceListing);
  }
  if (bad(m.mana, m.maxMana)) {
    m.mana = 0;
    m.maxMana = 0;
    m.flags28 |= PartyFlag.HealthUnknown;
  }
  return 1;
}

/** `@wait` (or `!wait`, or `Party.PartyWaitCmd`) from a member: wait for them. */
function partyWait(c: Ctx, i: number): number {
  const s = c.s;
  s.parDue = 1;
  if (s.Party_IgnoreWait !== 0) return 1;
  const m = s.party[i]!;
  m.flags28 |= PartyFlag.AskedToWait;
  if (indexOf(c.cmd, 'Mana/Kai') === -1 && indexOf(c.cmd, 'HP') !== -1)
    m.flags28 |= PartyFlag.AskedForHeal;
  s.partyWaitAt = s.now;
  s.partyWait = 1;
  s.attackDue = 1;
  return 1;
}

/** `@ok` (or `!ok`, or `Party.PartyResumeCmd`): that member is rested. */
function partyOk(c: Ctx, i: number): number {
  const s = c.s;
  const m = s.party[i]!;
  m.hpPct = 100;
  m.hp = m.maxHp;
  m.flags28 =
    (m.flags28 & ~(PartyFlag.AskedToWait | PartyFlag.Offline | PartyFlag.AskedForHeal)) |
    PartyFlag.ChangedSinceListing;
  s.partyWait = 0;
  for (let j = 0; j < s.partySize; j += 1)
    if ((s.party[j]!.flags28 & PartyFlag.AskedToWait) !== 0) s.partyWait = 1;
  if (s.partyWait === 0 && s.autoCombatForWait !== 0) {
    s.autoCombatForWait = 0;
    s.MegaMud_AutoCombat = 0;
  }
  return 1;
}

/** `@comeback`: the leader goes back for a member left behind. */
function comeback(c: Ctx, i: number): number {
  const s = c.s;
  if (s.rescueCount !== 0) return reply0(c, `${c.to} {I am!}\r`);
  if (s.roaming !== 0) return reply0(c, `${c.to} {can't - I'm moving randomly}\r`);
  if (s.walking === 0) return reply0(c, `${c.to} {can't - I'm not moving}\r`);
  if (
    s.leaderName !== s.Player_Name &&
    i !== -1 &&
    (s.party[i]!.flags28 & PartyFlag.Unlisted) !== 0
  )
    s.leaderName = s.Player_Name.slice(0, 10);
  if (s.leaderName !== s.Player_Name) return reply0(c, `${c.to} {can't - I'm not the leader}\r`);
  s.parDue = 1;
  s.rescueCount = Math.max(s.path.count, 15);
  s.partyWaitAt = s.now;
  if (i !== -1) s.party[i]!.flags28 |= PartyFlag.Unlisted | PartyFlag.LeftBehind;
  queue(s, `${c.to} {ok}\r`);
  return 0;
}

/** `LAB_004af3c6`: queued, whoever asked. */
function reply0(c: Ctx, text: string): number {
  queue(c.s, text);
  return 0;
}

/** `@OI!` from a member: they are on our target, so this character backs off. */
function oi(c: Ctx): number {
  const s = c.s;
  const n = Math.min(c.sender.length, s.target.length);
  if (n === 0 || strnicmp(c.sender, s.target, n) !== 0) return 0;
  send(s, 'break\r');
  s.inCombat = 0;
  s.target = '';
  s.lookDue = 1;
  return 0;
}

/** `@kill <player>`: defend the party against them. */
function kill(c: Ctx): number {
  const s = c.s;
  if (s.Party_DefendParty === 0) return reply0(c, `${c.to} {no - party defence disabled}\r`);
  const who = trimSpaces(c.cmd.slice(6, 16));
  if (partyIndex(s, who) !== -1) return reply0(c, `${c.to} {no - they are in our party}\r`);
  const q = findPlayer(s, who);
  if (q && q.kind === Stance.Friend) return reply0(c, `${c.to} {no - player is a friend}\r`);
  // `0x4ae4a0` calls `0x42b8f0` itself, without asking the party to `@kill`.
  pvpAttack(s, who, 0);
  return 0;
}

/** A command to send for someone (`@do`, `!cmd`, `@party`): a MUD op's `sys` only with 0x2000. */
function commandFor(c: Ctx, text: string, perms: number): string | null {
  const plain = trimSpaces(plainText(c.s, `${text.slice(0, 80)}\r`));
  if (strnicmp(plain, 'sys', 3) === 0 && (perms & RemoteFlag.SysopCommands) === 0) return null;
  return plain;
}

/** `@who`: who else is here. */
function whoHere(c: Ctx): number {
  const names = c.s.room.filter((e) => e.type !== EntityType.Item).map((e) => e.name);
  return reply0(c, `${c.to} {${names.length > 0 ? names.join(',') : 'No one'}}\r`);
}

/** `@what`: the items here. */
function whatHere(c: Ctx): number {
  const items = c.s.room
    .filter((e) => e.type === EntityType.Item && e.item)
    .map((e) =>
      (e.item!.flags & ItemFlag.Coin) !== 0 || e.count > 1 ? `${e.count} ${e.name}` : e.name
    );
  return reply0(c, `${c.to} {${items.length > 0 ? items.join(',') : 'Nothing'}}\r`);
}

/** `@where`: the room, and with `Talk.WhereUseRm`, its map numbers (an `rm` asked for). */
function where(c: Ctx): number {
  const s = c.s;
  const desc = whereText(s);
  if (s.Talk_WhereUseRm === 0) return reply0(c, `${c.to} {${desc}}\r`);
  if (s.inGame !== 0) {
    if (s.locationAt !== 0 && s.locationAt === s.now && roomKnown(s))
      return reply0(c, `${c.to} {${desc} - ${s.locationMap}/${s.locationRoom}}\r`);
    if (s.whereAsked.length < 4) {
      s.whereAsked.push(c.to.slice(0, 99));
      if (s.whereAsked.length !== 1) return 0;
      s.whereAskedAt = s.host.tickMs();
      queue(s, 'rm\r');
      return 0;
    }
  }
  return reply0(c, `${c.to} {${desc}${whereAgo(s)}}\r`);
}

/** `0x4ac1d0`: `12 steps to go` (or `to lap end`, looping). */
function stepsText(s: Session): string {
  const n = stepsShown(s);
  const to = s.looping === 0 ? 'go' : 'lap end';
  if (n < 0) return `? steps to ${to}`;
  return `${n} step${n === 1 ? '' : 's'} to ${to}`;
}

/** `@path`: the path file, the destination (or the detour and why), and the steps to go. */
function path(c: Ctx): number {
  const s = c.s;
  if (s.MegaMud_CurPath === '') return reply0(c, `${c.to} {none}\r`);
  let text = `${c.to} {${s.MegaMud_CurPath}`;
  if (s.path.title !== '') text += ` (${s.path.title})`;
  if (s.looping === 0 && s.destination !== '') {
    text += ` -> ${s.destination}`;
    if (s.detours[1]!.room !== 0 && s.detours[0]!.why !== '') text += ` (${s.detours[0]!.why})`;
  }
  return reply0(c, `${text} - ${stepsText(s)}}\r`);
}

/** `@status`: the status bar's task and action (and with a path, the steps to go). */
function status(c: Ctx): number {
  const s = c.s;
  let text = `${c.to} {${s.host.caption?.() ?? ''} -${s.statusShown}`;
  if (s.task === Task.Walking || s.task === Task.Looping) text += ` - ${stepsText(s)}`;
  send(s, `${text}}\r`);
  return 0;
}

/** `@seen <player>`. */
function seen(c: Ctx): number {
  const name = c.cmd.slice(6, 25);
  const q = findPlayer(c.s, name);
  let text: string;
  if (!q) text = `${c.to} {player "${name}" unknown}`;
  else if ((q.flags & PlayerFlag.SeenThisSession) === 0) text = `${c.to} {no}`;
  else text = `${c.to} {yes, ${q.seen} times, last at ${q.where}}`;
  return reply0(c, `${text}\r`);
}

/** `@enc`: the encumbrance. */
function enc(c: Ctx, raw: string): number {
  const s = c.s;
  const level = ['None', 'Light', 'Medium', 'Heavy'][s.encumbranceLevel] ?? raw;
  return reply0(c, `${c.to} {${s.weightCarried}/${s.weightMax} - ${level}}\r`);
}

/** `@have <item>`. */
function have(c: Ctx): number {
  const name = trimSpaces(c.cmd.slice(6, 36));
  for (const carried of c.s.inventory) {
    if (carried.item && stricmp(carried.item.name, name) === 0)
      return reply0(c, `${c.to} {yes: ${carried.count}}\r`);
  }
  return reply0(c, `${c.to} {no}\r`);
}

/** Walking started to the destination just queued: `{ok}`, or `{failed}`. */
function walkTo(c: Ctx, queued: number): number {
  if (queued !== 0) {
    startWalking(c.s);
    if (headFor(c.s, 0) === 0) return reply(c, `${c.to} {ok}\r`);
  }
  return reply(c, `${c.to} {failed}\r`);
}

/** `@goto <room>` (its Rooms.md name or code): the loop let go, walked there. */
function gotoRoom(c: Ctx): number {
  const s = c.s;
  const name = trimSpaces(c.cmd.slice(6, 46));
  const room = (s.data.rooms ?? []).find(
    (r) => stricmp(r.name, name) === 0 || stricmp(r.code ?? '', name) === 0
  );
  if (!room) return reply(c, `${c.to} {unknown - "${name}"}\r`);
  s.looping = 0;
  s.roaming = 0;
  clearPath(s.loopPath);
  clearDetours(s);
  return walkTo(c, goTo(s, room.signature, null));
}

/** A known path by its title or file (`0x7f20`). */
function knownPath(s: Session, name: string): PathRec | null {
  return s.paths.find((p) => stricmp(p.title, name) === 0 || stricmp(p.name, name) === 0) ?? null;
}

/** `@loop <path>`: the path made the loop, walked to its start. */
function loop(c: Ctx): number {
  const s = c.s;
  const name = trimSpaces(c.cmd.slice(6, 46));
  const p = knownPath(s, name);
  if (!p) return reply(c, `${c.to} {unknown - "${name}"}\r`);
  clearDetours(s);
  freeSteps(s.loopPath);
  copyPath(s, s.loopPath, p, 0);
  if (goTo(s, 0, p) === 0) return reply(c, `${c.to} {failed}\r`);
  startWalking(s);
  if (headFor(s, 0) !== 0) return reply(c, `${c.to} {failed}\r`);
  s.laps = 0;
  return reply(c, `${c.to} {ok}\r`);
}

/** `@looponce <path>`: walked once, from its start. */
function loopOnce(c: Ctx): number {
  const s = c.s;
  const name = trimSpaces(c.cmd.slice(10, 50));
  const p = knownPath(s, name);
  if (!p) return reply(c, `${c.to} {unknown - "${name}"}\r`);
  freeSteps(s.loopPath);
  return walkTo(c, goTo(s, 0, p));
}

/** `@settings`: the switches on, then those off. */
function settings(c: Ctx): number {
  const s = c.s;
  const flags: [number, string][] = [
    [s.MegaMud_AutoCombat, 'Combat'],
    [s.MegaMud_AutoPreAttack, ',Pre(attacks)'],
    [s.MegaMud_AutoNuke, ',Nuke'],
    [s.MegaMud_AutoHeal, ',Heal'],
    [s.MegaMud_AutoBless, ',Bless'],
    [s.MegaMud_AutoLight, ',Light'],
    [s.MegaMud_AutoGet, ',Get Items'],
    [s.MegaMud_AutoCash, ',Get Cash'],
    [s.MegaMud_AutoSneak, ',Sneak'],
    [s.MegaMud_AutoHide, ',Hide'],
    [s.MegaMud_AutoSearch, ',Search'],
    [s.MegaMud_DisableEvents === 0 ? 1 : 0, ',Events'],
    [s.MegaMud_DisableAbilMon === 0 ? 1 : 0, ',Abils'],
    [s.preferMelee, ',Melee'],
    [s.MegaMud_NoHangup === 0 ? 1 : 0, ',Hangup']
  ];
  const list = (on: boolean): string => {
    const text = flags
      .filter(([v]) => (v !== 0) === on)
      .map(([, name]) => name)
      .join('');
    return text.startsWith(',') ? text.slice(1) : text;
  };
  const allOff = s.allOff !== 0;
  const onText = `${c.to} {ON: ${allOff ? 'Nothing (All-Off)' : list(true)}}\r`;
  if (c.kind !== 0) {
    if (allOff) send(s, onText);
    else queue(s, onText);
  }
  if (allOff || c.kind === 0) return 0;
  queue(s, `${c.to} {OFF: ${list(false)}}\r`);
  return 0;
}

/** The setting switches (`remote` 0x800); null for none of them. */
function alterSettings(c: Ctx): number | null {
  const s = c.s;
  const cmd = c.cmd;
  const is = (word: string): boolean => strnicmp(cmd, word, word.length) === 0;
  if (is('@attack-last')) {
    const was = s.Party_AttackLast;
    s.Party_AttackLast = onOff(cmd, was === 0 ? 1 : 0);
    if (s.Party_AttackLast !== 0) s.Party_AttackLate = 0;
    return settingReply(
      c,
      `${c.to} {attack-last ${NOW(was, s.Party_AttackLast)} ${ON(s.Party_AttackLast)}}\r`
    );
  }
  if (is('@attack-late')) {
    const was = s.Party_AttackLate;
    let cleared = false;
    s.Party_AttackLate = onOff(cmd, was === 0 ? 1 : 0);
    if (s.Party_AttackLate !== 0) {
      cleared = s.Party_AttackLast !== 0 || s.Party_ShareDamage !== 0;
      s.Party_AttackLast = 0;
      s.Party_ShareDamage = 0;
    }
    if (was !== s.Party_AttackLate) clearAlignment(s);
    const also = cleared ? ', attack-last/share-damage OFF' : '';
    return settingReply(
      c,
      `${c.to} {attack-late ${NOW(was, s.Party_AttackLate)} ${ON(s.Party_AttackLate)}${also}}\r`
    );
  }
  if (strnicmp(cmd, '@auto-all', 8) === 0) {
    const was = s.allOff;
    s.allOff = was === 0 ? 1 : 0;
    if (indexOfNoCase(cmd, ' on') !== -1) s.allOff = 0;
    if (indexOfNoCase(cmd, ' off') !== -1) s.allOff = 1;
    const text = `${c.to} {Auto-All switch ${NOW(was, s.allOff)} ${ON(s.allOff === 0 ? 1 : 0)}}\r`;
    if (c.kind !== 0 && c.p.kind !== Stance.Unknown_7) send(s, text);
    return 0;
  }
  if (is('@auto-combat')) return toggle(c, 'MegaMud_AutoCombat', 'auto-combat');
  if (is('@auto-pre')) return toggle(c, 'MegaMud_AutoPreAttack', 'auto-pre');
  if (is('@melee')) return toggle(c, 'preferMelee', 'prefer melee');
  if (is('@spells')) {
    let v = indexOfNoCase(cmd, ' off') === -1 ? 1 : 0;
    if (indexOfNoCase(cmd, ' on') !== -1) v = 1;
    s.MegaMud_AutoNuke = v;
    s.MegaMud_AutoPreAttack = v;
    s.preferMelee = v ^ 1;
    return settingReply(
      c,
      `${c.to} {spells now ${ON(v)}: melee=${ON(s.preferMelee)}, nuke=${ON(s.MegaMud_AutoNuke)}, pre=${ON(s.MegaMud_AutoPreAttack)}}\r`
    );
  }
  if (is('@profile')) {
    const n = atoi(cmd.slice(8));
    if (c.kind === 0) return useProfile(s, n);
    let text: string;
    if (s.settingsWindowOpen !== 0) text = 'profile: settings window is open';
    else if (activateProfile(s, n) !== 0) text = `profile now ${n}`;
    else if ((n - 1) >>> 0 < 4)
      text = `profile ${n} is not enabled - still ${s.Profiles_ActiveProfile}`;
    else text = `profile is ${s.Profiles_ActiveProfile} - use 1-4`;
    if (c.p.kind === Stance.Unknown_7) return 0;
    return reply0(c, `${c.to} {${text}}\r`);
  }
  if (is('@auto-nuke')) return toggle(c, 'MegaMud_AutoNuke', 'auto-nuke');
  if (is('@auto-event'))
    return settingReply(c, toggleOff(c, 'MegaMud_DisableEvents', 'auto-event'));
  if (is('@auto-abil')) return settingReply(c, toggleOff(c, 'MegaMud_DisableAbilMon', 'auto-abil'));
  if (is('@auto-heal')) return toggle(c, 'MegaMud_AutoHeal', 'auto-heal');
  if (is('@auto-bless')) return toggle(c, 'MegaMud_AutoBless', 'auto-bless');
  if (is('@auto-light')) return toggle(c, 'MegaMud_AutoLight', 'auto-light');
  if (is('@auto-cash')) return toggle(c, 'MegaMud_AutoCash', 'auto-cash');
  if (is('@auto-get')) return toggle(c, 'MegaMud_AutoGet', 'auto-get');
  if (is('@auto-sneak')) return toggle(c, 'MegaMud_AutoSneak', 'auto-sneak');
  if (is('@auto-hide')) return toggle(c, 'MegaMud_AutoHide', 'auto-hide');
  if (is('@auto-search')) return toggle(c, 'MegaMud_AutoSearch', 'auto-search');
  if (is('@auto-hangup')) {
    const text = toggleOff(c, 'MegaMud_NoHangup', 'auto-hangup');
    if (c.kind === 0 || c.p.kind === Stance.Unknown_7) return 0;
    if (s.allOff !== 0) send(s, text);
    else queue(s, text);
    return 0;
  }
  if (stricmp(cmd, '@settings') === 0) return settings(c);
  if (stricmp(cmd, '@reset') === 0) {
    resetAll(s);
    return settingReply(c, `${c.to} {ok}\r`);
  }
  return null;
}

/** `@divert`/`@debug`: taken by the first to ask, given up by them (or `off`). */
function claim(c: Ctx, key: 'divertTo' | 'debugTo', turnOn: boolean): number {
  const s = c.s;
  if (turnOn && s[key] === '') {
    s[key] = c.sender.slice(0, 10);
    return reply0(c, `${c.to} {ok}\r`);
  }
  if (!turnOn && strcmp(c.sender, s[key]) === 0) {
    s[key] = '';
    return reply0(c, `${c.to} {off}\r`);
  }
  return reply0(c, `${c.to} {failed}\r`);
}

/** `@home <monster>` to a MUD op: the `room` command asked about it. */
function home(c: Ctx): number {
  const s = c.s;
  if (s.roomReply !== '' || s.unknown_50 !== 0) return reply0(c, `${c.to} {busy}\r`);
  const name = c.cmd.slice(6);
  const i = s.data.monsters.findIndex((m) => stricmp(m.name, name) === 0);
  if (i === -1) return reply0(c, `${c.to} {unknown}\r`);
  s.roomReply = c.to.slice(0, 99);
  s.homeMonster = i;
  s.homeLookup = 1;
  s.homeAskDue = 1;
  return reply0(c, `${c.to} {one moment...}\r`);
}

/** Not a command: the AFK reply; a command not allowed: `Talk.CmdReply`. */
function notCommand(c: Ctx, line: string): number {
  const s = c.s;
  if (botCommand(s, c.kind, c.sender, c.p, c.to, c.cmd)) return 0;
  if (
    c.kind === 8 ||
    c.p.kind === Stance.Enemy ||
    c.p.kind === Stance.Flee ||
    c.p.kind === Stance.Hangup
  )
    return 0;
  s.msgSource = c.p.name.slice(0, 80);
  s.msgTarget = s.Player_Name.slice(0, 80);
  if (!c.cmd.startsWith('@')) {
    if (s.active === 0 || s.Talk_AfkReply === '') return 0;
    if (c.kind === 1 && indexOf(line, ' says (to you)') === -1) return 0;
    if (line.includes('{')) return 0;
    const text = expandMacros(s, s.Talk_AfkReply);
    if (text === '') return 0;
    s.afkReplied = text.slice(0, 500);
    return reply0(c, `${c.to} ${text}\r`);
  }
  if (s.Talk_WarnRemote === 0 || s.Talk_CmdReply === '') return 0;
  return reply0(c, `${c.to} ${s.Talk_CmdReply}\r`);
}

/**
 * Ours: one of the player's own commands (`BotCommand`, 2026-10-15), asked
 * by somebody it names, sent with `{source}` the asker and answered with its
 * reply. Reached only where none of MegaMUD's own matched (`notCommand`), so
 * a word of MegaMUD's keeps its meaning: a party member's `@heal` is still
 * the party heal. Not from this character itself, and not with remote
 * commands refused (`Talk.NoRemoteCmds`). Whether one was answered.
 */
function botCommand(
  s: Session,
  kind: number,
  sender: string,
  p: PlayerRec | null,
  to: string,
  cmd: string
): boolean {
  if (kind === 0 || s.Talk_NoRemoteCmds === 1) return false;
  const word = cmd.trim().split(/\s+/)[0] ?? '';
  const bot = s.botCommands.find((b) => stricmp(b.word, word) === 0);
  if (!bot) return false;
  const who = sender.toLowerCase();
  const gang = p !== null && p.gang !== '' && stricmp(p.gang, s.Player_Gang) === 0;
  const allowed =
    bot.anyone ||
    bot.players.includes(who) ||
    (bot.party && partyIndex(s, sender) !== -1) ||
    (bot.gang && gang);
  if (!allowed) return false;
  s.msgSource = sender.slice(0, 80);
  s.msgTarget = s.Player_Name.slice(0, 80);
  const out = expandMacros(s, bot.send);
  if (out !== '') queue(s, out.endsWith('\r') ? out : `${out}\r`);
  if (bot.reply !== '') {
    const said = expandMacros(s, bot.reply);
    if (said !== '') queue(s, `${to} ${said}\r`);
  }
  s.host.show(`[${sender} asked ${bot.word}]`);
  return true;
}

/**
 * A line from somebody MegaMUD has no record of, which it lets go
 * (`0x4ae4a0`): one of the player's own commands open to anyone is still
 * answered, by the way it came.
 */
function strangerCommand(
  s: Session,
  line: string,
  kind: number,
  start: number,
  sender: string
): number {
  if (!s.botCommands.some((b) => b.anyone) || s.allOff !== 0) return 0;
  if (kind !== 1 && kind !== 0x10 && kind !== 0x20) return 0;
  botCommand(
    s,
    kind,
    sender,
    null,
    replyPrefix(s, null, kind, sender),
    commandText(line, start, kind)
  );
  return 0;
}

/** Where the command starts in the line, and the sender's name's length; null for none. */
function locate(s: Session, line: string, kind: number): [number, number] | null {
  switch (kind) {
    case 0:
      return [0, 0];
    case 1: {
      const space = line.indexOf(' ');
      const quote = line.indexOf('"');
      if (space === -1 || quote === -1) return null;
      return [quote + 1, space];
    }
    case 8:
    case 0x10: {
      if (kind === 8 && s.Talk_NoGangCmds !== 0) return null;
      const at = indexOf(line, kind === 8 ? ' gangpaths:' : ' telepaths:');
      return at === -1 ? null : [at + 12, at];
    }
    case 0x20: {
      const at = indexOf(line, ' is paging');
      if (at === -1) return null;
      const colon = indexFrom(line, at, ': ');
      return colon === -1 ? null : [colon + 2, at];
    }
    default:
      return null;
  }
}

export function remoteCommand(s: Session, line: string, kind: number): number {
  const found = locate(s, line, kind);
  if (!found) return 0;
  const [start, nameLength] = found;

  let sender: string;
  let p: PlayerRec | null;
  if (s.inGame !== 0 && kind === 0) {
    sender = s.Player_Name.slice(0, 19);
    p = findPlayer(s, sender);
  } else {
    if (s.inGame === 0 && kind !== 0x20) return 0;
    sender = line.slice(0, Math.min(nameLength, 19));
    if (sender === s.Player_Name) return 0;
    p = kind === 0x20 ? findUserId(s, sender) : findPlayer(s, sender);
  }
  if (!p) return strangerCommand(s, line, kind, start, sender);
  let perms = kind === 0 ? REMOTE_ALL : p.remote & REMOTE_ALL;
  const to = replyPrefix(s, p, kind, sender);

  const raw = commandText(line, start, kind);
  const cmd = plainText(s, raw);
  if (
    s.allOff !== 0 &&
    strnicmp(cmd, '@auto-all', 9) !== 0 &&
    strnicmp(cmd, '@auto-hangup', 12) !== 0 &&
    stricmp(cmd, '@settings') !== 0
  ) {
    return 0;
  }
  if (kind !== 0 && s.Talk_NoRemoteCmds === 1) perms = 0;
  for (let i = 0; i < s.partySize; i += 1) {
    if (s.party[i]!.name === p.name) {
      perms |= RemoteFlag.QueryHealth | RemoteFlag.Unknown_8;
      break;
    }
  }
  if (s.following !== 0 && s.leaderName === p.name)
    perms |= RemoteFlag.QueryHealth | RemoteFlag.Unknown_8;
  if (findNoCase(cmd, 0, 'suicide') !== -1 || findNoCase(cmd, 0, 'reroll') !== -1) perms = 0;
  const inner = cmd.slice(1);
  let at = inner.indexOf('@');
  if (at === -1) at = inner.indexOf('!');
  if (at !== -1) {
    const after = inner.slice(at + 1);
    if (strnicmp(after, 'ok', 2) !== 0 || after.includes('@') || after.includes('!')) perms = 0;
  }
  if (indexOf(line, '{==>') !== -1 || indexOf(line, '{##>') !== -1) return 0;

  const c: Ctx = { s, to, sender, p, kind, cmd };
  const is = (word: string): boolean => stricmp(cmd, word) === 0;
  const starts = (word: string): boolean => strnicmp(cmd, word, word.length) === 0;
  const mi = partyIndex(s, sender);

  if ((perms & RemoteFlag.QueryVersion) !== 0 && starts('@ver'))
    return reply0(c, `${to} {MegaMMUD 2.1}\r`);
  if ((perms & RemoteFlag.QueryHealth) !== 0 && is('@health')) return health(c);
  if (cmd.startsWith('{HP=') && mi !== -1) return healthReport(c, mi);

  if ((is('!help') || is('@heal')) && mi !== -1) {
    s.party[mi]!.flags28 |= PartyFlag.AskedForHeal;
    return 1;
  }
  for (const [word, flag] of [
    ['@diseased', 0x2000],
    ['@blind', 0x4000],
    ['@held', 0x8000]
  ] as const) {
    if (is(word) && mi !== -1) {
      s.party[mi]!.flags28 |= flag;
      return 1;
    }
  }
  if (starts('@panic!') && mi !== -1) {
    if (s.allOff === 0 && s.Party_IgnorePanic === 0) s.panicAsked = 1;
    return 0;
  }
  if (starts('@wait') || is('!wait') || (s.Party_PartyWaitCmd !== '' && is(s.Party_PartyWaitCmd))) {
    if (mi !== -1) return partyWait(c, mi);
  }
  if (is('@ok') || is('!ok') || (s.Party_PartyResumeCmd !== '' && is(s.Party_PartyResumeCmd))) {
    if (mi !== -1) return partyOk(c, mi);
  }
  if (is('@comeback') && (mi !== -1 || (perms & RemoteFlag.MovePlayer) !== 0))
    return comeback(c, mi);
  if (is('@OI!') && mi !== -1) return oi(c);
  if ((perms & RemoteFlag.RequestInvite) !== 0 && is('@invite')) {
    queue(s, `invite ${sender}\r`);
    s.parDue = 1;
    return reply(c, `${to} {ok}\r`);
  }
  if ((perms & RemoteFlag.QueryInventory) !== 0 && is('@join')) {
    if (s.following !== 0 && partyIndex(s, p.name) === -1 && p.name !== s.leaderName)
      return reply0(c, `${to} {following ${s.leaderName}}\r`);
    joinLeader(s, sender);
    return 0;
  }
  if (is('@forget') && mi !== -1) {
    s.host.partyForgot?.(s.party[mi]!.name);
    removeMember(s, mi);
    return reply(c, `${to} {ok}\r`);
  }
  if (starts('@kill ') && mi !== -1) return kill(c);
  if (is('@share') && mi !== -1) {
    if (s.leaderName === sender && s.leaderName !== s.Player_Name) {
      if (s.Party_ShareCash !== 0) s.shareCashDue = 1;
      else queue(s, `${to} {sharing disabled}\r`);
    }
    return 1;
  }
  if ((perms & RemoteFlag.QueryExperience) !== 0 && (is('@exp') || is('@level'))) {
    // `0x4a7250`: the stats window's experience meter.
    const m = expMeter(s);
    if (is('@exp'))
      return reply0(
        c,
        `${to} {Made: ${m.made}  Needed: ${m.needed}  Rate: ${m.rate}  Will level in: ${m.levelIn}}\r`
      );
    return reply0(
      c,
      `${to} {Level: ${s.Player_Level}  Needed: ${m.needed}  Will level in: ${m.levelIn}}\r`
    );
  }
  if ((perms & RemoteFlag.QueryLocation) !== 0) {
    if (is('@where')) return where(c);
    if (is('@path')) return path(c);
    if (is('@who')) return whoHere(c);
    if (starts('@seen ')) return seen(c);
    if (is('@what')) return whatHere(c);
  }
  if ((perms & RemoteFlag.QueryHealth) !== 0) {
    if (is('@status')) return status(c);
    if (is('@lives'))
      return reply0(
        c,
        `${to} {${s.Player_Lives} ${s.Player_Lives === 1 ? 'life' : 'lives'} remaining}\r`
      );
  }
  if ((perms & RemoteFlag.QueryInventory) !== 0) {
    if (is('@wealth')) return reply0(c, `${to} {${commas(s.wealth)} copper}\r`);
    if (is('@enc')) return enc(c, raw);
    if (starts('@have ')) return have(c);
  }
  if ((perms & RemoteFlag.ExecuteCommands) !== 0) {
    const errand: [string, () => void][] = [
      ['@get-all', () => getAll(s)],
      ['@drop-all', () => dropAll(s)],
      ['@equip-all', () => equipAll(s)],
      [
        '@deposit-all',
        () => {
          s.depositAsked = -1;
          s.bankedHere = 0;
          depositAll(s);
        }
      ]
    ];
    for (const [word, run] of errand) {
      if (is(word)) {
        run();
        return reply0(c, `${to} {ok}\r`);
      }
    }
    if (starts('@do ') || starts('!cmd ')) {
      const text = commandFor(c, cmd.slice(starts('@do ') ? 4 : 5), perms);
      if (text === null) return 0;
      queue(s, text);
      return reply(c, `${to} {ok}\r`);
    }
  }
  if (starts('@party ')) {
    const i = s.leaderName === s.Player_Name ? -1 : mi;
    if (s.Party_IgnoreParty === 0 && i !== -1 && s.leaderName === sender) {
      const text = commandFor(c, cmd.slice(7), perms);
      if (text === null) return 0;
      queue(s, text);
      return 1;
    }
  }
  if ((perms & RemoteFlag.MovePlayer) !== 0) {
    if (is('@stop')) {
      if (s.walking !== 0) goStop(s);
      return reply(c, `${to} {ok}\r`);
    }
    if (is('@rego')) {
      if (s.walking === 0) goStop(s);
      return reply(c, s.walking !== 0 ? `${to} {ok}\r` : `${to} {can't}\r`);
    }
    if (starts('@goto ')) return gotoRoom(c);
    if (starts('@loop ')) return loop(c);
    if (starts('@looponce ')) return loopOnce(c);
    if (starts('@roam ')) {
      if (indexOfNoCase(cmd, ' on') !== -1) s.roaming = 1;
      if (indexOfNoCase(cmd, ' off') !== -1) s.roaming = 0;
      if (s.roaming !== 0) s.walking = 1;
      return reply(c, `${to} {auto-roam: ${ON(s.roaming)}}\r`);
    }
  }
  if ((perms & RemoteFlag.AlterSettings) !== 0) {
    const done = alterSettings(c);
    if (done !== null) return done;
  }
  if ((perms & RemoteFlag.DivertConversations) !== 0) {
    if (starts('@divert')) {
      const on = indexOfNoCase(cmd, ' on') !== -1;
      const off = indexOfNoCase(cmd, ' off') !== -1;
      return claim(c, 'divertTo', on || (!off && s.divertTo === ''));
    }
    if (is('@debug')) return claim(c, 'debugTo', s.debugTo === '');
    if (starts('@capture')) {
      if (indexOfNoCase(cmd, ' on') !== -1) s.capturing = 1;
      if (indexOfNoCase(cmd, ' off') !== -1) s.capturing = 0;
      return reply0(c, `${to} {capture: ${ON(s.capturing)}}\r`);
    }
  }
  if ((perms & RemoteFlag.Hangup) !== 0) {
    if (is('@hangup')) {
      send(s, `${to} {ok}\r`);
      s.skipRedialOnce = 1;
      s.noRedial = 1;
      s.exitForRelog = 0;
      hangUp(s, 0);
      s.host.alert?.('hangup');
      return 0;
    }
    if (is('@relog')) {
      if (s.relogCmd === '') return reply0(c, `${to} {No relog command}\r`);
      send(s, `${to} {ok}\r`);
      s.skipRedialOnce = 0;
      s.noRedial = 0;
      s.exitForRelog = 1;
      s.host.alert?.('hangup');
      return 0;
    }
  }
  if ((perms & RemoteFlag.QueryVersion) !== 0 && starts('@home ') && s.BBS_IsMudop !== 0)
    return home(c);
  return notCommand(c, line);
}
