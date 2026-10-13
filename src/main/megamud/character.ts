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
import type { MegaSettings } from '../../shared/megamud/settings';
import type { RemoteName } from '../../shared/remotes';
import { loadMonitors } from './abilities/monitors';
import { newPlayer } from './data';
import { applySettings } from './fieldNames';
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

export function loadCharacter(s: Session, mega: MegaSettings): void {
  applySettings(s, mega, SETTINGS);
  loadMonitors(s, reader(mega, 'AbilMon'));
  loadEvents(s, reader(mega, 'Schedule'));
  loadRules(s, reader(mega, 'Rules'));
}

/**
 * Which of MegaMUD's remote bits (`0x4ae4a0`) each of the app's remote names
 * falls under: 1 version and `@home`, 2 experience, 4 health and status,
 * 0x10 location, 0x20 inventory (and `@join`), 0x40 invite, 0x100 move,
 * 0x200 commands, 0x400 hang up, 0x800 settings, 0x1000 divert.
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
  do: 0x200,
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

/** Each granted player made known with its remote bits (a record learned in play keeps its others). */
export function grantPlayers(
  s: Session,
  grants: Readonly<Record<string, { allow: readonly RemoteName[]; deny: readonly RemoteName[] }>>
): void {
  for (const [key, grant] of Object.entries(grants)) {
    const name = key.charAt(0).toUpperCase() + key.slice(1);
    let p = s.data.players?.find((x) => x.name.toLowerCase() === key.toLowerCase());
    if (!p) {
      p = newPlayer(s.data, s.now);
      p.name = name.slice(0, 19);
    }
    p.remote = remoteBits(grant.allow, grant.deny);
  }
}
