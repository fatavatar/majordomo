import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_SKIN, isSkin, SKINS, type SkinId } from '@shared/skins';
import Advanced from './Advanced';
import AlertList from './AlertList';
import { MonsterRuleList } from './MonsterRules';
import SettingsNav, { type NavFieldset } from './SettingsNav';
import { CheckField, NumberField, SelectField, TextField } from './FormField';
import LoginSteps from './LoginSteps';
import LoopSection from './LoopSection';
import RewritesDesigner from './RewriteDesigner';

import { t } from '../lib/i18n';
import type { GlobalDraft } from '@shared/drafts';
import type { SpellOption } from '@shared/ipc';
import type { Loop, ScopedLoop } from '@shared/loops';
import {
  TERMINAL_THEME_IDS,
  TERMINAL_THEMES,
  THEME_IDS,
  THEMES,
  themesOfAppearance,
  type TerminalPalette
} from '@shared/themes';
import type { StreamEncoding } from '@shared/types';

/**
 * The two halves of `global/default.yaml`, drawn one at a time.
 *
 * The file holds two different kinds of thing and used to present them as one
 * list, which made "Global" mean everything and therefore nothing:
 *
 * - **`scope: 'client'` — MudEngine.** Settings about the client itself: how
 *   the console looks, which theme, where the tabs sit, what gets written to
 *   disk. Nothing here belongs to a realm or to a character.
 * - **`scope: 'defaults'` — Global.** The values a *new* realm and a *new*
 *   character start from. A realm or a character takes a copy of them when it
 *   is made and states them in its own file from then on, so changing one here
 *   changes what the next one starts with and leaves the ones already made
 *   alone.
 *
 * Both edit the same draft and save through the same call, because they are
 * one file; only which sections are offered differs.
 *
 * Built to the same test the character form is (see `SettingsScreen`'s doc
 * comment): **a section exists when there is a typed block behind it**, not
 * because the nouns sort cleanly.
 *
 * Two things it deliberately does not hold:
 *
 * - **`automation.rules` and `automation.events`.** Lists of guard expressions
 *   with comments explaining why, which is what YAML is genuinely good at.
 *   Every section that would have held them says where they live instead — a
 *   section with nothing behind it is worse than none, and a section that names
 *   where the rest is, is not that.
 * - **The realms themselves**, because a realm is a directory with a page of
 *   its own.
 * - **Any credential.** Every character carries its own username and password
 *   inline, on its own page — there is no shared or pre-character account for
 *   this screen to hold.
 */
export interface GlobalSettingsProps {
  /** Which half of the file to show — see the doc comment above. */
  scope: GlobalScope;
  draft: GlobalDraft;
  onChange(next: GlobalDraft): void;
  /** Save now rather than waiting out the debounce — Enter in a field. */
  onSubmit(): void;
  catalogue: Loop[] | null;
  picking: boolean;
  onOpenPicker(): void;
  onDonePicking(): void;
  onToggleLoop(loop: Loop): void;
  /** A loop handed out as a file for another player to import. */
  onExportLoop(loop: Loop): void;
  /** Edit on a loop row: see `LoopSectionProps.editFor`. */
  editLoopFor?(loop: Loop, from: ScopedLoop | null): (() => void) | null;
  firstFieldRef: React.RefObject<HTMLInputElement>;
  /**
   * What the spell pickers offer here: the shipped realm's castable spells.
   * This form is the *starting point* a new character copies, so there is no
   * character whose own book could narrow the list — the character form
   * passes that character's book instead.
   */
  realmSpells: readonly SpellOption[];
  /** The console's palette, which the status line's preview is drawn against. */
  palette: TerminalPalette;
  /**
   * The way back and how the saving is going, drawn by the screen that owns
   * both. There is no Save button: this file exists, so every change to it is
   * written on its own — see `useAutoSave`.
   */
  actions: React.ReactNode;
}

/** Which half of the file this form is showing. */
export type GlobalScope = 'client' | 'defaults';

/**
 * The sections each half offers, in order.
 *
 * The defaults half is what a character starts from, under the MegaMUD tab
 * each belongs to on the Character page (2026-10-14): what this client keeps
 * beside the MegaMUD engine and nothing of the old automation's. Realm and the
 * console's rewrites are ours, with no MegaMUD tab to stand under.
 */
