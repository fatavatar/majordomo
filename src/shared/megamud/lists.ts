/**
 * The parts of a character's MegaMUD settings its settings window edits
 * through a list or a builder rather than a box per key, read 2026-10-14:
 *
 * - the timed events, `[Schedule]`'s `EventN` (`0x437870`, the editor
 *   `0x435f80`);
 * - the ability monitors, `[AbilMon]`'s `MonitorN` and `MonitorNMsg`
 *   (`0x404140`, written as `0x4048f0` writes them);
 * - the status line command the Statline tab builds (`0x4a5f00`) and the
 *   line it shows for it (`0x4a6920`).
 *
 * Read and written here as the engine's loaders read them (`script/events.ts`,
 * `abilities/monitors.ts`), so what the window saves is what the engine runs.
 */
import type { MegaSettings } from './settings';

/* ------------------------------------------------------------ events */

/** An event's kind, as the dialog's radio buttons number it. */
export const EVENT_TYPES = [1, 2, 3, 4, 6, 5] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** How a repeating event's period is kept in its hour: hours -3, minutes -1, seconds -2. */
export const EVERY_UNITS = [-3, -1, -2] as const;
export type EveryUnit = (typeof EVERY_UNITS)[number];

export interface ScheduledEvent {
  /** 1 log on, 2 log off, 3 relog, 4 go to a room, 5 a command, 6 a loop. */
  type: EventType;
  /** "Event disabled": kept as the type negated. */
  disabled: boolean;
  /** Daily at `hour`:`minute`, or every `count` of `unit`. */
  at: { hour: number; minute: number } | { every: number; unit: EveryUnit };
  /** The room, command or loop; 80 characters. */
  text: string;
}

/** A number at the front of `text`, and the text after it and one `:` (`0x4ad430`, `0x4acb90`). */
function field(text: string): [number, string] {
  const m = /^ *(-?\d*)/.exec(text)!;
  const rest = text.slice(m[0].length);
  return [Number(m[1]) | 0, rest.startsWith(':') ? rest.slice(1) : rest];
}

/** One raw section's entries, by key. */
function section(settings: MegaSettings, name: string): Map<string, string> {
  const found = settings.extra.find((s) => s.name.toLowerCase() === name.toLowerCase());
  return new Map((found?.entries ?? []).map(([key, value]) => [key.toLowerCase(), value]));
}

/** The settings with one raw section replaced (or gone, when empty). */
function withSection(
  settings: MegaSettings,
  name: string,
  entries: [string, string][]
): MegaSettings {
  const next = structuredClone(settings);
  next.extra = next.extra.filter((s) => s.name.toLowerCase() !== name.toLowerCase());
  if (entries.length > 0) next.extra.push({ name, entries });
  return next;
}

/** The character's timed events, read until an `EventN` is missing (`0x437870`). */
export function eventsOf(settings: MegaSettings): ScheduledEvent[] {
  const keys = section(settings, 'Schedule');
  const out: ScheduledEvent[] = [];
  for (let n = 0; ; n += 1) {
    let text = (keys.get(`event${n}`) ?? '').slice(0, 0xff);
    if (text === '') break;
    let type: number;
    let hour: number;
    let minute: number;
    [type, text] = field(text);
    [hour, text] = field(text);
    [minute, text] = field(text);
    const kind = Math.abs(type);
    if (!(EVENT_TYPES as readonly number[]).includes(kind)) continue;
    out.push({
      type: kind as EventType,
      disabled: type < 0,
      at:
        hour >= 0
          ? { hour, minute }
          : {
              every: minute,
              unit: (EVERY_UNITS as readonly number[]).includes(hour) ? (hour as EveryUnit) : -1
            },
      text: text.slice(0, 0x50)
    });
  }
  return out;
}

/** The events written back as `0x437a10` writes them: `type:hour:minute:text`. */
export function withEvents(
  settings: MegaSettings,
  events: readonly ScheduledEvent[]
): MegaSettings {
  return withSection(
    settings,
    'Schedule',
    events.map((e, n) => {
      const type = e.disabled ? -e.type : e.type;
      const [hour, minute] =
        'every' in e.at ? [e.at.unit, Math.max(1, e.at.every)] : [e.at.hour, e.at.minute];
      return [`Event${n}`, `${type}:${hour}:${minute}:${e.text.slice(0, 0x50)}`];
    })
  );
}

/* ------------------------------------------------------------ ability monitors */

