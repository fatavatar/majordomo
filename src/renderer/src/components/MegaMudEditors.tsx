/**
 * The controls of MegaMUD's settings tabs that are not one box per setting:
 * the lists and buttons its window fills and answers itself (the events and
 * ability monitors, the toolbar's items, the statline
 * builder, the alert sounds, Copy From..., the resets and the weapon
 * pickers), each read from `megamud.exe` (2026-10-14) and drawn where the
 * dialog puts it, in place of the control (`customControl`).
 *
 * And the controls not drawn here at all (`notHere`): MegaMUD's window's own,
 * which the engine never reads, and the settings this client already keeps
 * elsewhere, so each setting has one place.
 */
import { useState, type ReactNode } from 'react';

import { ABILITY } from '@shared/abilities';
import type { MegaChoices } from '@shared/ipc';
import {
  EVENT_TYPES,
  EVERY_UNITS,
  MONITOR_COMPARES,
  MONITOR_EVERY,
  MONITOR_MESSAGE,
  MONITOR_PARTS,
  MONITOR_WHEN,
  STATLINE_COLOURS,
  STATLINE_DEFAULT,
  STATLINE_ITEMS,
  eventsOf,
  monitorsOf,
  newMonitorRow,
  statlineAdd,
  statlinePreview,
  withEvents,
  withMonitors,
  type AbilityMonitorRow,
  type EventType,
  type EveryUnit,
  type ScheduledEvent
} from '@shared/megamud/lists';
import {
  copyProfileFrom,
  type MegaSettings,
  type ProfiledSection,
  type SettingValue
} from '@shared/megamud/settings';
import type { TabControl } from '@shared/megamud/settingsTabs';
import { MEGA_TOGGLES } from '@shared/megamud/toggles';
import { keepFocus } from '../lib/focus';

/**
 * What is not drawn, per tab: controls by id, and the labels and frames that
 * go with them by their text.
 *
 * - **General:** the data directory and its backups (the realm's data is our
 *   own, never MegaMUD's files) and Auto-connect (the Character row's own).
 * - **Display:** the screen's size and font, the confirmations, the colour
 *   mapping, the round timer, the taskbar, the clock, dark mode and the title
 *   bar: MegaMUD's window, which ours is. What the engine reads stays.
 * - **Talk:** the conversation log and its length, and Auto-AFK when
 *   minimized: the talk panel and the window's.
 * - **Other:** the back-scroll buffer and the command splitter: the console's.
 * - **Loot:** the runic coin's name, which is the realm's (`coins: runic`).
 * - **Sounds:** the sound file and its buttons: an alert is said here, so it
 *   is on or off (the list).
 * - **Toolbar:** showing it, standing it on end, and the custom commands: the
 *   Toolbar card's.
 */
const NOT_HERE: Readonly<Record<string, { ids: readonly number[]; texts: readonly string[] }>> = {
  General: { ids: [1115, 1524, 1977, 1667], texts: ['Directories', 'Data Files'] },
  Display: {
    ids: [
      1420, 1089, 1425, 1437, 1094, 1095, 1096, 1093, 1551, 1678, 1680, 1683, 1684, 1685, 1412,
      1679, 1989, 1994, 1686, 1691, 1869, 1879, 1999, 1894, 1895
    ],
    texts: ['Rows', 'Columns', 'Color Mapping']
  },
  Talk: {
    ids: [1222, 1650, 5181, 1552],
    texts: ['Keep last', 'conversation lines (5k max)']
  },
  Other: {
    ids: [1061, 1650],
    texts: ['Back-scroll buffer ', 'bytes', 'Command splitter character']
  },
  Loot: { ids: [1650], texts: ['Name of runic currency'] },
  Sounds: { ids: [1146, 1524, 1525, 1452], texts: ['Sound file'] },
  Toolbar: {
    ids: [1768, 1769, 1767, 1111],
    texts: ['Toolbar Options', 'Custom command']
  }
};

/** Whether a tab's control is drawn here. */
export function drawnHere(tab: string, c: TabControl): boolean {
  const out = NOT_HERE[tab];
  if (out === undefined) return true;
  if (c.id !== 65535 && out.ids.includes(c.id)) return false;
  return !(c.id === 65535 && out.texts.includes(c.text));
}

