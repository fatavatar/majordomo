/**
 * A character's MegaMUD settings, as MegaMUD's own settings dialog lays them
 * out: its sixteen tabs, each control where the dialog template puts it and
 * showing the setting MegaMUD's tab shows (`settingsTabs.ts`, read from
 * `megamud.exe` and `MegaRes.dll`). A change is written, as it is made, to
 * the character's `megamud:`, which is what runs it on the ported MegaMUD engine.
 *
 * The page is drawn in dialog units, scaled: a MegaMUD player finds every
 * box where it always was. A control the tab fills from somewhere else (the
 * paths, the sound files, the toolbar, the events list) is drawn but not
 * editable yet.
 *
 * Drawn as rows of the Character page (`SettingsScreen`), each tab with what
 * this client keeps for the character under it (2026-10-14).
 */
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { customControl, drawnHere } from './MegaMudEditors';
import { CheckField, NumberField, TextField } from './FormField';
import Icon from './Icon';
import NameCombo from './NameCombo';
import type { MegaChoices } from '@shared/ipc';
import {
  SETTINGS_TABS,
  type ChecklistRow,
  type ControlBind,
  type TabControl
} from '@shared/megamud/settingsTabs';
import { tabAsDrawn } from '@shared/megamud/layout';
import {
  parseIni,
  sections,
  setSetting,
  settingsFromIni,
  setProfileEnabled,
  switchProfile,
  type MegaSettings,
  type ProfiledSection,
  type SettingValue
} from '@shared/megamud/settings';
import { keepFocus } from '../lib/focus';
import { NO_NAMES, type Offer, type SettingsNames } from '../lib/settingsNames';
import { t } from '../lib/i18n';

/**
 * One character's MegaMUD settings as its tabs edit them: a part of the
 * character's own draft (2026-10-18), saved and undone with the rest of it,
 * where they were loaded, saved and undone beside it.
 */
export interface MegaMudDraft {
  /** Whose they are, so a tab starts afresh for another character. */
  id: string;
  draft: MegaSettings;
  /** Whether `BBS.Password` is set on file; the draft's is always empty. */
  hasPassword: boolean;
  /** What its running engine offers to choose from, or null with none running. */
  choices: MegaChoices | null;
  /** What its boxes suggest as they are typed in. */
  names: SettingsNames;
  set(section: string, key: string, value: SettingValue): void;
  update(change: (current: MegaSettings) => MegaSettings): void;
}

/** Dialog units to pixels: MS Sans Serif 8's base units (6×13), scaled up. */
const SCALE = 1.25;
const DLU_X = 1.5 * SCALE;
const DLU_Y = 1.625 * SCALE;

/** A Windows label's `&` mnemonics, as the text a person reads. */
function plain(text: string): string {
  return text
    .replace(/&&/g, '\u0000')
    .replace(/&/g, '')
    .replace(/\u0000/g, '&');
}

function valueOf(settings: MegaSettings, section: string, key: string): SettingValue | undefined {
  return settings.live[section]?.[key];
}

function withValue(
  settings: MegaSettings,
  section: string,
  key: string,
  value: SettingValue
): MegaSettings {
  const next = structuredClone(settings);
  setSetting(next, section, key, value);
  return next;
}

/** A character's MegaMUD settings for its tabs, changed by `update` on the character's draft. */
export function megaMudDraft(
  id: string,
  draft: MegaSettings,
  hasPassword: boolean,
  choices: MegaChoices | null,
  update: (change: (current: MegaSettings) => MegaSettings) => void,
  names: SettingsNames = NO_NAMES
): MegaMudDraft {
  return {
    id,
    draft,
    hasPassword,
    choices,
    names,
    set: (section, key, value) => update((current) => withValue(current, section, key, value)),
    update
  };
}

/**
 * The tabs not drawn as rows: BBS, whose BBS list and account are the
 * realm's page and the Character row's login, and whose own settings (MudOp
 * access, `sys goto`, the redials) the Character row holds (`MEGA_ACCOUNT`);
 * and Toolbar, whose items the toolbar's own `...` pins, as every other
 * button on it is (2026-10-14).
 */
