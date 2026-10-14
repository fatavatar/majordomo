import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { customControl, drawnHere } from './MegaMudEditors';
import FormActions from './FormActions';
import { CheckField, NumberField, TextField } from './FormField';
import { useAutoSave, type AutoSave } from '../hooks/useAutoSave';
import { begin, canRedo, canUndo, record, redo, undo, type History } from '../lib/history';
import type { MegaChoices, MegaMudSettingsView } from '@shared/ipc';
import {
  SETTINGS_TABS,
  type ChecklistRow,
  type ControlBind,
  type TabControl
} from '@shared/megamud/settingsTabs';
import {
  setSetting,
  switchProfile,
  type MegaSettings,
  type ProfiledSection,
  type SettingValue
} from '@shared/megamud/settings';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';

/**
 * A character's MegaMUD settings, as MegaMUD's own settings dialog lays them
 * out: its sixteen tabs, each control where the dialog template puts it and
 * showing the setting MegaMUD's tab shows (`settingsTabs.ts`, read from
 * `megamud.exe` and `MegaRes.dll`). A change is written, as it is made, to
 * the character's `megamud.ini`, which is what runs it on the ported MegaMUD engine.
 *
 * The page is drawn in dialog units, scaled: a MegaMUD player finds every
 * box where it always was. A control the tab fills from somewhere else (the
 * paths, the sound files, the toolbar, the events list) is drawn but not
 * editable yet.
 *
 * Drawn as rows of the Character page (`SettingsScreen`), each tab with what
 * this client keeps for the character under it (2026-10-14).
 */

/** The page's reach into the client: a character's MegaMUD settings, read and written. */
export interface MegaMudStore {
  load(id: string): Promise<MegaMudSettingsView | null>;
  save(id: string, settings: MegaSettings): Promise<string | null>;
}

/**
 * One character's MegaMUD settings as the page holds them: on file and being
 * edited, saved as they are changed (`useAutoSave`), with undo and redo.
 */
