/**
 * A character's settings put on the session, as `0x449aa0` fills the struct
 * from its `.ini`: every key onto its field, then the sections read by
 * their own loaders, `[AbilMon]` (`0x404140`), `[Schedule]` (`0x437870`)
 * and `[Rules]` (`0x49c820`).
 *
 * The remote control each player is allowed is MegaMUD's Players.md
 * (`+0x6c`); until that file is read here, the app's own per-player grants
 * (`automation.remotes.players`) are converted to it (`remoteBits`).
 */
import { SETTINGS } from '../../shared/megamud/schema';
import type { MegaSettings, ProfiledSection } from '../../shared/megamud/settings';
import { clearCastMode } from './combat/engaged';
import { forgetRoomMonsters, forgetRoomPlayers } from './script/game';
import type { PlayerGrant, RemoteName } from '../../shared/remotes';
import { loadMonitors } from './abilities/monitors';
import { newPlayer } from './data';
import { applySettings, fieldName } from './fieldNames';
import { loadEvents } from './script/events';
import { loadRules } from './script/rules';
import type { Session } from './Session';

/** A section outside the schema, its keys read without regard to case ('' when missing). */
function reader(mega: MegaSettings, name: string): (key: string) => string {
  const section = mega.extra.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return (key) => {
    const lower = key.toLowerCase();
    return section?.entries.find(([k]) => k.toLowerCase() === lower)?.[1] ?? '';
  };
}

/**
 * A combat spell's cast limit of 0 is no limit here. MegaMUD reads it as none
 * (`0x40f510` casts while `cap != 0 && done < cap`; its help: "0 means zero,
 * not unlimited"), which turned Skinny's main attack off when his limit was
 * cleared (13 October 2026). Ours is the value's meaning, not a decision: the
 * decisions are MegaMUD's, counted against a limit nothing reaches. As large
 * as MegaMUD's own "no limit" for damage.
 */
const NO_CAST_LIMIT = 99999;
const CAST_LIMITS = [
  'Combat_PreMultCastCnt',
  'Combat_MultCastCnt',
  'Combat_PreCastCnt',
  'Combat_MaxCastCnt',
  'Combat_MaxCastCnt2'
] as const;

function noCastLimits(s: Session): void {
  for (const field of CAST_LIMITS) if (s[field] === 0) s[field] = NO_CAST_LIMIT;
}

/** The tabs a config profile can be kept for, as `0x447c90` names them. */
const PROFILE_TABS: readonly [ProfiledSection, string][] = [
  ['Combat', 'combat'],
  ['Health', 'health'],
  ['Spells', 'spells']
];

/** Profile `n` of a tab is there and enabled (`0xbe44`, `0xcf94`, `0xd804` + `n`·4). */
function profileOn(s: Session, section: ProfiledSection, n: number): boolean {
  return n >= 1 && n <= 4 && s.settings?.profiles[section]?.[n - 1]?.enabled === true;
}

/**
 * `0x446910`: config profile `n` put on, where any tab has it enabled — each
 * tab its copy `n`, else its first (`0x447290`) — and what the old one was
 * doing let go: the rest-to-full marks, the cast mode, the room's marks.
 * 1 when it was.
 */
export function activateProfile(s: Session, n: number): number {
  if (n < 1 || n > 4 || !PROFILE_TABS.some(([section]) => profileOn(s, section, n))) return 0;
  const fields = s as unknown as Record<string, number | string>;
  for (const [section] of PROFILE_TABS) {
    const slot = s.settings?.profiles[section]?.[(profileOn(s, section, n) ? n : 1) - 1];
    if (!slot) continue;
    for (const def of SETTINGS) {
      if (def.section !== section || !def.profiled) continue;
      const name = fieldName(def);
      const value = slot.values[def.key];
      if (name !== null && value !== undefined) fields[name] = value;
    }
  }
  noCastLimits(s);
  s.Profiles_ActiveProfile = n;
  s.f_e240 = 1;
  s.f_327b0 = 0;
  s.f_327b4 = 0;
  s.f_327b8 = 0;
  s.restHpToFull = 0;
  s.restManaToFull = 0;
  s.hpFullAt = 0;
  s.manaFullAt = 0;
  clearCastMode(s);
  forgetRoomMonsters(s);
  forgetRoomPlayers(s);
  return 1;
}

/**
 * `0x446560`: the player's `@profile <n>`, said as MegaMUD says it. 1 when
 * the profile was put on.
 */
