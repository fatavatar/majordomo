/**
 * Everything a room asks of whoever would leave it, as the console's tags
 * beside its name (2026-10-18): a room command's button says where it leads
 * and what it needs, a hidden exit the realm marks searchable is a `search`
 * button, and every other way out with something in it — a door, a key and
 * whether it is carried, a hidden way and the word or lever that opens it, a
 * trap, a toll, a gate, a spell it casts — is a tag of its own, as is a spell
 * the room casts on whoever is in it.
 *
 * The buttons keep `actions.ts`' rule: only commands the realm's own data
 * names (an exit's or a room script's phrase) or the server's own command
 * table holds (`search <direction>`, which the engine sends for a hidden exit
 * itself). The tags send nothing; they say what the realm says.
 *
 * Answered from the room's *name*, before its exits print, as `markFor` is —
 * so a name several rooms share is answered only where they all agree. Rooms
 * that disagree get nothing rather than another room's tags.
 */
import type { TerminalNote } from '../../shared/types';
import { roomId, type Direction, type RoomId } from '../../shared/world';
import type { WorldGraph } from '../world/WorldGraph';
import { describeObstacle } from '../world/obstacle';
import { t } from '../app/i18n';

/** A room's tags: the buttons with their commands, and the tags beside them. */
export interface RoomTags {
  commands: Array<{ label: string; commands: string[]; title: string }>;
  notes: TerminalNote[];
}

/** What stands in an exit, as the tone the map's bars draw it in (`MapGlyphs.toneOf`). */
const TONES: Record<string, string> = {
  door: 'door',
  key: 'key',
  toll: 'toll',
  trap: 'trap',
  level: 'gate',
  class: 'gate',
  race: 'gate',
  alignment: 'gate',
  ability: 'gate',
  cast: 'cast',
  spell: 'cast'
};

/** A room's name and number, as a tag's title says where a way leads; null where it is not said. */
function placeOf(world: WorldGraph, to: RoomId, placed: boolean): string | null {
  if (!placed) return null;
  const room = world.byId(to);
  return room === undefined ? to : `${room.name} (${to})`;
}

/** A command's tooltip: where it leads where that is said, and what it needs where it needs something. */
function commandTitle(command: string, to: string | null, detail: string | null): string {
  if (to === null)
    return detail === null
      ? t('terminal.tags.command', { command })
      : t('terminal.tags.commandNeeding', { command, detail });
  return detail === null
    ? t('terminal.tags.leads', { command, room: to })
    : t('terminal.tags.leadsNeeding', { command, room: to, detail });
}