const SECTIONS: Record<GlobalScope, readonly Section[]> = {
  client: ['appearance', 'records'],
  defaults: ['realm', 'Auto-roam', 'Combat', 'Health', 'Loot', 'Sounds', 'rewrites']
};

type Section =
  | 'appearance'
  | 'records'
  | 'realm'
  | 'Auto-roam'
  | 'Combat'
  | 'Health'
  | 'Loot'
  | 'Sounds'
  | 'rewrites';

/**
 * The fieldsets inside each section, as the rail's jump targets (todo 02),
 * with the same ids the Character page's `SECTION_FIELDSETS` uses.
 */
const SECTION_FIELDSETS: Record<Section, readonly NavFieldset[]> = {
  appearance: [{ id: 'appearance-vitals', label: t('settings.client.appearance.vitalsLegend') }],
  records: [],
  realm: [{ id: 'realm-login', label: t('settings.realms.loginLegend') }],
  'Auto-roam': [
    { id: 'movement-keep-out', label: t('settings.movement.keepOutLegend') },
    { id: 'hunting', label: t('settings.hunting.legend') },
    { id: 'quests', label: t('settings.quests.legend') }
  ],
  Combat: [{ id: 'combat-monster-rows', label: t('settings.combat.monsterRowsLegend') }],
  Health: [
    { id: 'health-flee', label: t('settings.health.fleeLegend') },
    { id: 'health-wards', label: t('settings.health.wardsLegend') }
  ],
  Loot: [{ id: 'movement-carry', label: t('settings.movement.carryLegend') }],
  Sounds: [{ id: 'alerts-rules', label: t('settings.alerts.ruleLegend') }],
  rewrites: []
};

/** MegaMUD's tabs by their own names, as the Character page's rows are. */
const SECTION_LABEL: Record<Section, string> = {
  appearance: t('settings.client.tabs.appearance'),
  records: t('settings.client.tabs.records'),
  realm: t('settings.global.tabs.realm'),
  'Auto-roam': 'Auto-roam',
  Combat: 'Combat',
  Health: 'Health',
  Loot: 'Loot',
  Sounds: 'Sounds',
  rewrites: t('settings.tabs.rewrites')
};

import {
  barOf,
  fractionOf as fraction,
  joinNames,
  percentOf as percent,
  splitNames
} from '../lib/form';

const ENCODINGS: readonly StreamEncoding[] = ['cp437', 'utf8', 'latin1'];

/**
 * Keys whose value is a block a spread-merge is sound for. Arrays are shut
 * out because `loops` is one, and object-spreading an array quietly turns it
 * into `{0: …}` — the constraint keeps that a compile error rather than a
 * cast's word.
 */
type BlockKey<T> = {
  [K in keyof T]: T[K] extends readonly unknown[] ? never : T[K] extends object ? K : never;
}[keyof T];

/** One literal \`t()\` per skin, for \`i18n-coverage.test.ts\`. */
const SKIN_WORD: Record<SkinId, () => string> = {
  classic: () => t('settings.client.appearance.skins.classic'),
  glance: () => t('settings.client.appearance.skins.glance')
};