export function useProfile(s: Session, n: number): number {
  if (s.f_d81c !== 0) {
    s.host.show('[Config Profile Not Activated (settings window is open)]');
    return 0;
  }
  if (n < 1 || n > 4) {
    s.host.show(`[Config Profile ${s.Profiles_ActiveProfile} Is Active (use 1-4)]`);
    return 0;
  }
  if (activateProfile(s, n) === 0) {
    s.host.show(`[Config Profile ${n} Not Activated (not enabled on any tab)]`);
    return 0;
  }
  if (n === 1) {
    s.host.show('[Config Profile 1 Activated (default)]');
    return 1;
  }
  // `0x447c90`: the tabs it is kept for, joined by `+`.
  const tabs = PROFILE_TABS.filter(([section]) => profileOn(s, section, n)).map(([, w]) => w);
  s.host.show(`[Config Profile ${n} Activated (${tabs.join('+')})]`);
  return 1;
}

export function loadCharacter(s: Session, mega: MegaSettings): void {
  s.settings = mega;
  applySettings(s, mega, SETTINGS);
  noCastLimits(s);
  loadMonitors(s, reader(mega, 'AbilMon'));
  loadEvents(s, reader(mega, 'Schedule'));
  loadRules(s, reader(mega, 'Rules'));
}

/**
 * Which of MegaMUD's remote bits (`0x4ae4a0`) each of the app's remote names
 * falls under: 1 version and `@home`, 2 experience, 4 health and status,
 * 0x10 location, 0x20 inventory (and `@join`), 0x40 invite, 0x100 move,
 * 0x200 commands, 0x400 hang up, 0x800 settings, 0x1000 divert, 0x2000 `sys` commands.
 */
const BITS: Partial<Record<RemoteName, number>> = {
  version: 1,
  home: 1,
  exp: 2,
  level: 2,
  health: 4,
  status: 4,
  lives: 4,
  where: 0x10,
  'where-room': 0x10,
  path: 0x10,
  who: 0x10,
  seen: 0x10,
  what: 0x10,
  wealth: 0x20,
  enc: 0x20,
  have: 0x20,
  join: 0x20,
  invite: 0x40,
  goto: 0x100,
  loop: 0x100,
  looponce: 0x100,
  roam: 0x100,
  stop: 0x100,
  rego: 0x100,
  comeback: 0x100,
  'comeback-room': 0x100,
  // And `sys` commands with it (0x2000, a MUD op's): our `do` has always run
  // whatever it was given, and Fatty's `@do sys goto` went undone (2026-10-14).
  do: 0x200 | 0x2000,
  'get-all': 0x200,
  'drop-all': 0x200,
  'equip-all': 0x200,
  'deposit-all': 0x200,
  hangup: 0x400,
  relog: 0x400,
  settings: 0x800,
  'auto-all': 0x800,
  'auto-combat': 0x800,
  'auto-nuke': 0x800,
  'auto-heal': 0x800,
  'auto-bless': 0x800,
  'auto-light': 0x800,
  'auto-cash': 0x800,
  'auto-get': 0x800,
  'auto-sneak': 0x800,
  'auto-hide': 0x800,
  'auto-search': 0x800,
  divert: 0x1000
};

/** The remote bits a grant comes to: a bit is given when any name under it is allowed and none denied. */
export function remoteBits(allow: readonly RemoteName[], deny: readonly RemoteName[]): number {
  let bits = 0;
  for (const name of allow) bits |= BITS[name] ?? 0;
  for (const name of deny) bits &= ~(BITS[name] ?? 0);
  return bits;
}

/** A player's flag: invite to the party when seen (`0x407ee0`'s scan). */
const INVITE_IF_SEEN = 0x10;
/** A player's flag: join their party when they invite (`0x47e1ac`). */
const JOIN_IF_INVITED = 0x20;

/**
 * Each granted player made known with its remote bits (a record learned in
 * play keeps its others), and the two party flags our grants state:
 * Auto Invite when seen, and, with Join When Invited on, joining a player
 * granted `join` when they invite. Neither reached the engine before
 * (2026-10-15).
 */
export function grantPlayers(
  s: Session,
  grants: Readonly<Record<string, PlayerGrant>>,
  joinWhenInvited = false
): void {
  for (const [key, grant] of Object.entries(grants)) {
    const name = key.charAt(0).toUpperCase() + key.slice(1);
    let p = s.data.players?.find((x) => x.name.toLowerCase() === key.toLowerCase());
    if (!p) {
      p = newPlayer(s.data, s.now);
      p.name = name.slice(0, 19);
    }
    p.remote = remoteBits(grant.allow, grant.deny);
    const join = joinWhenInvited && grant.allow.includes('join') && !grant.deny.includes('join');
    p.flags =
      (p.flags & ~(INVITE_IF_SEEN | JOIN_IF_INVITED)) |
      (grant.autoInviteWhenSeen === true ? INVITE_IF_SEEN : 0) |
      (join ? JOIN_IF_INVITED : 0);
  }
}