const NOT_ROWS: readonly string[] = ['BBS', 'Toolbar'];

/**
 * The rows whose MegaMUD page is not drawn, only ours under it: Auto-roam,
 * whose directions, doors and special rooms are not wanted (2026-10-14); the
 * engine keeps MegaMUD's defaults for them.
 */
const NO_PAGE: readonly string[] = ['Auto-roam'];

/** The titles of MegaMUD's settings tabs, in its dialog's order: the Character page's rows. */
export const MEGA_TABS: readonly string[] = SETTINGS_TABS.map((p) => p.title).filter(
  (title) => !NOT_ROWS.includes(title)
);

/** Whether a Character page row is one of MegaMUD's tabs. */
export function isMegaTab(section: string): boolean {
  return MEGA_TABS.includes(section);
}

/**
 * One of MegaMUD's tabs for the chosen character, as its dialog lays it out,
 * a part of the Character page's draft: saved as it is changed and undone by
 * its Undo, as every other field there is.
 */
export function MegaMudPanel({ tab, mega }: { tab: string; mega: MegaMudDraft }) {
  const found = SETTINGS_TABS.find((p) => p.title === tab);
  if (found === undefined || NO_PAGE.includes(tab)) return null;
  const page = tabAsDrawn(found);
  const { draft } = mega;
  return (
    <div className="megamud-settings">
      <TabPage
        choices={mega.choices}
        controls={page.controls}
        draft={draft}
        key={`${mega.id}-${tab}`}
        names={mega.names}
        tab={tab}
        update={mega.update}
        hasPassword={mega.hasPassword}
        height={page.h}
        onProfile={(n) => mega.update((current) => switchProfile(current, n))}
        onProfileEnabled={(n, on) =>
          mega.update((current) =>
            page.profiled ? setProfileEnabled(current, page.profiled, n, on) : current
          )
        }
        profiled={page.profiled}
        set={mega.set}
        width={page.w}
      />
    </div>
  );
}

/**
 * The BBS tab's settings that are the character's and not the realm's or the
 * login's (`0x419e80`): MudOp access and its `sys goto`, and the redials,
 * which stand in for our own reconnecting under the engine. In MegaMUD's
 * words, on the Character row (2026-10-14).
 */
interface AccountField {
  section: string;
  key: string;
  label: string;
  as: 'check' | 'int' | 'text';
}

/** In three rows: the account, the switches, and the timings. */
const MEGA_ACCOUNT: readonly (readonly AccountField[])[] = [
  [
    { section: 'BBS', key: 'IsMudop', label: 'Has MudOp access', as: 'check' },
    { section: 'BBS', key: 'SysGoto', label: 'sys goto', as: 'text' }
  ],
  [
    { section: 'Comms', key: 'RedialConnect', label: 'Reconnect if dial fails', as: 'check' },
    { section: 'Comms', key: 'RedialCarrier', label: 'Reconnect if carrier lost', as: 'check' },
    {
      section: 'Comms',
      key: 'RedialNoResponse',
      label: 'Reconnect if no BBS response',
      as: 'check'
    },
    { section: 'Comms', key: 'RedialCleanup', label: 'Reconnect after cleanup', as: 'check' },
    { section: 'Comms', key: 'LogoffLowExp', label: 'Disconnect if low exp. rate', as: 'check' }
  ],
  [
    { section: 'Comms', key: 'RedialMax', label: 'Max. re-dials', as: 'int' },
    { section: 'Comms', key: 'RedialPause', label: 'Re-dial pause (s)', as: 'int' },
    { section: 'Comms', key: 'CleanupPeriod', label: 'Cleanup period (min)', as: 'int' },
    { section: 'Comms', key: 'MinExpRate', label: 'Min. exp. rate (/hour)', as: 'int' },
    { section: 'Comms', key: 'LagWait', label: 'Lag pause (s)', as: 'int' }
  ]
];