/** One room's tags. */
function tagsOf(
  world: WorldGraph,
  map: number,
  number: number,
  carries: (item: number) => boolean,
  /** Where each way leads, said; off where rooms sharing the name lead to different places. */
  placed = true
): RoomTags {
  const here = roomId(map, number);
  const room = world.byId(here)!;
  const commands: RoomTags['commands'] = [];
  const notes: TerminalNote[] = [];
  const said = new Set<string>();
  for (const exit of room.exits) {
    const requirement = exit.requirement;
    if (requirement === undefined || requirement === null) continue;
    const direction = exit.direction as Direction;
    const to = placeOf(world, world.beyond(exit), placed);
    const obstacle = describeObstacle(requirement, world, world.leversHere(here, direction));
    const command = requirement.commands?.[0]?.trim();
    if (command) {
      if (said.has(command)) continue;
      said.add(command);
      commands.push({
        label: command,
        commands: [command],
        title: commandTitle(command, to, requirement.kind === 'text' ? null : obstacle.detail)
      });
      continue;
    }
    if (requirement.kind === 'hidden' && requirement.searchable === true) {
      const search = `search ${direction}`;
      commands.push({
        label: search,
        commands: [search],
        title:
          to === null
            ? t('terminal.tags.searchHere', { direction })
            : t('terminal.tags.search', { direction, room: to })
      });
      continue;
    }
    /*
     * A lever that opens it, pulled in this room: its phrase is the realm's
     * own, so it is a button; pulled elsewhere, a tag saying where.
     */
    const levers = world.leversHere(here, direction);
    const lever = levers.find((way) => way.at === here);
    if (lever !== undefined && !said.has(lever.say)) {
      said.add(lever.say);
      const opens = commandTitle(lever.say, to, null);
      const item =
        lever.item === undefined ? null : (world.item(lever.item)?.name ?? `#${lever.item}`);
      commands.push({
        label: lever.say,
        commands: [lever.say],
        title:
          item === null
            ? t('terminal.tags.lever', { direction, opens })
            : t('terminal.tags.leverItem', { direction, opens, item })
      });
      continue;
    }
    const keyId = requirement.kind === 'key' ? requirement.keyId : undefined;
    const keyName =
      keyId === undefined ? null : (world.item(keyId)?.name ?? t('terminal.tags.keyUnknown'));
    const label =
      levers.length > 0
        ? t('terminal.tags.leverElsewhere', { direction, room: levers[0]!.roomName })
        : keyName !== null
          ? carries(keyId!)
            ? t('terminal.tags.keyCarried', { direction, key: keyName })
            : t('terminal.tags.keyMissing', { direction, key: keyName })
          : t('terminal.tags.exit', { direction, label: obstacle.label });
    notes.push({
      label,
      title:
        to === null
          ? t('terminal.tags.exitHere', { direction, detail: obstacle.detail })
          : t('terminal.tags.exitTitle', { direction, room: to, detail: obstacle.detail }),
      tone: TONES[requirement.kind] ?? 'hidden'
    });
  }
  // The room's own script, where it moves you: the realm's phrase, and where it lands.
  for (const portal of world.portalsFrom(here)) {
    const command = portal.requirement.commands?.[0]?.trim();
    if (!command || said.has(command)) continue;
    said.add(command);
    const to = placeOf(world, world.beyond(portal), placed);
    commands.push({
      label: command,
      commands: [command],
      title: commandTitle(
        command,
        to,
        portal.requirement.kind === 'text'
          ? null
          : describeObstacle(portal.requirement, world).detail
      )
    });
  }
  // A spell the room casts on whoever is in it, and what stops it.
  const spell = room.spell === undefined ? null : world.spellById(room.spell);
  if (spell !== null) {
    const hazard = world.hazardOf(room);
    const stoppedBy = (hazard?.avoidedBy ?? []).map((id) => world.item(id)?.name ?? `#${id}`);
    notes.push({
      label: t('terminal.tags.roomSpell', { spell: spell.name }),
      title: [
        t('terminal.tags.roomSpellTitle', { spell: spell.name }),
        ...(hazard?.damage === undefined
          ? []
          : [t('terminal.tags.roomSpellDamage', { damage: hazard.damage })]),
        ...(stoppedBy.length === 0
          ? []
          : [t('terminal.tags.roomSpellStopped', { items: stoppedBy.join(', ') })])
      ].join(' '),
      tone: 'cast'
    });
  }
  return { commands, notes };
}

/**
 * The tags for the room the console has just named: for `room` where the
 * tracker knows which it is about to be (`roomAboutToPrint`), and otherwise
 * by the name, only where every room with it agrees. Null where there is
 * nothing to say, no room has the name, or the rooms that do disagree.
 */
export function roomTagsNamed(
  world: WorldGraph,
  name: string,
  carries: (item: number) => boolean,
  room: RoomId | null = null
): RoomTags | null {
  const known = room === null ? undefined : world.byId(room);
  if (known !== undefined) {
    const tags = tagsOf(world, known.map, known.room, carries);
    return tags.commands.length > 0 || tags.notes.length > 0 ? tags : null;
  }
  const rooms = world.findByName(name);
  if (rooms.length === 0) return null;
  const all = rooms.map((room) => tagsOf(world, room.map, room.room, carries));
  // Agreeing on what is sent and said, or nothing: another room's tags are a guess.
  const said = (tags: RoomTags): string =>
    JSON.stringify([tags.commands.map((c) => c.commands), tags.notes.map((n) => n.label)]);
  const first = all[0]!;
  if (all.some((tags) => said(tags) !== said(first))) return null;
  if (first.commands.length === 0 && first.notes.length === 0) return null;
  // Where the ways lead differs from room to room: said without it.
  const titles = (tags: RoomTags): string =>
    JSON.stringify([tags.commands.map((c) => c.title), tags.notes.map((n) => n.title)]);
  if (all.some((tags) => titles(tags) !== titles(first)))
    return tagsOf(world, rooms[0]!.map, rooms[0]!.room, carries, false);
  return first;
}
