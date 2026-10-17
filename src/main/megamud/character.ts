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
import { PlayerFlag, RemoteFlag } from './flags';

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
  if (s.settingsWindowOpen !== 0) {
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
 * The `[Player]` section's fields: the character as the realm last said it
 * is (its name, level, figures), which MegaMUD reads off the stat sheet and
 * writes to the file, not settings anybody edits.
 */
const PLAYER_FIELDS = SETTINGS.filter((def) => def.section === 'Player')
  .map(fieldName)
  .filter((name): name is string => name !== null);

/**
 * A character's settings changed while it plays: loaded again, but for what
 * the realm has said of it (`PLAYER_FIELDS`). Our file never holds those
 * readings, so loading it whole put back `Name=*Not Known*` and level 0
 * until the next stat sheet; and in the meantime the engine took itself for
 * a stranger in its own party and telepathed itself `@health` after every
 * listing (Archer, 2026-10-16: `Why are you telepathing to yourself?`).
 */
export function reloadCharacter(s: Session, mega: MegaSettings): void {
  const fields = s as unknown as Record<string, unknown>;
  const read = PLAYER_FIELDS.map((name) => [name, fields[name]] as const);
  loadCharacter(s, mega);
  for (const [name, value] of read) fields[name] = value;
}

/**
 * Which of MegaMUD's remote bits (`RemoteFlag`, `0x4ae4a0`) each of the app's
 * remote names falls under (`@home` under `QueryVersion`, `@join` under
 * `QueryInventory`, `@do` also needing `SysopCommands` for `sys`).
 */
const BITS: Partial<Record<RemoteName, number>> = {
  version: RemoteFlag.QueryVersion,
  home: RemoteFlag.QueryVersion,
  exp: RemoteFlag.QueryExperience,
  level: RemoteFlag.QueryExperience,
  health: RemoteFlag.QueryHealth,
  status: RemoteFlag.QueryHealth,
  lives: RemoteFlag.QueryHealth,
  where: RemoteFlag.QueryLocation,
  'where-room': RemoteFlag.QueryLocation,
  path: RemoteFlag.QueryLocation,
  who: RemoteFlag.QueryLocation,
  seen: RemoteFlag.QueryLocation,
  what: RemoteFlag.QueryLocation,
  wealth: RemoteFlag.QueryInventory,
  enc: RemoteFlag.QueryInventory,
  have: RemoteFlag.QueryInventory,
  join: RemoteFlag.QueryInventory,
  invite: RemoteFlag.RequestInvite,
  goto: RemoteFlag.MovePlayer,
  loop: RemoteFlag.MovePlayer,
  looponce: RemoteFlag.MovePlayer,
  roam: RemoteFlag.MovePlayer,
  stop: RemoteFlag.MovePlayer,
  rego: RemoteFlag.MovePlayer,
  comeback: RemoteFlag.MovePlayer,
  'comeback-room': RemoteFlag.MovePlayer,
  // And `sys` commands with it (0x2000, a MUD op's): our `do` has always run
  // whatever it was given, and Fatty's `@do sys goto` went undone (2026-10-14).
  do: RemoteFlag.ExecuteCommands | RemoteFlag.SysopCommands,
  'get-all': RemoteFlag.ExecuteCommands,
  'drop-all': RemoteFlag.ExecuteCommands,
  'equip-all': RemoteFlag.ExecuteCommands,
  'deposit-all': RemoteFlag.ExecuteCommands,
  hangup: RemoteFlag.Hangup,
  relog: RemoteFlag.Hangup,
  settings: RemoteFlag.AlterSettings,
  'auto-all': RemoteFlag.AlterSettings,
  'auto-combat': RemoteFlag.AlterSettings,
  'auto-nuke': RemoteFlag.AlterSettings,
  'auto-heal': RemoteFlag.AlterSettings,
  'auto-bless': RemoteFlag.AlterSettings,
  'auto-light': RemoteFlag.AlterSettings,
  'auto-cash': RemoteFlag.AlterSettings,
  'auto-get': RemoteFlag.AlterSettings,
  'auto-sneak': RemoteFlag.AlterSettings,
  'auto-hide': RemoteFlag.AlterSettings,
  'auto-search': RemoteFlag.AlterSettings,
  divert: 0x1000
};

/** The remote bits a grant comes to: a bit is given when any name under it is allowed and none denied. */
export function remoteBits(allow: readonly RemoteName[], deny: readonly RemoteName[]): number {
  let bits = 0;
  for (const name of allow) bits |= BITS[name] ?? 0;
  for (const name of deny) bits &= ~(BITS[name] ?? 0);
  return bits;
}

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
      (p.flags & ~(PlayerFlag.InviteIfSeen | PlayerFlag.JoinIfInvited)) |
      (grant.autoInviteWhenSeen === true ? PlayerFlag.InviteIfSeen : 0) |
      (join ? PlayerFlag.JoinIfInvited : 0);
  }
}