/** `MEGA_ACCOUNT`, for a character the engine runs. */
export function MegaMudAccount({ mega }: { mega: MegaMudDraft }) {
  const { draft } = mega;
  const field = ({ section, key, label, as }: AccountField) => {
    const value = valueOf(draft, section, key);
    const name = `megamud-${section}-${key}`;
    if (as === 'check') {
      return (
        <CheckField
          checked={typeof value === 'number' && value !== 0}
          key={name}
          label={label}
          name={name}
          onChange={(on) => mega.set(section, key, on ? 1 : 0)}
        />
      );
    }
    if (as === 'int') {
      return (
        <NumberField
          key={name}
          label={label}
          name={name}
          onChange={(text) => mega.set(section, key, Number.parseInt(text, 10) || 0)}
          value={String(value ?? 0)}
        />
      );
    }
    return (
      <TextField
        key={name}
        label={label}
        name={name}
        onChange={(text) => mega.set(section, key, text)}
        spellCheck={false}
        value={String(value ?? '')}
      />
    );
  };
  return (
    <fieldset className="settings-menus megamud-account" data-fieldset="megamud-account">
      <legend>{t('settings.megamud.accountLegend')}</legend>
      {MEGA_ACCOUNT.map((row, i) => (
        <div className="megamud-account-row" data-row={i} key={i}>
          {row.map(field)}
        </div>
      ))}
    </fieldset>
  );
}

/**
 * A character's MegaMUD settings file (`<name>.ini`) read in, for a new
 * character or over an existing one's (2026-10-14): what the startup
 * migration does for a `megamud.ini` left in a character's folder, from the
 * page. Read as MegaMUD's loader reads it (`settingsFromIni`), in the Windows
 * code page MegaMUD writes; a file with none of MegaMUD's sections is refused.
 */