/** When a monitor is checked: its `when` bits, in the dialog's order. */
export const MONITOR_WHEN = [
  { bit: 0x2, label: 'Before resting' },
  { bit: 0x4, label: 'After resting' },
  { bit: 0x20, label: 'Before meditating' },
  { bit: 0x40, label: 'After meditating' },
  { bit: 0x8, label: 'After combat round' },
  { bit: 0x10, label: 'Start of any path/loop' },
  { bit: 0x80, label: 'The selected spell above is cast' }
] as const;

/** Every `interval` seconds. */
export const MONITOR_EVERY = 0x1;
/** A line starting with `message`. */
export const MONITOR_MESSAGE = 0x100;

export interface AbilityMonitorRow {
  disabled: boolean;
  ability: number;
  /** 0 the total, 1 granted, 2 worn, 3 spells, 4 race, 5 class. */
  part: number;
  /** Fires when the value is 0 below, 1 equal to, 2 above `value`. */
  compare: number;
  value: number;
  /** 0 cast `spell`, 1 send `command`. */
  useCommand: number;
  when: number;
  interval: number;
  /** "Re-check value after action". */
  chainOn: boolean;
  /** "After the monitor above resolves (chained)". */
  chained: boolean;
  /** "Prevent movement until resolved". */
  urgent: boolean;
  /** A spell's short name, 6 characters. */
  spell: string;
  command: string;
  message: string;
}

export const MONITOR_PARTS = ['Total', 'Granted', 'Worn', 'Spells', 'Race', 'Class'] as const;
export const MONITOR_COMPARES = ['<', '=', '>'] as const;

export function newMonitorRow(): AbilityMonitorRow {
  return {
    disabled: false,
    ability: 1,
    part: 0,
    compare: 0,
    value: 0,
    useCommand: 1,
    when: MONITOR_EVERY,
    interval: 60,
    chainOn: false,
    chained: false,
    urgent: false,
    spell: '',
    command: '',
    message: ''
  };
}

/** The monitors, read as `0x404140` reads them, until a `MonitorN` is missing. */
export function monitorsOf(settings: MegaSettings): AbilityMonitorRow[] {
  const keys = section(settings, 'AbilMon');
  const out: AbilityMonitorRow[] = [];
  for (let n = 0; ; n += 1) {
    let text = (keys.get(`monitor${n}`) ?? '').slice(0, 0xff);
    if (text === '') break;
    const m = newMonitorRow();
    let v: number;
    [v, text] = field(text);
    m.disabled = v !== 0;
    [m.ability, text] = field(text);
    [m.part, text] = field(text);
    [m.compare, text] = field(text);
    [m.value, text] = field(text);
    [m.useCommand, text] = field(text);
    [v, text] = field(text);
    m.when = v >>> 0;
    [m.interval, text] = field(text);
    [v, text] = field(text);
    m.chainOn = v !== 0;
    if (/^\d+:/.test(text)) {
      [v, text] = field(text);
      m.chained = v !== 0;
    }
    if (/^\d+:/.test(text)) {
      [v, text] = field(text);
      m.urgent = v !== 0;
    }
    const colon = text.indexOf(':');
    m.spell = (colon === -1 ? text : text.slice(0, colon)).slice(0, 6);
    m.command = (colon === -1 ? '' : text.slice(colon + 1)).slice(0, 0x50);
    m.message = (keys.get(`monitor${n}msg`) ?? '').slice(0, 0x50);
    m.part = Math.min(Math.max(m.part, 0), 5);
    m.compare = Math.min(Math.max(m.compare, 0), 2);
    m.useCommand = Math.min(Math.max(m.useCommand, 0), 1);
    if (m.ability >= 0) out.push(m);
  }
  return out;
}

/** The monitors written back as `0x4048f0` writes them. */
export function withMonitors(
  settings: MegaSettings,
  monitors: readonly AbilityMonitorRow[]
): MegaSettings {
  const entries: [string, string][] = [];
  monitors.forEach((m, n) => {
    const flag = (on: boolean): number => (on ? 1 : 0);
    entries.push([
      `Monitor${n}`,
      [
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
        m.spell.slice(0, 6),
        m.command.slice(0, 0x50)
      ].join(':')
    ]);
    if (m.message !== '') entries.push([`Monitor${n}Msg`, m.message.slice(0, 0x50)]);
  });
  return withSection(settings, 'AbilMon', entries);
}

/* ------------------------------------------------------------ the status line */

/**
 * The Statline tab's Item list (`0x4a6320`) and what Add puts in for each
 * (`0x4a5f00`); the mana item is `,KAI=%m` for a class whose magery is kai
 * (type 5) and `,MA=%m` for any other. The two colour items take the colour
 * list's index after them.
 */