export default function GlobalSettings({
  scope,
  draft,
  onChange,
  onSubmit,
  catalogue,
  picking,
  onOpenPicker,
  onDonePicking,
  onToggleLoop,
  onExportLoop,
  editLoopFor,
  firstFieldRef,
  realmSpells,
  palette,
  actions
}: GlobalSettingsProps): React.JSX.Element {
  /*
   * The first section of whichever half is showing.
   *
   * Keyed on the scope so that switching from MudEngine to Global lands on
   * Realm rather than on nothing: a section belongs to the half it is in, and
   * a remembered one from the other half names a tab this list does not have.
   */
  const [section, setSection] = useState<Section>(() => SECTIONS[scope][0]!);
  const shown = SECTIONS[scope].includes(section) ? section : SECTIONS[scope][0]!;

  /**
   * One block at a time, merged onto the draft.
   *
   * Blocks rather than a flat field list because the draft mirrors the file's
   * own shape — which is what keeps this form and the YAML somebody may open
   * afterwards describing the same thing in the same words.
   */
  const patch = useCallback(
    <K extends BlockKey<GlobalDraft>>(key: K, value: Partial<GlobalDraft[K]>): void => {
      onChange({ ...draft, [key]: { ...draft[key], ...value } });
    },
    [draft, onChange]
  );

  const automation = useCallback(
    (value: Partial<GlobalDraft['automation']>): void => patch('automation', value),
    [patch]
  );

  const themes = useMemo(() => THEME_IDS.map((id) => ({ id, label: THEMES[id].label })), []);
  /*
   * The bar under a percentage field, on the bands this very page sets.
   *
   * No `figure` beside it here and that is right rather than missing: Global is
   * edited with no character in the realm, so there is no maximum to state and
   * `0/0` would be the lie `figureOf` refuses. A bar needs no maximum — a
   * percentage is already the whole of it.
   *
   * The two fields that define the bands are deliberately left plain: a control
   * that sets where amber starts, drawn in amber by its own answer, is a mirror
   * rather than a reading.
   */
  const barOfHealth = (fraction: number): ReturnType<typeof barOf> =>
    barOf(percent(fraction), draft.ui.vitals.hp);
  /*
   * Only the dark ones, because that is the whole of what this setting means.
   * A select that offered a light theme here would be offering to keep the
   * console dark and then hand it a light palette — `normalizeConsoleUi` coerces
   * that away, and a form must not offer what the file refuses.
   */
  const darkThemes = useMemo(
    () => themesOfAppearance('dark').map((id) => ({ id, label: THEMES[id].label })),
    []
  );
  /*
   * `theme` first because it is the default and the only entry that is not a
   * palette, then the seven in registration order, each labelled with the way
   * it reads. Built here rather than inline so the memoised form is not handed
   * a new array every keystroke.
   */
  const consolePalettes = useMemo(
    () => [
      {
        value: 'theme',
        label: t('settings.client.appearance.consolePaletteFollow')
      },
      ...TERMINAL_THEME_IDS.map((id) => ({
        value: id,
        // Two literal calls rather than one on a conditional key: the coverage
        // test reads only the literal after `t(`.
        label:
          TERMINAL_THEMES[id].appearance === 'dark'
            ? t('settings.client.appearance.consolePaletteDark', {
                paletteLabel: TERMINAL_THEMES[id].label
              })
            : t('settings.client.appearance.consolePaletteLight', {
                paletteLabel: TERMINAL_THEMES[id].label
              })
      }))
    ],
    []
  );

  return (
    /*
      The rail and the form are siblings, not nested: `.settings-body` is the
      grid, so the rail has to be one of its children to have a column of its
      own. The character page puts them side by side the same way.
    */
    <>
      <SettingsNav
        onSection={(id: string) => setSection(id as Section)}
        section={shown}
        sections={SECTIONS[scope].map((id) => ({
          id,
          label: SECTION_LABEL[id],
          fieldsets: SECTION_FIELDSETS[id]
        }))}
      />
      <form
        className="settings-form"
        // In MegaMUD's face, as the Character page is (2026-10-16).
        data-megamud="true"
        data-section={shown}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {/*
          Said once, above the sections, rather than at the head of each of the
          seven. A page whose every section opens with the same paragraph is a
          page nobody reads the paragraphs on.
        */}
        {scope === 'defaults' && (
          <p className="settings-note">{t('settings.global.startingValuesNote')}</p>
        )}

        {shown === 'appearance' && (
          <>
            <TextField
              hint={t('settings.client.appearance.consoleFontHint')}
              inputRef={firstFieldRef}
              label={t('settings.client.appearance.consoleFontLabel')}
              name="global-font"
              onChange={(value) => patch('terminal', { fontFamily: value })}
              placeholder={t('settings.client.appearance.consoleFontPlaceholder')}
              spellCheck={false}
              value={draft.terminal.fontFamily}
              wide
            />

            <div className="settings-inline">
              <NumberField
                label={t('settings.client.appearance.fontSizeLabel')}
                name="global-font-size"
                onChange={(value) =>
                  patch('terminal', { fontSize: Number.parseInt(value, 10) || 0 })
                }
                value={draft.terminal.fontSize || ''}
              />
              <SelectField
                label={t('settings.profile.themeLabel')}
                name="global-theme"
                onChange={(value) => patch('ui', { theme: value as GlobalDraft['ui']['theme'] })}
                options={[
                  { value: 'system', label: t('settings.profile.themeSystem') },
                  ...themes.map((theme) => ({ value: theme.id, label: theme.label }))
                ]}
                value={draft.ui.theme}
              />
              <SelectField
                label={t('settings.client.appearance.skinLabel')}
                name="global-skin"
                onChange={(value) => patch('ui', { skin: isSkin(value) ? value : DEFAULT_SKIN })}
                options={SKINS.map((skin) => ({ value: skin, label: SKIN_WORD[skin]() }))}
                value={draft.ui.skin}
              />
              <SelectField
                label={t('settings.client.appearance.densityLabel')}
                name="global-density"
                onChange={(value) =>
                  patch('ui', { density: value as GlobalDraft['ui']['density'] })
                }
                options={[
                  { value: 'auto', label: t('settings.client.appearance.densityAuto') },
                  {
                    value: 'comfortable',
                    label: t('settings.client.appearance.densityComfortable')
                  },
                  { value: 'compact', label: t('settings.client.appearance.densityCompact') }
                ]}
                value={draft.ui.density}
              />
              <SelectField
                label={t('settings.client.appearance.tabPlacementLabel')}
                name="global-tabs"
                onChange={(value) => patch('ui', { tabs: value as GlobalDraft['ui']['tabs'] })}
                options={[
                  { value: 'left', label: t('settings.client.appearance.tabsLeft') },
                  { value: 'right', label: t('settings.client.appearance.tabsRight') },
                  { value: 'top', label: t('settings.client.appearance.tabsTop') }
                ]}
                value={draft.ui.tabs}
              />
            </div>

            <CheckField
              checked={draft.ui.showHud}
              label={t('settings.client.appearance.showHud')}
              name="global-hud"
              onChange={(value) => patch('ui', { showHud: value })}
            />
            <CheckField
              checked={draft.ui.showLogo}
              label={t('settings.client.appearance.showLogo')}
              name="global-show-logo"
              onChange={(value) => patch('ui', { showLogo: value })}
            />

            {/*
            The console's own colours, above the pair below because it outranks
            them: naming a palette settles what the console looks like, and the
            two keys under it only answer the case where nothing was named. The
            offer is grouped by which way round each palette reads, since a
            light palette on a dark theme is a decision, not an accident.
          */}
            <SelectField
              hint={t('settings.client.appearance.consolePaletteHint')}
              label={t('settings.client.appearance.consolePaletteLabel')}
              name="global-console-palette"
              onChange={(value) =>
                patch('ui', { consolePalette: value as GlobalDraft['ui']['consolePalette'] })
              }
              options={consolePalettes}
              value={draft.ui.consolePalette}
            />

            {/*
            The switch and the choice it discloses, on one row — the pattern
            Auto-Retreat and Anti-Idle already use. Both are drawn under every
            theme, not only a light one: a setting that vanished when you
            switched to a dark theme would be one nobody could find again.

            The hint says outright when the palette above outranks them, rather
            than the pair quietly ceasing to do anything: a control that stops
            working without saying so is the worse of the two failures.
          */}
            <div className="settings-inline">
              <CheckField
                checked={draft.ui.consoleKeepDark}
                hint={
                  draft.ui.consolePalette === 'theme'
                    ? t('settings.client.appearance.consoleKeepDarkHint')
                    : t('settings.client.appearance.consoleKeepDarkOutranked')
                }
                label={t('settings.client.appearance.consoleKeepDarkLabel')}
                name="global-console-keep-dark"
                onChange={(value) => patch('ui', { consoleKeepDark: value })}
              />
              {draft.ui.consoleKeepDark && (
                <SelectField
                  label={t('settings.client.appearance.consoleDarkThemeLabel')}
                  name="global-console-dark-theme"
                  onChange={(value) =>
                    patch('ui', {
                      consoleDarkTheme: value as GlobalDraft['ui']['consoleDarkTheme']
                    })
                  }
                  options={darkThemes.map((theme) => ({ value: theme.id, label: theme.label }))}
                  value={draft.ui.consoleDarkTheme}
                />
              )}
            </div>

            <Advanced label={t('settings.client.appearance.advancedConsole')}>
              <div className="settings-inline">
                <NumberField
                  label={t('settings.client.appearance.scrollbackLabel')}
                  name="global-scrollback"
                  onChange={(value) =>
                    patch('terminal', { scrollback: Number.parseInt(value, 10) || 0 })
                  }
                  value={draft.terminal.scrollback || ''}
                />
                <SelectField
                  label={t('settings.client.appearance.cursorStyleLabel')}
                  name="global-cursor"
                  onChange={(value) =>
                    patch('terminal', {
                      cursorStyle: value as GlobalDraft['terminal']['cursorStyle']
                    })
                  }
                  options={[
                    { value: 'block', label: t('settings.client.appearance.cursorBlock') },
                    { value: 'underline', label: t('settings.client.appearance.cursorUnderline') },
                    { value: 'bar', label: t('settings.client.appearance.cursorBar') }
                  ]}
                  value={draft.terminal.cursorStyle}
                />
                <CheckField
                  checked={draft.terminal.cursorBlink}
                  label={t('settings.client.appearance.cursorBlink')}
                  name="global-cursor-blink"
                  onChange={(value) => patch('terminal', { cursorBlink: value })}
                />
              </div>
              <TextField
                hint={t('settings.client.appearance.uiFontHint')}
                label={t('settings.client.appearance.uiFontLabel')}
                name="global-ui-font"
                onChange={(value) => patch('ui', { fontFamily: value })}
                placeholder={t('settings.client.appearance.uiFontPlaceholder')}
                spellCheck={false}
                value={draft.ui.fontFamily}
                wide
              />

              <fieldset className="settings-menus" data-fieldset="appearance-vitals">
                <legend>{t('settings.client.appearance.vitalsLegend')}</legend>
                <p className="settings-note">{t('settings.client.appearance.vitalsNote')}</p>
                {(['hp', 'mana'] as const).map((vital) => (
                  <div className="settings-inline" key={vital}>
                    <NumberField
                      label={t('settings.client.appearance.vitalCautionPercent', {
                        vitalName:
                          vital === 'hp'
                            ? t('settings.client.appearance.vitalHealth')
                            : t('settings.client.appearance.vitalMana')
                      })}
                      name={`global-${vital}-caution`}
                      onChange={(value) =>
                        patch('ui', {
                          vitals: {
                            ...draft.ui.vitals,
                            [vital]: { ...draft.ui.vitals[vital], caution: fraction(value) }
                          }
                        })
                      }
                      value={percent(draft.ui.vitals[vital].caution)}
                    />
                    <NumberField
                      label={t('settings.client.appearance.vitalCriticalPercent')}
                      name={`global-${vital}-critical`}
                      onChange={(value) =>
                        patch('ui', {
                          vitals: {
                            ...draft.ui.vitals,
                            [vital]: { ...draft.ui.vitals[vital], critical: fraction(value) }
                          }
                        })
                      }
                      value={percent(draft.ui.vitals[vital].critical)}
                    />
                  </div>
                ))}
              </fieldset>
            </Advanced>
          </>
        )}

        {shown === 'realm' && (
          <>
            <p className="settings-note">{t('settings.global.realm.noteBeforeCharacter')}</p>

            <div className="settings-inline">
              <TextField
                label={t('settings.profile.hostLabel')}
                name="global-host"
                onChange={(value) => patch('connection', { host: value })}
                placeholder={t('settings.global.realm.hostPlaceholder')}
                spellCheck={false}
                value={draft.connection.host}
              />
              <NumberField
                label={t('settings.profile.portLabel')}
                name="global-port"
                onChange={(value) => patch('connection', { port: Number.parseInt(value, 10) || 0 })}
                value={draft.connection.port || ''}
              />
            </div>

            <Advanced label={t('settings.advancedWire')}>
              <SelectField
                hint={t('settings.profile.encodingHint')}
                label={t('settings.profile.encodingLabel')}
                name="global-encoding"
                onChange={(value) => patch('connection', { encoding: value as StreamEncoding })}
                options={ENCODINGS.map((encoding) => ({ value: encoding, label: encoding }))}
                value={draft.connection.encoding}
              />
              <fieldset className="settings-menus" data-fieldset="realm-login">
                <legend>{t('settings.realms.loginLegend')}</legend>
                <p className="settings-note">{t('settings.global.realm.loginMenusNote')}</p>
                <LoginSteps
                  onChange={(steps) =>
                    patch('connection', { login: { ...draft.connection.login, steps } })
                  }
                  sendPlaceholder={t('settings.global.realm.loginMenuSendPlaceholder')}
                  steps={draft.connection.login.steps}
                  whenPlaceholder={t('settings.realms.stepWhenPlaceholder')}
                />
              </fieldset>
            </Advanced>
          </>
        )}

        {shown === 'Combat' && (
          <>
            <fieldset className="settings-menus" data-fieldset="combat-monster-rows">
              <legend>{t('settings.combat.monsterRowsLegend')}</legend>
              <p className="settings-note">{t('settings.global.combat.monsterRowsNote')}</p>
              {/* No suggestions here, and deliberately: this page belongs to no
                character and therefore to no realm, and the monsters one realm
                names mean nothing on another. The field is typable, which is
                what it is for a character on a realm the client holds no data
                for either. */}
              <div className="realm-messages">
                <MonsterRuleList
                  addLabel={t('settings.monsters.add')}
                  emptyText={t('settings.global.combat.monsterRowsNone')}
                  known={[]}
                  namePrefix="global-monster"
                  onChange={(rows) => {
                    automation({ combat: { ...draft.automation.combat, monsters: rows } });
                    return Promise.resolve(null);
                  }}
                  rows={draft.automation.combat.monsters}
                />
              </div>
            </fieldset>
            <Advanced label={t('settings.global.combat.advancedPacing')}>
              <p className="settings-note">{t('settings.global.combat.pacingNote')}</p>
              <div className="settings-inline">
                <NumberField
                  label={t('settings.global.combat.pacingWindowLabel')}
                  name="global-pacing-window"
                  onChange={(value) =>
                    automation({
                      pacing: {
                        ...draft.automation.pacing,
                        window: Number.parseInt(value, 10) || 0
                      }
                    })
                  }
                  value={draft.automation.pacing.window}
                />
                <NumberField
                  label={t('settings.global.combat.pacingMinGapLabel')}
                  name="global-pacing-gap"
                  onChange={(value) =>
                    automation({
                      pacing: {
                        ...draft.automation.pacing,
                        minGapMs: Number.parseInt(value, 10) || 0
                      }
                    })
                  }
                  value={draft.automation.pacing.minGapMs}
                />
                <NumberField
                  label={t('settings.global.combat.pacingTimeoutLabel')}
                  name="global-pacing-timeout"
                  onChange={(value) =>
                    automation({
                      pacing: {
                        ...draft.automation.pacing,
                        ackTimeoutMs: Number.parseInt(value, 10) || 0
                      }
                    })
                  }
                  value={draft.automation.pacing.ackTimeoutMs}
                />
              </div>
            </Advanced>
          </>
        )}

        {shown === 'Health' && (
          <>
            <fieldset className="settings-menus" data-fieldset="health-flee">
              <legend>{t('settings.health.fleeLegend')}</legend>
              <p className="settings-note">{t('settings.health.fleeHint')}</p>
              <div className="settings-inline">
                <CheckField
                  checked={draft.automation.fleeGoto.enabled}
                  label={t('settings.health.fleeLabel')}
                  name="global-flee"
                  onChange={(value) =>
                    automation({ fleeGoto: { ...draft.automation.fleeGoto, enabled: value } })
                  }
                />
                <NumberField
                  label={t('settings.health.belowHealthLabel')}
                  name="global-flee-health"
                  onChange={(value) =>
                    automation({
                      fleeGoto: { ...draft.automation.fleeGoto, belowHealth: fraction(value) }
                    })
                  }
                  bar={barOfHealth(draft.automation.fleeGoto.belowHealth)}
                  value={percent(draft.automation.fleeGoto.belowHealth)}
                />
              </div>
              <TextField
                hint={t('settings.health.fleeDestinationHint')}
                label={t('settings.health.fleeDestinationLabel')}
                name="global-flee-destination"
                onChange={(value) =>
                  automation({ fleeGoto: { ...draft.automation.fleeGoto, destination: value } })
                }
                placeholder={t('settings.health.fleeDestinationPlaceholder')}
                spellCheck={false}
                value={draft.automation.fleeGoto.destination}
                wide
              />
            </fieldset>
            <fieldset className="settings-menus" data-fieldset="health-wards">
              <legend>{t('settings.health.wardsLegend')}</legend>
              <CheckField
                checked={draft.automation.health.useWards}
                hint={t('settings.health.useWardsHint')}
                label={t('settings.health.useWards')}
                name="global-use-wards"
                onChange={(value) =>
                  automation({ health: { ...draft.automation.health, useWards: value } })
                }
              />
            </fieldset>
          </>
        )}

        {shown === 'Auto-roam' && (
          <>
            <fieldset className="settings-menus" data-fieldset="movement-keep-out">
              <legend>{t('settings.movement.keepOutLegend')}</legend>
              <TextField
                hint={t('settings.movement.keepOutOfHint')}
                label={t('settings.movement.keepOutOf')}
                name="global-keep-out-of"
                onChange={(value) =>
                  automation({
                    movement: { ...draft.automation.movement, keepOutOf: splitNames(value) }
                  })
                }
                placeholder={t('settings.movement.keepOutOfPlaceholder')}
                value={joinNames(draft.automation.movement.keepOutOf)}
                wide
              />
            </fieldset>

            <LoopSection
              catalogue={catalogue}
              loops={draft.loops}
              note={t('settings.global.movement.loopsNote')}
              onDonePicking={onDonePicking}
              onExport={onExportLoop}
              editFor={editLoopFor}
              onOpenPicker={onOpenPicker}
              onToggle={onToggleLoop}
              picking={picking}
            />

            {/*
              Where a character should be at all (todo 05). Beside the loops
              and the floor below, because the three answer one question: where
              this character spends its night, and what it takes to be worth
              staying.
            */}
            <fieldset className="settings-menus" data-fieldset="hunting">
              <legend>{t('settings.hunting.legend')}</legend>
              <p className="settings-note">{t('settings.hunting.note')}</p>
              <div className="settings-inline">
                <CheckField
                  checked={draft.automation.hunting.enabled}
                  hint={t('settings.hunting.autoHint')}
                  label={t('settings.hunting.auto')}
                  name="global-hunt-auto"
                  onChange={(value) =>
                    automation({ hunting: { ...draft.automation.hunting, enabled: value } })
                  }
                />
                {draft.automation.hunting.enabled && (
                  <NumberField
                    hint={t('settings.hunting.radiusHint')}
                    label={t('settings.hunting.radius')}
                    name="global-hunt-radius"
                    onChange={(value) =>
                      automation({
                        hunting: {
                          ...draft.automation.hunting,
                          radius: Math.max(0, Number.parseInt(value, 10) || 0)
                        }
                      })
                    }
                    value={
                      draft.automation.hunting.radius > 0
                        ? String(draft.automation.hunting.radius)
                        : ''
                    }
                  />
                )}
              </div>
              {/*
                In Hunting, the one thing that reads it (\`AutoHunt\`): not behind
                Advanced, as a floor that stops the lap is a decision about the
                character's night, not a number with a right answer already.
              */}
              <NumberField
                hint={t('settings.global.movement.minExpRateHint')}
                label={t('settings.global.movement.minExpRateLabel')}
                name="global-min-exp-rate"
                onChange={(value) =>
                  automation({
                    walk: {
                      ...draft.automation.walk,
                      minExpPerHour: Math.max(0, Number.parseInt(value, 10) || 0)
                    }
                  })
                }
                value={String(draft.automation.walk.minExpPerHour)}
              />
            </fieldset>

            <fieldset className="settings-menus" data-fieldset="quests">
              <legend>{t('settings.quests.legend')}</legend>
              {/*
                In the open, like opening fights unasked: a run has the character
                for as long as a chain takes, and the sentence that says so is
                not a tooltip.
              */}
              <p className="settings-warn">{t('settings.quests.warning')}</p>
              <CheckField
                checked={draft.automation.quests.enabled}
                hint={t('settings.quests.enabledHint')}
                label={t('settings.quests.enabled')}
                name="global-quests-enabled"
                onChange={(value) => automation({ quests: { enabled: value } })}
              />
            </fieldset>
          </>
        )}

        {shown === 'Loot' && (
          <>
            <fieldset className="settings-menus" data-fieldset="movement-carry">
              <legend>{t('settings.movement.carryLegend')}</legend>
              <CheckField
                checked={draft.automation.movement.collectKeys}
                hint={t('settings.movement.collectKeysHint')}
                label={t('settings.movement.collectKeys')}
                name="global-collect-keys"
                onChange={(value) =>
                  automation({ movement: { ...draft.automation.movement, collectKeys: value } })
                }
              />
            </fieldset>
          </>
        )}

        {shown === 'rewrites' && (
          <>
            <RewritesDesigner
              figures={null}
              idPrefix="global-rewrites"
              onChange={(next) => patch('ui', { rewrites: next })}
              palette={palette}
              value={draft.ui.rewrites}
            />
          </>
        )}

        {shown === 'Sounds' && (
          <>
            {/*
            The player's own rows, and the only thing that decides what is
            alerted (todo 02). The same fieldset the character page draws, from
            the same component: this page is where a new character's alerts are
            copied from, so a list that existed on one page only was a starting
            point nobody could set.
          */}
            <fieldset className="settings-menus" data-fieldset="alerts-rules">
              <legend>{t('settings.alerts.ruleLegend')}</legend>
              <p className="settings-note">{t('settings.alerts.ruleNote')}</p>
              <AlertList
                namePrefix="global-alert-rule"
                onChange={(rules) => patch('ui', { alerts: { ...draft.ui.alerts, rules } })}
                rules={draft.ui.alerts.rules}
              />
            </fieldset>
          </>
        )}

        {shown === 'records' && (
          <>
            <p className="settings-note">{t('settings.client.records.note')}</p>
            <CheckField
              checked={draft.logging.enabled}
              label={t('settings.client.records.enabled')}
              name="global-logging"
              onChange={(value) => patch('logging', { enabled: value })}
            />
            <CheckField
              checked={draft.logging.capture}
              hint={t('settings.client.records.captureHint')}
              label={t('settings.client.records.captureLabel')}
              name="global-capture"
              onChange={(value) => patch('logging', { capture: value })}
            />
            <CheckField
              checked={draft.logging.fights}
              hint={t('settings.client.records.fightsHint')}
              label={t('settings.client.records.fightsLabel')}
              name="global-fights"
              onChange={(value) => patch('logging', { fights: value })}
            />
            <CheckField
              checked={draft.logging.conversations}
              hint={t('settings.client.records.conversationsHint')}
              label={t('settings.client.records.conversationsLabel')}
              name="global-conversations"
              onChange={(value) => patch('logging', { conversations: value })}
            />
            <NumberField
              hint={t('settings.client.records.conversationDaysHint')}
              label={t('settings.client.records.conversationDaysLabel')}
              name="global-conversation-days"
              onChange={(value) =>
                patch('logging', { conversationDays: Number.parseInt(value, 10) || 0 })
              }
              value={draft.logging.conversationDays}
            />
            <TextField
              label={t('settings.client.records.folderLabel')}
              name="global-log-folder"
              onChange={(value) => patch('logging', { directory: value })}
              placeholder={t('settings.client.records.folderPlaceholder')}
              spellCheck={false}
              value={draft.logging.directory}
              wide
            />
            <Advanced label={t('settings.client.records.advancedLogSize')}>
              <NumberField
                label={t('settings.client.records.maxBytesLabel')}
                name="global-log-bytes"
                onChange={(value) =>
                  patch('logging', { maxBytes: Number.parseInt(value, 10) || 0 })
                }
                value={draft.logging.maxBytes}
              />
              <NumberField
                label={t('settings.client.records.keepBytesLabel')}
                name="global-log-keep-bytes"
                onChange={(value) =>
                  patch('logging', { keepBytes: Number.parseInt(value, 10) || 0 })
                }
                value={draft.logging.keepBytes}
              />
            </Advanced>
          </>
        )}

        <div className="settings-actions">{actions}</div>
      </form>
    </>
  );
}