export interface MegaMudDraft {
  /** The character, or null for one not yet made (nothing to load). */
  id: string | null;
  view: MegaMudSettingsView | null;
  draft: MegaSettings | null;
  save: AutoSave;
  can: { undo: boolean; redo: boolean };
  /** Why the first write (`create`) was refused, if it was. */
  problem: string | null;
  set(section: string, key: string, value: SettingValue): void;
  update(change: (current: MegaSettings) => MegaSettings): void;
  undo(): void;
  redo(): void;
  /** Writes settings for a character that has none yet: creating still takes a press. */
  create(): Promise<void>;
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

export function useMegaMudDraft(id: string | null, store: MegaMudStore): MegaMudDraft {
  const { load, save } = store;
  const [view, setView] = useState<MegaMudSettingsView | null>(null);
  /** Whose settings `history` holds, so a switch never saves one under the other's id. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [history, setHistory] = useState<History<MegaSettings> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setView(null);
    setLoadedFor(null);
    setHistory(null);
    setProblem(null);
    if (id === null) return;
    void load(id).then((found) => {
      if (!live) return;
      setView(found);
      setHistory(found ? begin(structuredClone(found.settings)) : null);
      setLoadedFor(id);
    });
    return () => {
      live = false;
    };
  }, [id, load]);

  const draft = history?.present ?? null;
  /*
   * Saved as changed, like the rest of the Character page (2026-10-14), but
   * only once the character has a `megamud.ini`: the first write switches it
   * to the MegaMUD engine, and that is a press (`create`), not a keystroke.
   */
  const autoSave = useAutoSave<MegaSettings>({
    value: loadedFor === id ? draft : null,
    identity: id,
    enabled: id !== null && loadedFor === id && view?.engine === true,
    same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    save: (settings) => (id === null ? Promise.resolve(null) : save(id, settings))
  });

  const change = (next: (current: MegaSettings) => MegaSettings): void =>
    setHistory((current) =>
      current === null
        ? current
        : record(current, next(current.present), (a, b) => JSON.stringify(a) === JSON.stringify(b))
    );

  const create = useCallback(async () => {
    if (id === null || draft === null) return;
    setProblem(null);
    const refused = await save(id, draft);
    if (refused !== null) {
      setProblem(refused);
      return;
    }
    const found = await load(id);
    setView(found);
    setHistory(found ? begin(structuredClone(found.settings)) : null);
  }, [id, draft, load, save]);

  return {
    id,
    view,
    draft,
    save: autoSave,
    can: {
      undo: history !== null && canUndo(history),
      redo: history !== null && canRedo(history)
    },
    problem,
    set: (section, key, value) => change((current) => withValue(current, section, key, value)),
    update: change,
    undo: () => setHistory((current) => (current ? undo(current) : current)),
    redo: () => setHistory((current) => (current ? redo(current) : current)),
    create
  };
}

/**
 * The tabs not drawn as rows: BBS, whose BBS list and account are the
 * realm's page and the Character row's login, and whose own settings (MudOp
 * access, `sys goto`, the redials) the Character row holds (`MEGA_ACCOUNT`).
 */
const NOT_ROWS: readonly string[] = ['BBS'];

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
 * saved as it is changed like the rest of the Character page, with its own
 * undo and redo. A character with no MegaMUD settings yet is switched over by
 * a press.
 */
export function MegaMudPanel({
  tab,
  mega,
  loops = []
}: {
  tab: string;
  mega: MegaMudDraft;
  /** The loops the character can walk, for a timed event's loop. */
  loops?: readonly string[];
}) {
  const page = SETTINGS_TABS.find((p) => p.title === tab);
  if (page === undefined) return null;
  const { view, draft } = mega;
  if (mega.id === null) return <p className="settings-note">{t('settings.megamud.saveFirst')}</p>;
  if (view === null || draft === null)
    return <div className="settings-form empty">{t('settings.megamud.loading')}</div>;
  return (
    <div className="megamud-settings">
      {!view.engine && <p className="settings-warn">{t('settings.megamud.noFile')}</p>}
      <TabPage
        choices={view.choices}
        controls={page.controls}
        draft={draft}
        key={`${mega.id}-${tab}`}
        loops={loops}
        tab={tab}
        update={mega.update}
        hasPassword={view.hasPassword}
        height={page.h}
        onProfile={(n) => mega.update((current) => switchProfile(current, n))}
        onProfileEnabled={(n, on) =>
          mega.update((current) =>
            page.profiled ? withSlotEnabled(current, page.profiled, n, on) : current
          )
        }
        profiled={page.profiled}
        set={mega.set}
        width={page.w}
      />
      <div className="megamud-actions">
        {view.engine ? (
          <FormActions
            can={mega.can}
            error={mega.save.error}
            onRedo={mega.redo}
            onUndo={mega.undo}
            state={mega.save.state}
          />
        ) : (
          <>
            {mega.problem !== null && <span className="settings-problem">{mega.problem}</span>}
            <button onClick={() => void mega.create()} onMouseDown={keepFocus} type="button">
              {t('settings.megamud.create')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The BBS tab's settings that are the character's and not the realm's or the
 * login's (`0x419e80`): MudOp access and its `sys goto`, and the redials,
 * which stand in for our own reconnecting under the engine. In MegaMUD's
 * words, on the Character row (2026-10-14).
 */
const MEGA_ACCOUNT: readonly {
  section: string;
  key: string;
  label: string;
  as: 'check' | 'int' | 'text';
}[] = [
  { section: 'BBS', key: 'IsMudop', label: 'Has MudOp access', as: 'check' },
  { section: 'BBS', key: 'SysGoto', label: 'sys goto', as: 'text' },
  { section: 'Comms', key: 'RedialConnect', label: 'Reconnect if dial fails', as: 'check' },
  { section: 'Comms', key: 'RedialCarrier', label: 'Reconnect if carrier lost', as: 'check' },
  { section: 'Comms', key: 'RedialNoResponse', label: 'Reconnect if no BBS response', as: 'check' },
  { section: 'Comms', key: 'RedialCleanup', label: 'Reconnect after cleanup', as: 'check' },
  { section: 'Comms', key: 'LogoffLowExp', label: 'Disconnect if low exp. rate', as: 'check' },
  { section: 'Comms', key: 'RedialMax', label: 'Max. re-dials', as: 'int' },
  { section: 'Comms', key: 'RedialPause', label: 'Re-dial pause (seconds)', as: 'int' },
  { section: 'Comms', key: 'CleanupPeriod', label: 'Cleanup period (minutes)', as: 'int' },
  { section: 'Comms', key: 'MinExpRate', label: 'Min. exp. rate (per hour)', as: 'int' },
  { section: 'Comms', key: 'LagWait', label: 'Lag pause (seconds)', as: 'int' }
];

/** `MEGA_ACCOUNT`, for a character the engine runs. */
export function MegaMudAccount({ mega }: { mega: MegaMudDraft }) {
  const { view, draft } = mega;
  if (view === null || draft === null || !view.engine) return null;
  return (
    <fieldset className="settings-menus" data-fieldset="megamud-account">
      <legend>{t('settings.megamud.accountLegend')}</legend>
      {MEGA_ACCOUNT.map(({ section, key, label, as }) => {
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
      })}
      {mega.save.state === 'refused' && (
        <p className="settings-problem">{mega.save.error ?? t('settings.formActions.notSaved')}</p>
      )}
    </fieldset>
  );
}

/** A tab's profile copy (2–4) switched on or off; switched on, made from the live values when missing. */
function withSlotEnabled(
  settings: MegaSettings,
  section: ProfiledSection,
  n: number,
  on: boolean
): MegaSettings {
  const next = structuredClone(settings);
  const slots = next.profiles[section];
  const slot = slots[n - 1];
  if (slot) slot.enabled = on;
  else if (on) slots[n - 1] = { enabled: true, values: { ...slots[0]!.values } };
  return next;
}

interface TabPageProps {
  tab: string;
  choices: MegaChoices | null;
  loops: readonly string[];
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

function TabPage({
  tab,
  choices,
  loops,
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
  return (
    <div className="megamud-page" style={{ width: width * DLU_X, height: height * DLU_Y }}>
      {controls.map((c) => {
        if (c.hidden || !drawnHere(tab, c)) return null;
        const style = {
          left: c.x * DLU_X,
          top: c.y * DLU_Y,
          width: c.w * DLU_X,
          height: c.kind === 'combo' ? 12 * DLU_Y : c.h * DLU_Y
        };
        const key = `${c.id}-${c.x}-${c.y}`;
        const custom = customControl(tab, c, {
          draft,
          choices,
          loops,
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
  style: React.CSSProperties;
  set(section: string, key: string, value: SettingValue): void;
}

function Control({ control: c, draft, hasPassword, style, set }: ControlProps) {
  const b: ControlBind | undefined = c.bind;
  const value = b ? valueOf(draft, b.section, b.key) : undefined;
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
        <label className="megamud-control megamud-check" style={style}>
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
      return (
        <input
          aria-label={b ? `${b.section}.${b.key}` : undefined}
          className="megamud-control megamud-edit"
          disabled={b === undefined}
          inputMode={b?.as === 'int' ? 'numeric' : undefined}
          onChange={(event) => {
            if (!b) return;
            const text = event.target.value;
            set(b.section, b.key, b.as === 'int' ? Number.parseInt(text, 10) || 0 : text);
          }}
          placeholder={password && hasPassword ? t('settings.megamud.passwordKept') : undefined}
          style={style}
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