/** What a custom control is drawn with. */
export interface EditorContext {
  draft: MegaSettings;
  choices: MegaChoices | null;
  /** The loops the character can walk, for an event's loop. */
  loops: readonly string[];
  style: React.CSSProperties;
  set(section: string, key: string, value: SettingValue): void;
  update(change: (current: MegaSettings) => MegaSettings): void;
  /** The page's own picks (the selected row of a list), by name. */
  local: Readonly<Record<string, number>>;
  setLocal(name: string, value: number): void;
  /** A dialog over the page (an event's, a monitor's), or null to close it. */
  open(dialog: ReactNode | null): void;
}

/** The row picked in a list, or undefined for none. */
function picked(ctx: EditorContext, name: string): number | undefined {
  const at = ctx.local[name];
  return at === undefined || at < 0 ? undefined : at;
}

function value(settings: MegaSettings, section: string, key: string): SettingValue | undefined {
  return settings.live[section]?.[key];
}

function textOf(settings: MegaSettings, section: string, key: string): string {
  return String(value(settings, section, key) ?? '');
}

/* ------------------------------------------------------------ the dispatch */

/**
 * A control drawn by this module, or undefined for one drawn as its setting
 * is (`MegaMudSettings`'s `Control`).
 */
export function customControl(tab: string, c: TabControl, ctx: EditorContext): ReactNode {
  const make = CUSTOM[`${tab}:${c.id}`];
  return make === undefined ? undefined : make(ctx, c);
}

type Make = (ctx: EditorContext, c: TabControl) => ReactNode;

const CUSTOM: Readonly<Record<string, Make>> = {
  'Sounds:1527': (ctx) => <AlertList ctx={ctx} />,
  'Statline:1731': (ctx) => (
    <input
      className="megamud-control megamud-edit"
      readOnly
      style={ctx.style}
      value={statlinePreview(textOf(ctx.draft, 'MegaMud', 'StatLine'), sampleOf(ctx.choices))}
    />
  ),
  'Statline:1202': (ctx) => (
    <PickList ctx={ctx} name="statItem" options={STATLINE_ITEMS.map((item) => item.label)} />
  ),
  'Statline:1735': (ctx) => <PickList ctx={ctx} name="statColour" options={STATLINE_COLOURS} />,
  'Statline:1732': (ctx, c) => (
    <Press
      ctx={ctx}
      label={c.text}
      run={() =>
        ctx.set(
          'MegaMud',
          'StatLine',
          statlineAdd(
            textOf(ctx.draft, 'MegaMud', 'StatLine'),
            ctx.local['statItem'] ?? 0,
            ctx.local['statColour'] ?? 0,
            sampleOf(ctx.choices).kai
          )
        )
      }
    />
  ),
  'Statline:1733': (ctx, c) => (
    <Press ctx={ctx} label={c.text} run={() => ctx.set('MegaMud', 'StatLine', STATLINE_DEFAULT)} />
  ),
  'Toolbar:1763': (ctx) => <ToolbarItems ctx={ctx} />,
  'Toolbar:1765': (ctx, c) => <ToolbarFlag ctx={ctx} label={c.text} separator={false} />,
  'Toolbar:1766': (ctx, c) => <ToolbarFlag ctx={ctx} label={c.text} separator />,
  'Events:1137': (ctx) => <EventList ctx={ctx} />,
  'Events:1307': (ctx, c) => <Press ctx={ctx} label={c.text} run={() => editEvent(ctx, null)} />,
  'Events:1288': (ctx, c) => (
    <Press
      ctx={ctx}
      disabled={picked(ctx, 'event') === undefined}
      label={c.text}
      run={() => editEvent(ctx, picked(ctx, 'event') ?? null)}
    />
  ),
  'Events:1399': (ctx, c) => (
    <Press
      ctx={ctx}
      disabled={picked(ctx, 'event') === undefined}
      label={c.text}
      run={() => {
        const at = picked(ctx, 'event');
        if (at === undefined) return;
        ctx.update((s) =>
          withEvents(
            s,
            eventsOf(s).filter((_, i) => i !== at)
          )
        );
        ctx.setLocal('event', -1);
      }}
    />
  ),
  'Events:5155': (ctx) => <MonitorList ctx={ctx} />,
  'Events:5156': (ctx, c) => <Press ctx={ctx} label={c.text} run={() => editMonitor(ctx, null)} />,
  'Events:5157': (ctx, c) => (
    <Press
      ctx={ctx}
      disabled={picked(ctx, 'monitor') === undefined}
      label={c.text}
      run={() => editMonitor(ctx, picked(ctx, 'monitor') ?? null)}
    />
  ),
  'Events:5158': (ctx, c) => (
    <Press
      ctx={ctx}
      disabled={picked(ctx, 'monitor') === undefined}
      label={c.text}
      run={() => {
        const at = picked(ctx, 'monitor');
        if (at === undefined) return;
        ctx.update((s) =>
          withMonitors(
            s,
            monitorsOf(s).filter((_, i) => i !== at)
          )
        );
        ctx.setLocal('monitor', -1);
      }}
    />
  ),
  'Events:5176': (ctx, c) => <MoveMonitor ctx={ctx} by={-1} label={c.text} />,
  'Events:5177': (ctx, c) => <MoveMonitor ctx={ctx} by={1} label={c.text} />,
  'Health:5215': (ctx) => <CopyFrom ctx={ctx} section="Health" />,
  'Spells:5223': (ctx) => <CopyFrom ctx={ctx} section="Spells" />,
  'Combat:5207': (ctx) => <CopyFrom ctx={ctx} section="Combat" />,
  'Spells:5149': (ctx, c) => (
    <Press ctx={ctx} label={c.text} run={() => ctx.update(blessingsReset)} />
  ),
  'Combat:5109': (ctx, c) => (
    <Press ctx={ctx} label={c.text} run={() => ctx.update(spellCombatReset)} />
  ),
  'Combat:5101': (ctx) => <Carried ctx={ctx} pick="backstab" setting="BsWeapon" />,
  'Combat:5102': (ctx) => <Carried ctx={ctx} pick="weapons" setting="NrmWeapon" />,
  'Combat:5103': (ctx) => <Carried ctx={ctx} pick="weapons" setting="AltWeapon" />,
  'Combat:5104': (ctx) => <Carried ctx={ctx} pick="shields" setting="Shield" />
};