export const STATLINE_ITEMS = [
  { label: "Current HP's", token: '[HP=%h' },
  { label: "Maximum HP's", token: '/%H' },
  { label: 'Current mana/kai', token: ',MA=%m' },
  { label: 'Maximum mana/kai', token: '/%M' },
  { label: 'Current wealth', token: ',Wealth=%c' },
  { label: 'Current experience', token: ',Exp=%x' },
  { label: 'Experience needed to level', token: ',Need=%X' },
  { label: 'Warning state', token: ',Warn=%w' },
  { label: 'Resting state', token: '%r' },
  { label: 'Newline character', token: '%n' },
  { label: 'Foreground colour', token: '%f' },
  { label: 'Background colour', token: '%b' },
  { label: 'Default colours', token: '%d' },
  { label: 'Bold', token: '%B' },
  { label: 'Normal', token: '%N' },
  { label: 'Underline', token: '%U' },
  { label: 'Blink', token: '%L' },
  { label: 'Reverse', token: '%R' }
] as const;

export const STATLINE_COLOURS = [
  'Black',
  'Red',
  'Green',
  'Yellow',
  'Blue',
  'Magenta',
  'Cyan',
  'White'
] as const;

/** The Default button (`0x4a6300`). */
export const STATLINE_DEFAULT = 'full';

/**
 * `0x4a5f00`: an item added to the statline command. A leading `full` and
 * `custom` are taken off and `full custom ` put back; a line with nothing
 * after that starts `[HP=%h` (which item 0 then adds nothing to); the item
 * goes in before `]:` when there is one, else at the end with `]:%r` after.
 */
export function statlineAdd(command: string, item: number, colour: number, kai: boolean): string {
  let token: string =
    item === 2 && kai
      ? ',KAI=%m'
      : item === 10 || item === 11
        ? `${STATLINE_ITEMS[item]!.token}${colour}`
        : (STATLINE_ITEMS[item]?.token ?? '?');
  let text = command;
  if (text.startsWith('full')) {
    text = text.slice(4);
    if (text.startsWith(' ')) text = text.slice(1);
  }
  if (text.startsWith('custom')) {
    text = text.slice(6);
    if (text.startsWith(' ')) text = text.slice(1);
  }
  if (!text.startsWith('full custom ')) text = `full custom ${text}`;
  if (text === 'full custom ') {
    text += '[HP=%h';
    if (item === 0) token = '';
  }
  const close = text.indexOf(']:');
  if (close === -1) return `${text}${token}]:%r`;
  return token === '' ? text : `${text.slice(0, close)}${token}${text.slice(close)}`;
}

/**
 * The figure beside a Health percentage, as `0x442dc0` writes it whenever the
 * box changes: that share of the maximum, `[n/max]`, or `[n]` once the
 * maximum is past 999 (read 2026-10-16).
 */
export function healthShare(percent: number, max: number): string {
  const n = Math.trunc((Math.min(100, Math.max(0, Math.trunc(percent))) * max) / 100);
  return max > 999 ? `[${n}]` : `[${n}/${max}]`;
}

/** What the line shows for: the character's figures as they are. */
export interface StatlineSample {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  wealth: number;
  exp: number;
  need: number;
  kai: boolean;
}

/**
 * `0x4a6920`: the status line a command gives, as the tab shows it. `full`
 * alone is `%d[HP=%h` with `,MA=%m` (or `,KAI=%m`) when there is mana, and
 * `]:%r`; the colour and style items show nothing, and anything else is as
 * written.
 */
export function statlinePreview(command: string, sample: StatlineSample): string {
  let text = command;
  if (text === 'full') {
    text = '%d[HP=%h';
    if (sample.maxMana > 0) text += sample.kai ? ',KAI=%m' : ',MA=%m';
    text += ']:%r';
  }
  if (text.startsWith('full ')) text = text.slice(5);
  if (text.startsWith('custom ')) text = text.slice(7);
  const values: Record<string, string> = {
    h: String(sample.hp),
    H: String(sample.maxHp),
    m: String(sample.mana),
    M: String(sample.maxMana),
    c: String(sample.wealth),
    x: String(sample.exp),
    X: String(sample.need),
    w: 'Off',
    r: ' (Resting) ',
    n: '\n'
  };
  let out = '';
  for (let i = 0; i < text.length;) {
    const two = text.slice(i, i + 2);
    const code = two[1] ?? '';
    if (two.length === 2 && two[0] === '%' && code in values) {
      out += values[code];
      i += 2;
    } else if (two === '%f' || two === '%b') {
      i += /[0-7]/.test(text[i + 2] ?? '') ? 3 : 2;
    } else if (two.length === 2 && two[0] === '%' && 'dBNULR'.includes(code)) {
      i += 2;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}