export function MegaMudIniImport({
  label,
  onRead
}: {
  label: string;
  onRead(settings: MegaSettings, fileName: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const picked = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setProblem(null);
    try {
      const text = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
      const known = new Set(sections());
      if (!parseIni(text).some((section) => known.has(section.name))) {
        setProblem(t('settings.megamud.importNotMegamud', { fileName: file.name }));
        return;
      }
      onRead(settingsFromIni(text), file.name);
    } catch (reason: unknown) {
      console.error('MegaMUD settings import failed', reason);
      setProblem(t('settings.megamud.importUnreadable', { fileName: file.name }));
    }
  };
  return (
    <div className="megamud-ini-import">
      <input
        accept=".ini"
        hidden
        onChange={(event) => {
          // Cleared first, so the same file can be picked again.
          const file = event.target.files?.[0];
          event.target.value = '';
          void picked(file);
        }}
        ref={input}
        tabIndex={-1}
        type="file"
      />
      <button className="quiet" onClick={() => input.current?.click()} type="button">
        <Icon name="plus" />
        <span>{label}</span>
      </button>
      {problem !== null && (
        <p className="messages-status bad" role="status">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Who a MegaMUD settings file is for: its character's name and login. */
export function characterOfIni(settings: MegaSettings): {
  id: string;
  name: string;
  username: string;
  password: string;
  bbs: string;
} {
  const said = (section: string, key: string): string =>
    String(settings.live[section]?.[key] ?? '').trim();
  const name = said('Player', 'Name');
  const known = name !== '' && name !== '*Not Known*';
  const username = said('BBS', 'UserID');
  return {
    id: (known ? name : username).toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    name: known ? name : '',
    username,
    password: said('BBS', 'Password'),
    bbs: said('BBS', 'BbsName')
  };
}

interface TabPageProps {
  tab: string;
  choices: MegaChoices | null;
  names: SettingsNames;
  update(change: (current: MegaSettings) => MegaSettings): void;
  controls: readonly TabControl[];
  draft: MegaSettings;
  hasPassword: boolean;
  width: number;
  height: number;
  profiled?: ProfiledSection;
  set(section: string, key: string, value: SettingValue): void;
  onProfile(n: number): void;
  onProfileEnabled(n: number, on: boolean): void;
}

/** The most blank a page keeps between rows, and at its top and foot, in dialog units. */
const BLANK_KEPT = 8;

/**
 * Where what is drawn of a page goes once the rows left blank are closed up:
 * a control not drawn here (`drawnHere`) leaves the band it stood in, and a
 * band no drawn control reaches is shrunk to `BLANK_KEPT`, the page's foot
 * with it (2026-10-14). A frame counts only its title, as its box is not
 * drawn; its edges move with what is around them.
 */
function closedUp(shown: readonly TabControl[]): { y(at: number): number; height: number } {
  const bands = shown
    .map((c): [number, number] =>
      c.kind === 'group' ? [c.y, c.y + 10] : [c.y, c.y + (c.kind === 'combo' ? 12 : c.h)]
    )
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [top, bottom] of bands) {
    const last = merged.at(-1);
    if (last && top <= last[1]) last[1] = Math.max(last[1], bottom);
    else merged.push([top, bottom]);
  }
  // Each blank, from the page's top down, and how much of it goes.
  const cuts: [number, number][] = [];
  let edge = 0;
  for (const [top, bottom] of merged) {
    const blank = top - edge;
    if (blank > BLANK_KEPT) cuts.push([top, blank - BLANK_KEPT]);
    edge = bottom;
  }
  const y = (at: number): number =>
    at - cuts.reduce((gone, [from, by]) => (at >= from ? gone + by : gone), 0);
  return { y, height: y(edge) + BLANK_KEPT };
}

function TabPage({
  tab,
  choices,
  names,
  update,
  controls,
  draft,
  hasPassword,
  width,
  height,
  profiled,
  set,
  onProfile,
  onProfileEnabled
}: TabPageProps) {
  const active = Number(valueOf(draft, 'Profiles', 'ActiveProfile') ?? 1);
  // The page's own picks (a list's selected row), and a dialog over it.
  const [local, setLocal] = useState<Record<string, number>>({});
  const [dialog, setDialog] = useState<ReactNode>(null);
  const shown = controls.filter((c) => !c.hidden && drawnHere(tab, c));
  const rows = closedUp(shown);
  return (
    <div
      className="megamud-page"
      style={{ width: width * DLU_X, height: Math.min(height, rows.height) * DLU_Y }}
    >
      {shown.map((c) => {
        const top = rows.y(c.y);
        const style = {
          left: c.x * DLU_X,
          top: top * DLU_Y,
          width: c.w * DLU_X,
          height: c.kind === 'combo' ? 12 * DLU_Y : (rows.y(c.y + c.h) - top) * DLU_Y
        };
        const key = `${c.id}-${c.x}-${c.y}`;
        const custom = customControl(tab, c, {
          draft,
          choices,
          names,
          style,
          set,
          update,
          local,
          setLocal: (name, at) => setLocal((was) => ({ ...was, [name]: at })),
          open: setDialog
        });
        if (custom !== undefined) return <Fragment key={key}>{custom}</Fragment>;
        if (c.kind === 'other') return null;
        if (c.profile !== undefined && profiled) {
          return (
            <button
              className="megamud-control megamud-button"
              data-active={c.profile === active ? 'true' : 'false'}
              key={key}
              onClick={() => onProfile(c.profile!)}
              onMouseDown={keepFocus}
              style={style}
              type="button"
            >
              {plain(c.text)}
            </button>
          );
        }
        if (c.profileEnabled !== undefined && profiled) {
          const slot = draft.profiles[profiled][c.profileEnabled - 1];
          return (
            <label className="megamud-control megamud-check" key={key} style={style}>
              <input
                checked={slot?.enabled === true}
                onChange={(event) => onProfileEnabled(c.profileEnabled!, event.target.checked)}
                type="checkbox"
              />
              <span>{plain(c.text)}</span>
            </label>
          );
        }
        return (
          <Control
            control={c}
            draft={draft}
            hasPassword={hasPassword}
            key={key}
            names={names}
            set={set}
            style={style}
          />
        );
      })}
      {dialog}
    </div>
  );
}

interface ControlProps {
  control: TabControl;
  draft: MegaSettings;
  hasPassword: boolean;
  names: SettingsNames;
  style: React.CSSProperties;
  set(section: string, key: string, value: SettingValue): void;
}

/**
 * Settings MegaMUD 2.1 draws, loads and saves but never acts on: nothing in
 * `megamud.exe` reads their slots past its dialog, loader and saver
 * (`mm.py field 0x8554`, `0x90b4`, `0x30df8`; `IgnoreSpellMsgChecks` has no
 * slot at all), read 2026-10-16. Drawn, as the dialog draws them, and said to
 * do nothing.
 */
const INERT: ReadonlySet<string> = new Set([
  'Cash.AutoCollectLootbox',
  'PvP.RedialPvp',
  'PvP.PvpSafePeriod',
  'Other.IgnoreSpellMsgChecks'
]);

/**
 * The boxes that name a weapon, a shield, a room, a bank or a loop, by the
 * list each suggests from (ours, 2026-10-24); `SPELL_BOX` names a spell.
 */
const NAMED_BOX: Readonly<Record<string, Exclude<keyof SettingsNames, 'spells' | 'items'>>> = {
  'Combat.BsWeapon': 'backstab',
  'Combat.NrmWeapon': 'weapons',
  'Combat.AltWeapon': 'weapons',
  'Combat.Shield': 'shields',
  'PvP.PvpFleeRoom': 'rooms',
  'Cash.Bank': 'banks',
  'MegaMud.DefaultLoop': 'loops'
};

/** The boxes MegaMUD casts from: what each holds is the short command typed to cast it. */
const SPELL_BOX =
  /^(Spells\.\w+Cmd\d*|Combat\.(PreMultAttack|MultAttack|PreAttack|AttackSpl2?)|PvP\.PvpSpell\d|Party\.Party(Heal\d|HealArea|Bless\d))$/;

/** What a free-text box suggests, or undefined for one that takes anything (a command, say). */
function offerFor(b: ControlBind | undefined, names: SettingsNames): Offer | undefined {
  if (b === undefined || b.as === 'int' || b.as === 'index') return undefined;
  const at = `${b.section}.${b.key}`;
  if (SPELL_BOX.test(at)) return names.spells;
  const list = NAMED_BOX[at];
  return list === undefined ? undefined : names[list];
}

/** A free-text box that suggests what it names as it is typed in. */
function NamedBox({
  b,
  offer,
  set,
  style,
  value
}: {
  b: ControlBind;
  offer: Offer;
  set(section: string, key: string, value: SettingValue): void;
  style: React.CSSProperties;
  value: SettingValue | undefined;
}) {
  return (
    <NameCombo
      {...offer}
      ariaLabel={`${b.section}.${b.key}`}
      boxClassName="megamud-control"
      className="megamud-edit"
      name={`megamud-${b.section}-${b.key}`}
      onChange={(text) => set(b.section, b.key, text)}
      style={style}
      value={value === undefined ? '' : String(value)}
    />
  );
}

function Control({ control: c, draft, hasPassword, names, style, set }: ControlProps) {
  const b: ControlBind | undefined = c.bind;
  const inert = b !== undefined && INERT.has(`${b.section}.${b.key}`);
  const said = inert ? t('settings.megamud.inertTitle') : undefined;
  const value = b ? valueOf(draft, b.section, b.key) : undefined;
  const offer = offerFor(b, names);
  const label = plain(c.text);
  switch (c.kind) {
    case 'group':
      return (
        <fieldset className="megamud-control megamud-group" style={style}>
          {label !== '' && <legend>{label}</legend>}
        </fieldset>
      );
    case 'label':
      return (
        <span className="megamud-control megamud-label" style={style}>
          {label}
        </span>
      );
    case 'check':
    case 'radio': {
      const n = typeof value === 'number' ? value : 0;
      const on =
        b === undefined
          ? false
          : b.as === 'radio'
            ? n === b.value
            : b.as === 'bit'
              ? (n & (b.bit ?? 0)) !== 0
              : n !== 0;
      return (
        <label
          className="megamud-control megamud-check"
          data-inert={inert ? 'true' : undefined}
          // Two lines tall in the template: the dialog wraps its text.
          data-wraps={c.h >= 16 ? 'true' : undefined}
          style={style}
          title={said}
        >
          <input
            checked={on}
            disabled={b === undefined}
            onChange={(event) => {
              if (!b) return;
              const checked = event.target.checked;
              if (b.as === 'radio') {
                if (checked) set(b.section, b.key, b.value ?? 0);
              } else if (b.as === 'bit') {
                set(b.section, b.key, checked ? n | (b.bit ?? 0) : n & ~(b.bit ?? 0));
              } else {
                set(b.section, b.key, checked ? 1 : 0);
              }
            }}
            type={c.kind === 'radio' ? 'radio' : 'checkbox'}
          />
          <span>{label}</span>
        </label>
      );
    }
    case 'edit': {
      const password = b?.section === 'BBS' && b.key === 'Password';
      if (b && offer) return <NamedBox b={b} offer={offer} set={set} style={style} value={value} />;
      return (
        <input
          aria-label={b ? `${b.section}.${b.key}` : undefined}
          className="megamud-control megamud-edit"
          data-inert={inert ? 'true' : undefined}
          disabled={b === undefined}
          inputMode={b?.as === 'int' ? 'numeric' : undefined}
          onChange={(event) => {
            if (!b) return;
            const text = event.target.value;
            set(b.section, b.key, b.as === 'int' ? Number.parseInt(text, 10) || 0 : text);
          }}
          placeholder={password && hasPassword ? t('settings.megamud.passwordKept') : undefined}
          style={style}
          title={said}
          type={password ? 'password' : 'text'}
          value={value === undefined ? '' : String(value)}
        />
      );
    }
    case 'combo':
      if (b && b.as === 'index' && c.options) {
        return (
          <select
            className="megamud-control megamud-combo"
            onChange={(event) => set(b.section, b.key, Number(event.target.value))}
            style={style}
            value={typeof value === 'number' ? value : 0}
          >
            {c.options.map((option, i) => (
              <option key={option} value={i}>
                {option}
              </option>
            ))}
          </select>
        );
      }
      if (b && offer) return <NamedBox b={b} offer={offer} set={set} style={style} value={value} />;
      return (
        <input
          aria-label={b ? `${b.section}.${b.key}` : undefined}
          className="megamud-control megamud-edit"
          disabled={b === undefined}
          onChange={(event) => {
            if (!b) return;
            const text = event.target.value;
            set(b.section, b.key, b.as === 'int' ? Number.parseInt(text, 10) || 0 : text);
          }}
          style={style}
          value={value === undefined ? '' : String(value)}
        />
      );
    case 'list':
      return (
        <div className="megamud-control megamud-list" style={style}>
          {(c.rows ?? []).map((row: ChecklistRow, i) => {
            if (row.kind === 'header' || row.section === undefined || row.key === undefined) {
              return (
                <span className="megamud-list-head" key={i}>
                  {row.label}
                </span>
              );
            }
            const { section, key } = row;
            const n = valueOf(draft, section, key);
            const on = row.kind === 'radio' ? n === row.value : typeof n === 'number' && n !== 0;
            return (
              <label data-choice={row.kind === 'radio' ? 'true' : undefined} key={i}>
                <input
                  checked={on}
                  onChange={(event) => {
                    if (row.kind === 'radio') set(section, key, row.value ?? 0);
                    else set(section, key, event.target.checked ? 1 : 0);
                  }}
                  type={row.kind === 'radio' ? 'radio' : 'checkbox'}
                />
                <span>{row.label}</span>
              </label>
            );
          })}
        </div>
      );
    default:
      return (
        <button className="megamud-control megamud-button" disabled style={style} type="button">
          {label}
        </button>
      );
  }
}