/* ------------------------------------------------------------ small parts */

/** A Windows label's `&` mnemonics, as the text a person reads. */
function plain(text: string): string {
  return text
    .replace(/&&/g, '\u0000')
    .replace(/&/g, '')
    .replace(/\u0000/g, '&');
}

function Press({
  ctx,
  label,
  run,
  disabled = false
}: {
  ctx: EditorContext;
  label: string;
  run(): void;
  disabled?: boolean;
}) {
  return (
    <button
      className="megamud-control megamud-button"
      disabled={disabled}
      onClick={run}
      onMouseDown={keepFocus}
      style={ctx.style}
      type="button"
    >
      {plain(label)}
    </button>
  );
}

/** A drop-down whose choice is the page's, not a setting (the Statline tab's Item and Colour). */
function PickList({
  ctx,
  name,
  options
}: {
  ctx: EditorContext;
  name: string;
  options: readonly string[];
}) {
  return (
    <select
      className="megamud-control megamud-combo"
      onChange={(event) => ctx.setLocal(name, Number(event.target.value))}
      style={ctx.style}
      value={ctx.local[name] ?? 0}
    >
      {options.map((option, i) => (
        <option key={option} value={i}>
          {option}
        </option>
      ))}
    </select>
  );
}

/** Rows to pick one of, as a list box: `name` holds the pick. */
function Rows({
  ctx,
  name,
  rows
}: {
  ctx: EditorContext;
  name: string;
  rows: readonly ReactNode[];
}) {
  const picked = ctx.local[name];
  return (
    <div className="megamud-control megamud-list megamud-rows" role="listbox" style={ctx.style}>
      {rows.map((row, i) => (
        <button
          aria-selected={picked === i}
          key={i}
          onClick={() => ctx.setLocal(name, i)}
          onMouseDown={keepFocus}
          role="option"
          type="button"
        >
          {row}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Sounds */

/** The Sounds tab's list (`0x4a17f0`), each alert on when it names a sound. */
const ALERTS = [
  { group: 'Alerts', label: 'Hangup', key: 'AlertHangup' },
  { group: 'Alerts', label: 'Idle', key: 'AlertIdle' },
  { group: 'Alerts', label: "Low HP's", key: 'AlertLowHPs' },
  { group: 'Alerts', label: 'PvP', key: 'AlertPvP' },
  { group: 'Alerts', label: 'Training', key: 'AlertTrain' },
  { group: 'Conversations', label: 'Local', key: 'AlertTalk' },
  { group: 'Conversations', label: 'Page', key: 'AlertPage' },
  { group: 'Conversations', label: 'Telepath', key: 'AlertTele' },
  { group: 'Conversations', label: 'Gossip', key: 'AlertGossip' },
  { group: 'Conversations', label: 'Auction', key: 'AlertAuction' },
  { group: 'Conversations', label: 'Gangpath', key: 'AlertGangpath' },
  { group: 'Conversations', label: 'Broadcast', key: 'AlertBroadcast' }
] as const;

/** What an alert switched on names: any sound will do, as it is said, not played. */
const ALERT_ON = 'on';

function AlertList({ ctx }: { ctx: EditorContext }) {
  return (
    <div className="megamud-control megamud-list" style={ctx.style}>
      {ALERTS.map((alert, i) => {
        const on = textOf(ctx.draft, 'Alerts', alert.key).trim() !== '';
        return (
          <div key={alert.key}>
            {(i === 0 || ALERTS[i - 1]!.group !== alert.group) && (
              <span className="megamud-list-head">{alert.group}</span>
            )}
            <label data-choice="true">
              <input
                checked={on}
                onChange={(event) =>
                  ctx.set('Alerts', alert.key, event.target.checked ? ALERT_ON : '')
                }
                type="checkbox"
              />
              <span>{alert.label}</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ Statline */

function sampleOf(choices: MegaChoices | null): MegaChoices['statline'] {
  return (
    choices?.statline ?? {
      hp: 0,
      maxHp: 0,
      mana: 0,
      maxMana: 0,
      wealth: 0,
      exp: 0,
      need: 0,
      kai: false
    }
  );
}

/* ------------------------------------------------------------ Toolbar */

/** The Toolbar tab's names for the items our toolbar draws (`0x4ba7b0`). */
const TOOLBAR_NAMES: Readonly<Record<string, string>> = {
  NoHangup: 'Disable Hangup',
  AllOff: 'All-Off',
  AutoCombat: 'Auto-Combat',
  AutoPreAttack: 'Auto-PreAttack',
  AutoMelee: 'Prefer Spell/Melee',
  AutoNuke: 'Auto-Nuke (Area effect)',
  AutoHeal: 'Auto-Heal',
  AutoBless: 'Auto-Bless',
  AutoLight: 'Auto-Light',
  AutoGet: 'Auto-Get Items',
  AutoCash: 'Auto-Get Cash',
  AutoSneak: 'Auto-Sneak',
  AutoHide: 'Auto-Hide',
  AutoSearch: 'Auto-Search',
  AFK: 'Toggle AFK'
};

function ToolbarItems({ ctx }: { ctx: EditorContext }) {
  return (
    <Rows
      ctx={ctx}
      name="toolbarItem"
      rows={MEGA_TOGGLES.map((toggle) => {
        const n = Number(value(ctx.draft, 'Toolbar', toggle.toolbar) ?? 0);
        return (
          <span data-off={n > 0 ? undefined : 'true'}>
            {n > 1 ? '| ' : ''}
            {TOOLBAR_NAMES[toggle.toolbar] ?? toggle.toolbar}
          </span>
        );
      })}
    />
  );
}

/**
 * Visible and Separator for the item picked (`0x4bb2e0`): not visible is 0;
 * visible is 1, and 2 more with a separator before it.
 */
function ToolbarFlag({
  ctx,
  label,
  separator
}: {
  ctx: EditorContext;
  label: string;
  separator: boolean;
}) {
  const toggle = MEGA_TOGGLES[picked(ctx, 'toolbarItem') ?? -1];
  const n = toggle ? Number(value(ctx.draft, 'Toolbar', toggle.toolbar) ?? 0) : 0;
  const visible = n > 0;
  const on = separator ? (n & 2) !== 0 : visible;
  return (
    <label className="megamud-control megamud-check" style={ctx.style}>
      <input
        checked={on}
        disabled={toggle === undefined || (separator && !visible)}
        onChange={(event) => {
          if (!toggle) return;
          const checked = event.target.checked;
          const next = separator ? (checked ? 2 : 0) | 1 : checked ? 1 : 0;
          ctx.set('Toolbar', toggle.toolbar, next);
        }}
        type="checkbox"
      />
      <span>{plain(label)}</span>
    </label>
  );
}

/* ------------------------------------------------------------ Events */

const EVENT_WORDS: Readonly<Record<EventType, string>> = {
  1: 'Logon',
  2: 'Logoff',
  3: 'Re-log',
  4: 'Go to',
  6: 'Loop',
  5: 'Command'
};

const UNIT_WORDS: Readonly<Record<EveryUnit, string>> = {
  [-3]: 'hours',
  [-1]: 'minutes',
  [-2]: 'seconds'
};

function two(n: number): string {
  return String(n).padStart(2, '0');
}

function eventLine(e: ScheduledEvent): string {
  const when =
    'every' in e.at
      ? `Every ${e.at.every} ${UNIT_WORDS[e.at.unit]}`
      : `${two(e.at.hour)}:${two(e.at.minute)}`;
  const what = e.text === '' ? EVENT_WORDS[e.type] : `${EVENT_WORDS[e.type]} ${e.text}`;
  return `${e.disabled ? '(off) ' : ''}${when} — ${what}`;
}

function EventList({ ctx }: { ctx: EditorContext }) {
  return <Rows ctx={ctx} name="event" rows={eventsOf(ctx.draft).map(eventLine)} />;
}

function editEvent(ctx: EditorContext, at: number | null): void {
  const events = eventsOf(ctx.draft);
  const start: ScheduledEvent =
    at === null ? { type: 5, disabled: false, at: { hour: 12, minute: 0 }, text: '' } : events[at]!;
  ctx.open(
    <EventDialog
      choices={ctx.choices}
      close={() => ctx.open(null)}
      loops={ctx.loops}
      save={(e) => {
        ctx.update((s) => {
          const list = eventsOf(s);
          if (at === null) list.push(e);
          else list[at] = e;
          return withEvents(s, list);
        });
        ctx.open(null);
      }}
      start={start}
    />
  );
}

/** MegaMUD's Scheduled Event dialog (`0x435f80`). */
function EventDialog({
  start,
  choices,
  loops,
  save,
  close
}: {
  start: ScheduledEvent;
  choices: MegaChoices | null;
  loops: readonly string[];
  save(e: ScheduledEvent): void;
  close(): void;
}) {
  const [e, setE] = useState(start);
  const every = 'every' in e.at;
  return (
    <div className="megamud-dialog" role="dialog" aria-label="Scheduled Event">
      <fieldset>
        <legend>Event</legend>
        {EVENT_TYPES.map((type) => (
          <label key={type}>
            <input checked={e.type === type} onChange={() => setE({ ...e, type })} type="radio" />
            <span>{EVENT_WORDS[type]}</span>
          </label>
        ))}
        {(e.type === 4 || e.type === 5 || e.type === 6) && (
          <input
            className="megamud-edit"
            list={
              e.type === 4
                ? 'megamud-event-rooms'
                : e.type === 6
                  ? 'megamud-event-loops'
                  : undefined
            }
            maxLength={80}
            onChange={(event) => setE({ ...e, text: event.target.value })}
            value={e.text}
          />
        )}
        <datalist id="megamud-event-rooms">
          {(choices?.rooms ?? []).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <datalist id="megamud-event-loops">
          {loops.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <label>
          <input
            checked={e.disabled}
            onChange={(event) => setE({ ...e, disabled: event.target.checked })}
            type="checkbox"
          />
          <span>Event disabled</span>
        </label>
      </fieldset>
      <fieldset>
        <legend>When</legend>
        <label>
          <input
            checked={!every}
            onChange={() => setE({ ...e, at: { hour: 12, minute: 0 } })}
            type="radio"
          />
          <span>At time</span>
        </label>
        {!every && (
          <input
            className="megamud-edit"
            onChange={(event) => {
              const [h, m] = event.target.value.split(':').map(Number);
              setE({ ...e, at: { hour: h ?? 0, minute: m ?? 0 } });
            }}
            type="time"
            value={'hour' in e.at ? `${two(e.at.hour)}:${two(e.at.minute)}` : ''}
          />
        )}
        <label>
          <input
            checked={every}
            onChange={() => setE({ ...e, at: { every: 1, unit: -1 } })}
            type="radio"
          />
          <span>Every</span>
        </label>
        {'every' in e.at && (
          <span className="megamud-dialog-row">
            <input
              className="megamud-edit"
              inputMode="numeric"
              onChange={(event) =>
                'every' in e.at &&
                setE({
                  ...e,
                  at: { ...e.at, every: Math.max(1, Number.parseInt(event.target.value, 10) || 1) }
                })
              }
              value={e.at.every}
            />
            <select
              className="megamud-combo"
              onChange={(event) =>
                'every' in e.at &&
                setE({ ...e, at: { ...e.at, unit: Number(event.target.value) as EveryUnit } })
              }
              value={e.at.unit}
            >
              {EVERY_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {UNIT_WORDS[unit]}
                </option>
              ))}
            </select>
          </span>
        )}
      </fieldset>
      <DialogButtons close={close} ok={() => save(e)} />
    </div>
  );
}

function DialogButtons({ ok, close }: { ok(): void; close(): void }) {
  return (
    <div className="megamud-dialog-actions">
      <button onClick={ok} onMouseDown={keepFocus} type="button">
        Ok
      </button>
      <button className="quiet" onClick={close} onMouseDown={keepFocus} type="button">
        Cancel
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ Ability monitors */

function abilityLabel(id: number): string {
  const name = ABILITY[id]?.name;
  return name === undefined ? String(id) : `${name}(${id})`;
}

function monitorLine(m: AbilityMonitorRow): string {
  const action = m.useCommand !== 0 ? m.command : `cast ${m.spell}`;
  return `${m.disabled ? '(off) ' : ''}${m.chained ? '+ ' : ''}${abilityLabel(m.ability)} ${MONITOR_COMPARES[m.compare]} ${m.value} — ${action}`;
}

function MonitorList({ ctx }: { ctx: EditorContext }) {
  return <Rows ctx={ctx} name="monitor" rows={monitorsOf(ctx.draft).map(monitorLine)} />;
}

function MoveMonitor({ ctx, by, label }: { ctx: EditorContext; by: number; label: string }) {
  const at = picked(ctx, 'monitor');
  const count = monitorsOf(ctx.draft).length;
  const to = at === undefined ? -1 : at + by;
  return (
    <Press
      ctx={ctx}
      disabled={at === undefined || to < 0 || to >= count}
      label={label}
      run={() => {
        if (at === undefined) return;
        ctx.update((s) => {
          const list = monitorsOf(s);
          const [row] = list.splice(at, 1);
          list.splice(to, 0, row!);
          return withMonitors(s, list);
        });
        ctx.setLocal('monitor', to);
      }}
    />
  );
}

function editMonitor(ctx: EditorContext, at: number | null): void {
  const start = at === null ? newMonitorRow() : monitorsOf(ctx.draft)[at]!;
  ctx.open(
    <MonitorDialog
      close={() => ctx.open(null)}
      save={(m) => {
        ctx.update((s) => {
          const list = monitorsOf(s);
          if (at === null) list.push(m);
          else list[at] = m;
          return withMonitors(s, list);
        });
        ctx.open(null);
      }}
      start={start}
    />
  );
}

const ABILITY_IDS = Object.keys(ABILITY)
  .map(Number)
  .sort((a, b) => a - b);

/** MegaMUD's Ability Monitor dialog (template 406). */
function MonitorDialog({
  start,
  save,
  close
}: {
  start: AbilityMonitorRow;
  save(m: AbilityMonitorRow): void;
  close(): void;
}) {
  const [m, setM] = useState(start);
  const bit = (b: number, on: boolean): number => (on ? m.when | b : m.when & ~b);
  const whenBox = (b: number, label: string, disabled = false) => (
    <label key={b}>
      <input
        checked={(m.when & b) !== 0}
        disabled={disabled}
        onChange={(event) => setM({ ...m, when: bit(b, event.target.checked) })}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="megamud-dialog" role="dialog" aria-label="Ability Monitor">
      <fieldset>
        <legend>Condition</legend>
        <span className="megamud-dialog-row">
          <span>Ability</span>
          <select
            className="megamud-combo"
            onChange={(event) => setM({ ...m, ability: Number(event.target.value) })}
            value={m.ability}
          >
            {(ABILITY_IDS.includes(m.ability) ? ABILITY_IDS : [m.ability, ...ABILITY_IDS]).map(
              (id) => (
                <option key={id} value={id}>
                  {abilityLabel(id)}
                </option>
              )
            )}
          </select>
        </span>
        <span className="megamud-dialog-row">
          <span>Source</span>
          <select
            className="megamud-combo"
            onChange={(event) => setM({ ...m, part: Number(event.target.value) })}
            value={m.part}
          >
            {MONITOR_PARTS.map((part, i) => (
              <option key={part} value={i}>
                {part}
              </option>
            ))}
          </select>
          <select
            className="megamud-combo"
            onChange={(event) => setM({ ...m, compare: Number(event.target.value) })}
            value={m.compare}
          >
            {MONITOR_COMPARES.map((compare, i) => (
              <option key={compare} value={i}>
                {compare}
              </option>
            ))}
          </select>
          <input
            className="megamud-edit"
            inputMode="numeric"
            onChange={(event) =>
              setM({ ...m, value: Number.parseInt(event.target.value, 10) || 0 })
            }
            value={m.value}
          />
        </span>
      </fieldset>
      <fieldset>
        <legend>Action (When condition is TRUE)</legend>
        <span className="megamud-dialog-row">
          <label>
            <input
              checked={m.useCommand === 0}
              onChange={() => setM({ ...m, useCommand: 0 })}
              type="radio"
            />
            <span>Cast spell</span>
          </label>
          <input
            className="megamud-edit"
            disabled={m.useCommand !== 0}
            maxLength={6}
            onChange={(event) => setM({ ...m, spell: event.target.value })}
            value={m.spell}
          />
        </span>
        <span className="megamud-dialog-row">
          <label>
            <input
              checked={m.useCommand !== 0}
              onChange={() => setM({ ...m, useCommand: 1 })}
              type="radio"
            />
            <span>Command</span>
          </label>
          <input
            className="megamud-edit"
            disabled={m.useCommand === 0}
            maxLength={80}
            onChange={(event) => setM({ ...m, command: event.target.value })}
            value={m.command}
          />
        </span>
        <label>
          <input
            checked={m.chainOn}
            onChange={(event) => setM({ ...m, chainOn: event.target.checked })}
            type="checkbox"
          />
          <span>Re-check value after action</span>
        </label>
      </fieldset>
      <fieldset>
        <legend>Triggers / Check When...</legend>
        <span className="megamud-dialog-row">
          {whenBox(MONITOR_EVERY, 'Every')}
          <input
            className="megamud-edit"
            inputMode="numeric"
            onChange={(event) =>
              setM({ ...m, interval: Math.max(5, Number.parseInt(event.target.value, 10) || 5) })
            }
            value={m.interval}
          />
          <span>seconds</span>
        </span>
        {MONITOR_WHEN.map((w) => whenBox(w.bit, w.label, w.bit === 0x80 && m.useCommand !== 0))}
        <span className="megamud-dialog-row">
          {whenBox(MONITOR_MESSAGE, 'Game message:')}
          <input
            className="megamud-edit"
            maxLength={80}
            onChange={(event) => setM({ ...m, message: event.target.value })}
            value={m.message}
          />
        </span>
        <label>
          <input
            checked={m.chained}
            onChange={(event) => setM({ ...m, chained: event.target.checked })}
            type="checkbox"
          />
          <span>After the monitor above resolves (chained)</span>
        </label>
      </fieldset>
      <label>
        <input
          checked={m.disabled}
          onChange={(event) => setM({ ...m, disabled: event.target.checked })}
          type="checkbox"
        />
        <span>Monitor disabled</span>
      </label>
      <label>
        <input
          checked={m.urgent}
          onChange={(event) => setM({ ...m, urgent: event.target.checked })}
          type="checkbox"
        />
        <span>Prevent movement until resolved</span>
      </label>
      <p className="settings-note">
        Note: only ManaRegen(145) reports per-source values; others test the total.
      </p>
      <DialogButtons close={close} ok={() => save(m)} />
    </div>
  );
}

/* ------------------------------------------------------------ profiles, resets, pickers */

/** Copy From... (`0x49fd10`): the other enabled copies of the tab, to copy into this one. */
function CopyFrom({ ctx, section }: { ctx: EditorContext; section: ProfiledSection }) {
  const active = Number(value(ctx.draft, 'Profiles', 'ActiveProfile') ?? 1);
  const slots = ctx.draft.profiles[section];
  return (
    <select
      aria-label="Copy From..."
      className="megamud-control megamud-combo"
      onChange={(event) => {
        const from = Number(event.target.value);
        if (from > 0) ctx.update((s) => copyProfileFrom(s, section, from));
      }}
      style={ctx.style}
      value={0}
    >
      <option value={0}>Copy From...</option>
      {[1, 2, 3, 4]
        .filter((n) => n !== active)
        .map((n) => (
          <option disabled={!slots[n - 1]?.enabled} key={n} value={n}>
            Profile {n}
          </option>
        ))}
    </select>
  );
}

/** The Spells tab's Reset (`0x4441a0`, `0x141d`): the ten blessings off, empty, untimed. */
function blessingsReset(settings: MegaSettings): MegaSettings {
  const next = structuredClone(settings);
  const spells = next.live['Spells']!;
  for (let n = 1; n <= 10; n += 1) {
    spells[`BlessPri${n}`] = 0;
    spells[`BlessCmd${n}`] = '';
    spells[`BlessTim${n}`] = 0;
  }
  return next;
}

/**
 * The Combat tab's reset (`0x424540`, `0x13f5`): every Spell Combat field to
 * the value MegaMUD puts there, its spells emptied. MegaMUD asks first; the
 * page's Undo stands for that here.
 */
const SPELL_COMBAT_RESET: Readonly<Record<string, SettingValue>> = {
  PreMultAttack: '',
  MultAttack: '',
  PreAttack: '',
  AttackSpl2: '',
  AttackSpl: '',
  PreMultMstrCnt: 3,
  MultMstrCnt: 3,
  PreMinExp: 0,
  AttMinExp2: 0,
  PreMultMaxDmg: 99999,
  MultMaxDmg: 99999,
  PreMaxDmg: 99999,
  AttMaxDmg2: 99999,
  AttMaxDmg: 99999,
  PreMultCastCnt: 2,
  MultCastCnt: 10,
  PreCastCnt: 2,
  MaxCastCnt2: 10,
  MaxCastCnt: 999,
  'ManaPreMultAtt%': 25,
  'ManaMultAtt%': 25,
  'ManaPreAtt%': 25,
  'ManaAttack2%': 0,
  'ManaAttack%': 0
};

function spellCombatReset(settings: MegaSettings): MegaSettings {
  const next = structuredClone(settings);
  Object.assign(next.live['Combat']!, SPELL_COMBAT_RESET);
  return next;
}

/**
 * A weapon or shield picker beside its box (`0x42afc0`): what is carried of
 * the kind, from the running engine; one alone is put straight in.
 */
function Carried({
  ctx,
  pick,
  setting
}: {
  ctx: EditorContext;
  pick: 'weapons' | 'backstab' | 'shields';
  setting: string;
}) {
  const found = ctx.choices?.[pick] ?? null;
  const none =
    pick === 'shields'
      ? 'No matching shields in inventory.'
      : pick === 'backstab'
        ? 'No backstab-capable weapons in inventory.'
        : 'No weapons in inventory.';
  const title =
    found === null ? 'Inventory not currently known.' : found.length === 0 ? none : undefined;
  if (found !== null && found.length === 1) {
    return (
      <button
        className="megamud-control megamud-button"
        onClick={() => ctx.set('Combat', setting, found[0]!)}
        onMouseDown={keepFocus}
        style={ctx.style}
        title={found[0]}
        type="button"
      />
    );
  }
  return (
    <select
      aria-label={setting}
      className="megamud-control megamud-combo megamud-picker"
      disabled={found === null || found.length === 0}
      onChange={(event) =>
        event.target.value !== '' && ctx.set('Combat', setting, event.target.value)
      }
      style={ctx.style}
      title={title}
      value=""
    >
      <option value="" />
      {(found ?? []).map((name, i) => (
        <option key={`${name}-${i}`} value={name}>
          {`${i + 1}  ${name}`}
        </option>
      ))}
    </select>
  );
}
