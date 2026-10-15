import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { MessageImport, MessageTable, MessageTrigger } from '@shared/messageTriggers';
import type { MonsterImport, MonsterRule, MonsterTable } from '@shared/monsterRules';
import type { ItemImport, ItemRule, ItemTable } from '@shared/itemRules';
import type { LoopImport, MegaMudPath } from '@shared/megamudPaths';
import { asShippedWorld } from '@shared/worlds';
import { DENOMINATIONS } from '@shared/character';
import { STOCK_COINS } from '@shared/coins';
import { BBS_KEYS, type BbsKey } from '@shared/megamud/bbs';
import type { StatlineFigures } from '@shared/statline';
import type { TerminalPalette } from '@shared/themes';
import type { GearSet } from '@shared/gear';
import type { BankChoice, TrainerChoice, WardRule } from '@shared/world';
import type { PotionRule, PotionWhen } from '@shared/config';
import type { AlertRule } from '@shared/notifications';
import AlertList from './AlertList';
import RealmMessages from './RealmMessages';
import RealmMonsters from './RealmMonsters';
import RealmItems from './RealmItems';
import RealmSpellLore from './RealmSpellLore';
import { MonsterRuleList } from './MonsterRules';
import SettingsNav, { type NavFieldset, type NavSection } from './SettingsNav';
import Icon from './Icon';
import FormField, {
  CheckField,
  NumberField,
  PasswordField,
  SelectField,
  TextField
} from './FormField';
import Advanced from './Advanced';
import { ItemDetailsFieldset } from './CarrySections';
import FormActions from './FormActions';
import GlobalSettings from './GlobalSettings';
import LoopSection from './LoopSection';
import MegaMudLoopImport from './MegaMudLoopImport';
import { WardRules } from './PotionList';
import {
  MEGA_TABS,
  MegaMudAccount,
  MegaMudIniImport,
  MegaMudPanel,
  characterOfIni,
  isMegaTab,
  useMegaMudDraft
} from './MegaMudSettings';
import type { MegaSettings } from '@shared/megamud/settings';
import RemoteList from './RemoteList';
import RewritesDesigner from './RewriteDesigner';

import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { COIN_NAME } from '../lib/coins';
import { barOf, figureOf, fractionOf, joinNames, percentOf, splitNames } from '../lib/form';
import {
  begin,
  canRedo,
  canUndo,
  historyIntent,
  record,
  redo,
  replace,
  targetOf,
  undo,
  type History
} from '../lib/history';
import { useAutoSave } from '../hooks/useAutoSave';
import { mergedSave, useMergedHistory } from '../hooks/useMergedHistory';
import { useSettingsPanel } from '../hooks/useSettingsPanel';
import { PROFILE_ACCENTS, type ProfileAccent } from '@shared/profiles';
import { isThemePreference, THEME_IDS, THEMES, type ThemePreference } from '@shared/themes';
import type {
  GlobalDraft,
  LoginStepDraft,
  ProfileDraft,
  ServerDraft,
  BlessingDraft,
  CuresDraft,
  RegenDraft
} from '@shared/drafts';
import type { Loop, ScopedLoop } from '@shared/loops';
import type {
  LearnedSpellRow,
  LearnedSpellTable,
  MegaMudSettingsView,
  ProfileEditable,
  SessionId,
  SettingsSnapshot
} from '@shared/ipc';
import type { StreamEncoding } from '@shared/types';
import {
  DEFAULT_CONFIG,
  DEFAULT_REALM_NAME,
  RETREAT_STRATEGIES,
  type BankingConfig,
  type DropConfig,
  type EngagePolicy,
  type LocateMethod,
  type LootConfig,
  type RetreatStrategy,
  type PartyRank,
  type PvpAction,
  type RewritesUiConfig,
  type SearchConfig
} from '@shared/config';
import { TRAINED_ATTRIBUTES, type TrainedAttribute } from '@shared/training';
import {
  ACTIONABLE_REMOTES,
  type BotCommand,
  type PlayerGrant,
  type RemoteName
} from '@shared/remotes';
import BotCommandList from './BotCommandList';
import { errorMessage } from '@shared/values';

/**
 * Whether a realm's `database` walks something other than the world the
 * shipped loops were recorded in. Blank follows the realm's own word, which the
 * settings screen cannot know, and is read as Paradigm's — the default.
 */
function walksAnotherWorld(database: string): boolean {
  const stated = database.trim();
  return stated.length > 0 && asShippedWorld(stated) !== 'paradigm';
}

/** The shipped combat defaults, so a new character and the file agree. */
const DEFAULT_COMBAT = DEFAULT_CONFIG.automation.combat;
const DEFAULT_HEALTH = DEFAULT_CONFIG.automation.health;
const DEFAULT_MOVEMENT = DEFAULT_CONFIG.automation.movement;
const DEFAULT_SPELLS = DEFAULT_CONFIG.automation.spells;

/** The six wanted figures as the form holds them: strings, so a half-typed one is not a 0. */
function wantedStrings(
  wanted: Record<TrainedAttribute, string | number>
): Record<TrainedAttribute, string> {
  const out = {} as Record<TrainedAttribute, string>;
  for (const attribute of TRAINED_ATTRIBUTES) out[attribute] = String(wanted[attribute]);
  return out;
}
function wantedNumbers(wanted: Record<TrainedAttribute, string>): Record<TrainedAttribute, number> {
  const out = {} as Record<TrainedAttribute, number>;
  for (const attribute of TRAINED_ATTRIBUTES)
    out[attribute] = Number.parseInt(wanted[attribute], 10) || 0;
  return out;
}
const DEFAULT_ALERTS = DEFAULT_CONFIG.ui.alerts;

/**
 * The per-player half of `automation.remotes`, edited from a form.
 *
 * The Player flyout is the surface most people use, and it can only be opened
 * on somebody the client has **seen** — a name in a room, on a `who`, in a
 * telepath. That is the wrong constraint for setting a pair of characters up
 * before either has logged in, which is the ordinary case for the person
 * running four of them. So the same grid is here, addressed by a typed name.
 *
 * **One person at a time.** A form showing every named player's fifty-seven
 * rows at once would be a wall nobody reads; the names are chips, and choosing
 * one opens that person's grid. Somebody with nothing granted is not kept — an
 * empty grant is the absence of a decision, and a list that accumulated a name
 * per click would read as a list of people with permissions when it holds
 * people with none.
 */
function PlayerGrants({
  grants,
  onChange
}: {
  grants: Record<string, PlayerGrant>;
  onChange(next: Record<string, PlayerGrant>): void;
}) {
  const names = Object.keys(grants).sort();
  const [chosen, setChosen] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const who = chosen !== null && chosen in grants ? chosen : (names[0] ?? null);
  const grant = who === null ? null : grants[who]!;

  const write = (key: string, next: PlayerGrant): void => {
    const rest = { ...grants };
    // An emptied grant is removed, exactly as `SettingsEditor` removes it from
    // the file: two places that disagreed about what "nothing" looks like would
    // leave a name in the form that vanished on the next load.
    if (next.allow.length === 0 && next.deny.length === 0 && !next.autoInviteWhenSeen) {
      delete rest[key];
    } else rest[key] = next;
    onChange(rest);
  };

  return (
    <div className="remote-players">
      <TextField
        hint={t('settings.remotes.addPlayerHint')}
        label={t('settings.remotes.addPlayerLabel')}
        name="remotes-add-player"
        onChange={setTyped}
        onSubmit={() => {
          const key = typed.trim().toLowerCase();
          if (key.length === 0) return;
          setTyped('');
          setChosen(key);
          // Created empty and kept only once something is granted, so a name
          // typed by mistake leaves nothing behind.
          if (!(key in grants)) {
            onChange({ ...grants, [key]: { allow: [], deny: [] } });
          }
        }}
        placeholder={t('settings.remotes.addPlayerPlaceholder')}
        spellCheck={false}
        value={typed}
      />

      {names.length === 0 ? null : (
        <div className="settings-chips" role="group">
          {names.map((name) => (
            <button
              aria-pressed={name === who}
              className="chip toggle"
              data-on={name === who ? 'true' : 'false'}
              key={name}
              onClick={() => setChosen(name)}
              onMouseDown={keepFocus}
              type="button"
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {who === null || grant === null ? null : (
        <>
          <h4 className="settings-subhead">
            {t('settings.remotes.playerLegend', { name: who })}
            <button
              className="chip toggle"
              data-level="critical"
              onClick={() => write(who, { allow: [], deny: [] })}
              onMouseDown={keepFocus}
              title={t('settings.remotes.removePlayerTitle', { name: who })}
              type="button"
            >
              {t('settings.remotes.removePlayer')}
            </button>
          </h4>
          <RemoteList
            allow={grant.allow}
            deny={grant.deny}
            mode="player"
            onSet={(remote, stance) =>
              write(who, {
                ...grant,
                allow:
                  stance === 'allow'
                    ? [...grant.allow, remote]
                    : grant.allow.filter((entry) => entry !== remote),
                deny:
                  stance === 'deny'
                    ? [...grant.deny, remote]
                    : grant.deny.filter((entry) => entry !== remote)
              })
            }
            onSetAll={(stance) =>
              // Auto Invite when seen rides along untouched: it answers no
              // request at all, so clearing or granting every `@` remote says
              // nothing about whether this person is still invited on sight.
              write(who, {
                ...grant,
                ...(stance === 'allow'
                  ? { allow: [...ACTIONABLE_REMOTES], deny: [] }
                  : { allow: [], deny: [] })
              })
            }
            subject={who}
          />

          {/*
            Its own control, apart from the grid above: "Invite" on that grid
            answers this person's own `@invite` request; this fires with
            nobody asking (`Remotes.autoInvite`).
          */}
          <CheckField
            checked={grant.autoInviteWhenSeen === true}
            hint={t('settings.remotes.autoInviteHint')}
            label={t('settings.remotes.autoInviteLabel')}
            name={`remotes-auto-invite-${who}`}
            onChange={(value) => write(who, { ...grant, autoInviteWhenSeen: value })}
          />
        </>
      )}
    </div>
  );
}

export interface SettingsScreenProps {
  open: boolean;
  /**
   * Which character to open on: a profile id, {@link SETTINGS_NEW_CHARACTER},
   * or `null` for wherever it was left.
   *
   * A string rather than an object on purpose. This drives the effect that runs
   * when the dialog opens, and an object literal from a caller would be a new
   * value every render — which is the trap that made a refused save flash and
   * vanish before anybody could read it.
   */
  openAt?: string | null;
  /**
   * What a character's percentage thresholds are percentages *of*.
   *
   * A function rather than a value: the screen edits one character at a time
   * but is opened from anywhere, and the figures belong to the character being
   * edited rather than to whichever one is on screen. Both halves are null for
   * a character not in the realm, and `figureOf` draws that as nothing — an
   * unknown maximum has never been a number in this client.
   */
  maximaFor(session: SessionId): { hpMax: number | null; manaMax: number | null };
  /**
   * The figures the designed status line is previewed with — the character's
   * own while it is in the realm, else null and the designer draws a sample.
   */
  figuresFor(session: SessionId): StatlineFigures | null;
  /** The console's palette, which that preview is drawn against. */
  palette: TerminalPalette;
  /**
   * There is nowhere to go back to, so there is no way out of this screen.
   *
   * A client with no characters exists only to make one: there is no console,
   * no rail and no tab behind this dialog, and the version that could be
   * dismissed left somebody looking at an empty window with no way of guessing
   * what to do next. So while this is set the close glyph is not drawn, Escape
   * and the scrim do nothing, and the screen says why in one line.
   *
   * A prop rather than `characters.length === 0` read here: the screen loads
   * its own snapshot asynchronously, and the moment before that lands it would
   * be indistinguishable from a client with no characters — which is precisely
   * the state that must not be got wrong in the direction of *un*closeable.
   */
  required?: boolean;
  onClose(): void;
  load(): Promise<SettingsSnapshot>;
  saveProfile(id: string, draft: ProfileDraft): Promise<string | null>;
  deleteProfile(id: string): Promise<string | null>;
  /** A character's MegaMUD settings, read and written. See `MegaMudSettings`. */
  megamudSettings(id: string): Promise<MegaMudSettingsView | null>;
  saveMegamud(id: string, settings: MegaSettings): Promise<string | null>;
  saveServer(previousName: string | null, draft: ServerDraft): Promise<string | null>;
  deleteServer(name: string): Promise<string | null>;
  /** Writes the options file everything is inherited from. */
  saveGlobal(draft: GlobalDraft): Promise<string | null>;
  revealConfig(): void;
  revealProfiles(): void;
  /** Native picker for a realm database. Resolves to null if dismissed. */
  chooseRealm(): Promise<string | null>;
  /** A realm's message table, by name. See `RealmMessages`. */
  loadMessages(realm: string): Promise<MessageTable>;
  importMessages(realm: string, fileName: string, text: string): Promise<MessageImport>;
  saveMessages(realm: string, triggers: MessageTrigger[]): Promise<string | null>;
  /** A realm's monster table, by name. See `RealmMonsters`. */
  loadMonsters(realm: string): Promise<MonsterTable>;
  importMonsters(realm: string, fileName: string, monsters: MonsterRule[]): Promise<MonsterImport>;
  saveMonsters(realm: string, monsters: MonsterRule[]): Promise<string | null>;
  /** A realm's item table, by name. See `RealmItems`. */
  loadItems(realm: string): Promise<ItemTable>;
  importItems(realm: string, fileName: string, items: ItemRule[]): Promise<ItemImport>;
  saveItems(realm: string, items: ItemRule[]): Promise<string | null>;
  /** A realm's learned spell sentences, by name. See `RealmSpellLore`. */
  loadSpellLore(realm: string): Promise<LearnedSpellTable>;
  saveSpellLore(realm: string, rows: LearnedSpellRow[]): Promise<string | null>;
  /** A MegaMUD folder's loops onto a realm. See `MegaMudLoopImport`. */
  importLoops(realm: string, paths: MegaMudPath[]): Promise<LoopImport>;
  /**
   * The loops the client ships, for the Movement tab to offer.
   *
   * Asked for when the shelf is opened rather than with the settings snapshot:
   * it is four hundred loops, and most visits to this screen are about a
   * password. Resolves to an empty list rather than throwing — an empty shelf
   * is a package missing its data, and a hand-written loop still works.
   */
  loadLoops(): Promise<Loop[]>;
  /**
   * The trainers the realm says will take a character, cheapest first.
   *
   * Addressed, because the answer is about *that* character's level and
   * class, and asked when the Train tab is opened rather than with the
   * snapshot — it is a scan of the room index, and most visits to this screen
   * are about something else.
   *
   * Empty is a real answer and the picker says so: a level the client has not
   * read, a realm built before the bands were converted, or genuinely nothing
   * in band all mean *there is nowhere to send this character*.
   */
  loadTrainers(session: SessionId): Promise<TrainerChoice[]>;
  /**
   * The bank counters this character's realm places, for the *which vault*
   * picker (todo 00). Addressed, like the trainers, because a shop row means
   * nothing across two realms.
   */
  loadBanks(session: SessionId): Promise<BankChoice[]>;
  /**
   * The items the realm says would serve each condition a potion rule can
   * name, for the rule list's suggestions. A property of the realm, so one
   * call answers every row.
   */
  loadServing(session: SessionId): Promise<Partial<Record<PotionWhen, string[]>>>;
  /**
   * The realm's own *use this item there* rules, drawn under the switch
   * that obeys them. A property of the realm, so one call answers the
   * section.
   */
  loadWards(session: SessionId): Promise<WardRule[]>;
  /**
   * The monsters this character's realm names, for the priority list's
   * picker. A property of the realm, so one call answers every row.
   */
  loadMobNames(session: SessionId): Promise<string[]>;
}

const ENCODINGS: readonly StreamEncoding[] = ['cp437', 'utf8', 'latin1'];

/**
 * A character that has not been created yet.
 *
 * Exported so the `+` at the head of the tab rail can ask for it by name rather
 * than opening the screen and hoping it lands somewhere useful. The NUL keeps
 * it out of the space of real profile ids, which are filenames.
 */
export const SETTINGS_NEW_CHARACTER = '\u0000new';
const NEW_CHARACTER = SETTINGS_NEW_CHARACTER;
const NEW_SERVER = '\u0000new-server';

/**
 * Open straight to the realms list, rather than to a character.
 *
 * A realm is not a character's own setting — it has a directory of its own
 * because more than one character plays on the same one — so a command wanting
 * to add or edit one has no character id to name. Exported for the same reason
 * {@link SETTINGS_NEW_CHARACTER} is: a caller asks for this screen by what it
 * wants to land on, not by opening it and hoping.
 */
export const SETTINGS_MANAGE_SERVERS = '\u0000servers';

/**
 * Open on the client's own settings — the MudEngine page.
 *
 * How the client itself behaves: the console, the theme, the tabs, the records
 * it keeps. Reached from the gear at the head of the tab rail, from the
 * palette, and by the crumb here; a sentinel like the two above, for the same
 * reason.
 */
export const SETTINGS_GLOBAL = '\u0000global';

/**
 * Open on the Global page — what a new realm and a new character start with.
 *
 * A separate door from {@link SETTINGS_GLOBAL} because they are separate
 * questions: "make the console bigger" and "stop every new character resting
 * at 60%" have nothing to do with each other, and one page holding both is the
 * reason neither could be found.
 */
export const SETTINGS_DEFAULTS = '\u0000defaults';

/**
 * The two pages that draw `global/default.yaml`.
 *
 * One file, two audiences: `client` is MudEngine — how the client itself
 * behaves — and `defaults` is Global, the values a new realm and a new
 * character start from. They share a draft and a save, because a page that
 * wrote half a file would be a second writer for it.
 */
type GlobalTab = 'client' | 'defaults';

/** Whether this page is one of the two drawing the options file. */
function showsGlobal(tab: string): tab is GlobalTab {
  return tab === 'client' || tab === 'defaults';
}

/**
 * The rows of the Character page, in the order shown (2026-10-14).
 *
 * **MegaMUD's own settings tabs**, which is the point: the character is run
 * by the ported MegaMUD engine, and somebody configuring a MajorMUD client
 * has been reading those words for twenty years. What this client keeps for
 * a character (its monster and item rows, the flee, the remote grants, the
 * keep-out words, its loops, the alerts and the status line) sits under the
 * MegaMUD tab it belongs with. See docs/terminology.md §2.2.
 *
 * `Character` and `Login` are ours because MegaMUD had nothing to name: it ran
 * behind a terminal somebody else had already logged in with.
 *
 * The old automation's own sections (its combat, health, spells, party,
 * training, gear, talk and stealth settings) are gone from here: the engine
 * stands it down, and MegaMUD's tabs are what decide. Their keys stay in the
 * file, untouched.
 */
type Section = string;
const SECTIONS: readonly Section[] = ['profile', 'login', ...MEGA_TABS];
function sectionLabel(section: Section): string {
  if (section === 'profile') return t('settings.sections.character');
  if (section === 'login') return t('settings.sections.login');
  return section;
}

/**
 * Ours, under each MegaMUD tab, as the rail's jump targets (todo 02).
 *
 * Written down rather than read off the DOM, for the reason the rail gives:
 * each `id` matches the `data-fieldset` on the fieldset itself. A tab with
 * nothing of ours lists none; its own row goes to MegaMUD's page.
 */
/** The realm page's sections (2026-10-15), each a part of its one form. */
type RealmSection = 'realm' | 'loops' | 'messages' | 'monsters' | 'items' | 'spells' | 'megamud';

function realmSections(): NavSection[] {
  return [
    { id: 'realm', label: t('settings.realms.sections.realm'), fieldsets: [] },
    { id: 'loops', label: t('settings.realms.sections.loops'), fieldsets: [] },
    { id: 'messages', label: t('settings.realms.sections.messages'), fieldsets: [] },
    { id: 'monsters', label: t('settings.realms.sections.monsters'), fieldsets: [] },
    { id: 'items', label: t('settings.realms.sections.items'), fieldsets: [] },
    { id: 'spells', label: t('settings.realms.sections.spells'), fieldsets: [] },
    {
      id: 'megamud',
      label: t('settings.realms.sections.megamud'),
      fieldsets: [
        { id: 'realm-hang-penalties', label: t('settings.health.hangUpLegend') },
        { id: 'realm-coins', label: t('settings.realms.coinsLegend') },
        { id: 'realm-bbs', label: t('settings.realms.bbsLegend') }
      ]
    }
  ];
}

const SECTION_FIELDSETS: Readonly<Record<Section, readonly NavFieldset[]>> = {
  login: [{ id: 'login', label: t('settings.login.legend') }],
  'Auto-roam': [
    { id: 'movement-keep-out', label: t('settings.movement.keepOutLegend') },
    { id: 'hunting', label: t('settings.hunting.legend') },
    { id: 'quests', label: t('settings.quests.legend') }
  ],
  Talk: [
    { id: 'remotes', label: t('settings.remotes.legend') },
    { id: 'bot-commands', label: t('settings.botCommands.legend') }
  ],
  Sounds: [{ id: 'alerts-rules', label: t('settings.alerts.ruleLegend') }],
  Other: [{ id: 'movement-doors', label: t('settings.movement.doorsLegend') }],
  Health: [
    { id: 'health-flee', label: t('settings.health.fleeLegend') },
    { id: 'health-wards', label: t('settings.health.wardsLegend') }
  ],
  Combat: [{ id: 'combat-monster-rows', label: t('settings.combat.monsterRowsLegend') }],
  Loot: [
    { id: 'item-details', label: t('settings.movement.itemRowsLegend') },
    { id: 'movement-carry', label: t('settings.movement.carryLegend') }
  ]
};

interface CharacterForm {
  id: string;
  name: string;
  accent: ProfileAccent;
  theme: ThemePreference | '';
  autoConnect: boolean;
  autoReconnect: boolean;
  serverName: string | null;
  host: string;
  port: string;
  encoding: StreamEncoding;
  username: string;
  password: string;
  changePassword: boolean;
  /**
   * This character's own menu script, empty when it uses the server's.
   *
   * Empty is the ordinary case — the script belongs to the realm. A character
   * states one only to differ from the others on that realm, which in practice
   * means a different character slot.
   */
  login: LoginStepDraft[];
  hangUp: boolean;
  hangUpBelow: string;
  /** This character's own answer, null where it is left to the realm (todo 01). */
  hangUpPenalties: boolean | null;
  hangUpOnPlayer: boolean;
  pvpNotifyGang: boolean;
  pvpAction: PvpAction;
  retreat: boolean;
  retreatBelow: string;
  /** MegaMUD's `ManaRun%`, as a percentage string like `retreatBelow`. */
  retreatBelowMana: string;
  retreatOutnumbered: string;
  retreatStrategy: string;
  retreatHaven: string;
  fleeGoto: boolean;
  fleeGotoBelow: string;
  fleeGotoDestination: string;
  /**
   * Auto-combat, as the form holds it.
   *
   * The three lists are one comma-separated text field each rather than a row
   * editor like the login menus. A login step is two fields that have to stay
   * paired; these are just names, and a `+`-and-`×` list for typing three words
   * into is more chrome than the thing it holds.
   */
  combat: boolean;
  combatAttack: string;
  combatOpener: string;
  /** Hide (or sneak, while moving) between fights so the opener lands again. */
  combatHideForOpener: boolean;
  combatEngage: EngagePolicy;
  combatRetaliate: boolean;
  combatDefendAfterRounds: string;
  /** Leave alone a monster a stranger is already fighting — MegaMUD's PoliteAttacks. */
  combatPoliteAttacks: boolean;
  combatMaxMobs: string;
  /** Share of current health a fight may be expected to cost, as a percentage string. */
  /** Following somebody — `automation.party`. */
  partyAssist: boolean;
  partyDefend: boolean;
  partyRest: boolean;
  /** `party.autoRank`: keep this character at `partyPreferredRank`. */
  partyAutoRank: boolean;
  partyPreferredRank: PartyRank;
  /** `party.askForHealBelow`, as a percentage string. */
  partyAskHeal: string;
  /** `party.waitForMembersBelow`, as a percentage string. */
  partyWaitBelow: string;
  partyWaitMinutes: string;
  partyIgnoreWait: boolean;
  partyIgnoreParty: boolean;
  partyRequestHealth: boolean;
  partyParEvery: string;
  partyParAfterRound: boolean;
  combatRefresh: string;
  /** This character's own monster rows (`combat.monsters`). */
  combatMonsters: MonsterRule[];
  combatMaxTargetHealth: string;
  combatMinMobs: string;
  combatMaxMonsterExp: string;
  /** `combat.minSurvival`, as a percentage string. */
  combatMinSurvival: string;
  /** Health — resting and meditating. Percentages on screen, fractions on disk. */
  restBelow: string;
  restTo: string;
  restBeforeTraps: string;
  /** Rest next door to a lair rather than in it. */
  restNextDoor: boolean;
  meditateBelow: string;
  meditateTo: string;
  /** And where a running loop holds still and walks on again. */
  /** The player's own *use this when that* rules. See `PotionList`. */
  potionRules: PotionRule[];
  /** The realm's own half of those rules — `automation.health.useWards`. */
  useWards: boolean;
  /** Spells — the one cast a rule cannot time. */
  spellAttack: string;
  spellAreaAttack: string;
  /** Derive the round spell and the cures from the book. */
  spellAutoChoose: boolean;
  /** *Auto Choose Best Heal*: each heal picked from the book. See `SpellsConfig.autoChooseHeal`. */
  spellAutoChooseHeal: boolean;
  spellAreaMinMobs: string;
  spellAreaMinMana: string;
  /** The fallback once the round spell has no effect, and the per-target cast caps (0 is no limit). */
  spellAttackFallback: string;
  spellAttackCasts: string;
  spellAreaCasts: string;
  /** The drain spells cast instead while health is low, and the pair that starts and stops it. */
  spellDrain: string;
  spellAreaDrain: string;
  spellDrainBelow: string;
  spellDrainTo: string;
  /**
   * The heal, per character: a spell cast on this character, a spell cast on a
   * member, and the pair of figures that start and stop the casting.
   *
   * Two spells because the realm marks which may be cast on whom, and per
   * character because a healer and a warrior on the same machine want
   * different answers — which the Global-only version of this could not give.
   */
  spellHeal: string;
  spellHealPartyWith: string;
  spellHealBelow: string;
  spellHealBelowInCombat: string;
  spellHealTo: string;
  spellHealParty: boolean;
  spellMinMana: string;
  /** Cures by affliction, and the blessings kept up by events. */
  spellCures: CuresDraft;
  /** MegaMUD's regen and when-full spells. */
  spellRegen: RegenDraft;
  spellBlessings: BlessingDraft[];
  spellNotifyWearOff: boolean;
  spellAutoBless: boolean;
  spellInvokeItems: boolean;
  /** Movement — what a route may do on the way. */
  openDoors: boolean;
  openTries: string;
  pickLocks: boolean;
  pickTries: string;
  bashDoors: boolean;
  bashTries: string;
  sneak: boolean;
  provideLight: boolean;
  /** Go back for the kit after a death. */
  recoverGear: boolean;
  recoverGearTries: string;
  recoverGearFloor: string;
  lightDimRooms: boolean;
  extinguishInLight: boolean;
  /** Conditions as waits, inverted: off waits blindness / poison out. */
  walkWhileBlind: boolean;
  walkWhilePoisoned: boolean;
  walkWhileConfused: boolean;
  walkWhileLosingHp: boolean;
  /** The dangerous regions route planning keeps out of unless told. */
  fightOnArrival: boolean;
  /** Ways and places routes keep out of. See `MovementConfig`. */
  keepOutOf: string[];
  /** Bend down for a key an exit of this room needs. */
  collectKeys: boolean;
  /** Going hunting on its own — `automation.hunting`. */
  huntAuto: boolean;
  /** How far to look for a lair, as text; '' is everywhere the exits reach. */
  huntRadius: string;
  /** Spending character points on the stat screen — `automation.train`. */
  trainStats: boolean;
  trainLevels: boolean;
  /** The chosen trainer's shop row, as text, or '' for the cheapest. */
  trainTrainer: string;
  trainWanted: Record<TrainedAttribute, string>;
  /** Running a quest's plan — `automation.quests`. */
  questsEnabled: boolean;
  /** Which kit to be in, and when — `automation.gear`. */
  gearEnabled: boolean;
  gearSets: GearSet[];
  gearOffRoundItem: string;
  /** As text, so a half-typed figure is not read as 0. */
  gearOffRoundEvery: string;
  /*
   * Held whole, like `rewrites`, rather than flattened into eighteen fields.
   * They are the *same four blocks the Global page edits*, and the controls
   * below are that page's controls unchanged — a flattened copy here would be
   * a second spelling of each field for a form to forget one of. The numbers
   * inside are numbers rather than the strings the flat fields use, which is
   * what Global already does with them: a half-typed price reads as the value
   * so far, and the clamp is the same one on both pages.
   */
  loot: LootConfig;
  drop: DropConfig;
  search: SearchConfig;
  banking: BankingConfig;
  /**
   * The loops this character walks — `automation.loops`.
   *
   * Held whole rather than as a list of names, because a loop *is* its stops:
   * a name with nothing behind it would have to be looked back up in the
   * catalogue at save time, and a character may perfectly well walk a loop
   * that was never in it — one written by hand in its own file.
   */
  loops: Loop[];
  /**
   * Alerts — what this character is worth interrupting you for.
   *
   * One list and two switches. The severity floor, the per-channel mute list
   * and the find watch went with the old surface (todo 02): every question they
   * answered is a row, and two vocabularies for one question is how somebody
   * comes to believe one of them is broken. See `AlertList`.
   */
  alertRules: AlertRule[];
  /** `automation.afk` — answering for an absent player. */
  afkEnabled: boolean;
  afkAfterMinutes: string;
  afkReply: string;
  /** Whether this character answers another player's `@` commands. */
  answerRemotes: boolean;
  lookAtPlayers: boolean;
  /** Whether the client sets the prompt's shape on the way in — `automation.statline`. */
  statlineControl: boolean;
  /** The status line and listings this player designed — `ui.rewrites`. */
  rewrites: RewritesUiConfig;
  /** Whether the gang's own channel is one of the channels it answers on. */
  remoteGangpath: boolean;
  /** Whether a leader's invitation is joined without waiting for `@join`. */
  remoteAutoJoin: boolean;
  /** What anybody in this character's gang may ask for. */
  remoteGang: RemoteName[];
  /** Remotes anybody who has joined this character's party may ask for. */
  remoteParty: RemoteName[];
  /**
   * What each named player may and may not ask for, keyed lower-case.
   *
   * In the form even though the Player flyout is the surface most people use:
   * a profile save writes the whole `automation.remotes` block, so a form that
   * did not carry this would delete every per-player permission the moment
   * somebody pressed Save on an unrelated field.
   */
  remotePlayers: Record<string, PlayerGrant>;
  /** The player's own commands others may ask for (`BotCommandList`). */
  remoteCommands: BotCommand[];
}

function formOf(entry: ProfileEditable): CharacterForm {
  return {
    id: entry.id,
    name: entry.name,
    accent: entry.accent,
    theme: entry.theme,
    autoConnect: entry.autoConnect,
    autoReconnect: entry.autoReconnect,
    serverName: entry.serverName,
    host: entry.target.host,
    port: String(entry.target.port),
    encoding: entry.target.encoding,
    username: entry.username,
    // Never populated from disk: a password that has crossed to a renderer can
    // reach a devtools snapshot, a crash report or a screenshot. Blank means
    // "leave it alone", and `changePassword` is what says otherwise.
    password: '',
    changePassword: false,
    login: entry.login,
    retreat: entry.retreat.enabled,
    retreatBelow: String(Math.round(entry.retreat.belowHealth * 100)),
    retreatBelowMana: String(Math.round(entry.retreat.belowMana * 100)),
    retreatOutnumbered: String(entry.retreat.whenOutnumbered),
    retreatStrategy: entry.retreat.strategy,
    retreatHaven: entry.retreat.safeHavenRoom,
    fleeGoto: entry.fleeGoto.enabled,
    fleeGotoBelow: String(Math.round(entry.fleeGoto.belowHealth * 100)),
    fleeGotoDestination: entry.fleeGoto.destination,
    hangUp: entry.hangUp.enabled,
    // As a percentage, because that is how somebody thinks about health. The
    // file keeps a fraction, so the whole client holds one representation.
    hangUpBelow: String(Math.round(entry.hangUp.belowHealth * 100)),
    hangUpPenalties: entry.hangUp.penalties,
    hangUpOnPlayer: entry.hangUp.onPlayerInRoom,
    pvpNotifyGang: entry.pvp.notifyGang,
    pvpAction: entry.pvp.action,
    combat: entry.combat.enabled,
    combatAttack: entry.combat.attack,
    combatOpener: entry.combat.opener,
    combatHideForOpener: entry.combat.hideForOpener,
    combatEngage: entry.combat.engage,
    combatRetaliate: entry.combat.retaliate,
    combatDefendAfterRounds: String(entry.combat.defendAfterRounds),
    combatPoliteAttacks: entry.combat.politeAttacks,
    combatMaxMobs: String(entry.combat.maxMobs),
    partyAssist: entry.party.assistLeader,
    partyDefend: entry.party.defendParty,
    partyRest: entry.party.restWithLeader,
    partyAutoRank: entry.party.autoRank,
    partyPreferredRank: entry.party.preferredRank,
    partyAskHeal: percent(entry.party.askForHealBelow),
    partyWaitBelow: percent(entry.party.waitForMembersBelow),
    partyWaitMinutes: String(entry.party.waitNoLongerMinutes),
    partyIgnoreWait: entry.party.ignoreWaitWhenLeading,
    partyIgnoreParty: entry.party.ignorePartyWhenFollowing,
    partyRequestHealth: entry.party.requestPartyHealth,
    partyParEvery: String(entry.party.parEverySeconds),
    partyParAfterRound: entry.party.parAfterRound,
    // A percentage on screen and a fraction in the file, like every other
    // threshold here: one representation on disk, the one people think in on
    // the form.
    combatRefresh: String(entry.combat.refreshRounds),
    combatMonsters: entry.combat.monsters.map((row) => ({ ...row })),
    combatMaxTargetHealth: String(entry.combat.maxTargetHealth),
    combatMinMobs: String(entry.combat.minMobs),
    combatMaxMonsterExp: String(entry.combat.maxMonsterExperience),
    combatMinSurvival: percent(entry.combat.minSurvival),
    restBelow: percent(entry.health.restBelow),
    restTo: percent(entry.health.restTo),
    restBeforeTraps: percent(entry.health.restBeforeTraps),
    meditateBelow: percent(entry.health.meditateBelow),
    meditateTo: percent(entry.health.meditateTo),
    restNextDoor: entry.health.restNextDoor,
    potionRules: entry.health.potions.map((rule) => ({ ...rule })),
    useWards: entry.health.useWards,
    spellAttack: entry.spells.attack,
    spellAutoChoose: entry.spells.autoChoose,
    spellAutoChooseHeal: entry.spells.autoChooseHeal,
    spellAreaAttack: entry.spells.areaAttack,
    spellAreaMinMobs: String(entry.spells.areaMinMobs),
    spellAreaMinMana: percent(entry.spells.areaMinMana),
    spellAttackFallback: entry.spells.attackFallback,
    spellAttackCasts: String(entry.spells.attackCasts),
    spellAreaCasts: String(entry.spells.areaCasts),
    spellDrain: entry.spells.drain,
    spellAreaDrain: entry.spells.areaDrain,
    spellDrainBelow: percent(entry.spells.drainBelow),
    spellDrainTo: percent(entry.spells.drainTo),
    spellHeal: entry.spells.heal,
    spellHealPartyWith: entry.spells.healPartyWith,
    spellHealBelow: percent(entry.spells.healBelow),
    spellHealBelowInCombat: percent(entry.spells.healBelowInCombat),
    spellHealTo: percent(entry.spells.healTo),
    spellHealParty: entry.spells.healParty,
    spellMinMana: percent(entry.spells.minMana),
    spellCures: { ...entry.spells.cures },
    spellRegen: { ...entry.spells.regen },
    spellBlessings: entry.spells.blessings.map((blessing) => ({ ...blessing })),
    spellNotifyWearOff: entry.spells.notifyPartyOnWearOff,
    spellAutoBless: entry.spells.autoBless,
    spellInvokeItems: entry.spells.invokeItems,
    openDoors: entry.movement.openDoors,
    openTries: String(entry.movement.openTries),
    pickLocks: entry.movement.pickLocks,
    pickTries: String(entry.movement.pickTries),
    bashDoors: entry.movement.bashDoors,
    bashTries: String(entry.movement.bashTries),
    sneak: entry.movement.sneak,
    provideLight: entry.movement.provideLight,
    recoverGear: entry.movement.recoverGear,
    recoverGearTries: String(entry.movement.recoverGearTries),
    recoverGearFloor: String(entry.movement.recoverGearFloor),
    lightDimRooms: entry.movement.lightDimRooms,
    extinguishInLight: entry.movement.extinguishInLight,
    walkWhileBlind: entry.movement.walkWhileBlind,
    walkWhilePoisoned: entry.movement.walkWhilePoisoned,
    walkWhileConfused: entry.movement.walkWhileConfused,
    walkWhileLosingHp: entry.movement.walkWhileLosingHp,
    fightOnArrival: entry.movement.fightOnArrival,
    keepOutOf: [...entry.movement.keepOutOf],
    collectKeys: entry.movement.collectKeys,
    huntAuto: entry.hunting.enabled,
    huntRadius: entry.hunting.radius > 0 ? String(entry.hunting.radius) : '',
    trainStats: entry.train.stats,
    trainLevels: entry.train.levels,
    trainTrainer: entry.train.trainer > 0 ? String(entry.train.trainer) : '',
    trainWanted: wantedStrings(entry.train.wanted),
    questsEnabled: entry.quests.enabled,
    gearEnabled: entry.gear.enabled,
    gearSets: entry.gear.sets.map((set) => ({ ...set, wear: [...set.wear] })),
    gearOffRoundItem: entry.gear.offRound.item,
    gearOffRoundEvery:
      entry.gear.offRound.everyRounds > 0 ? String(entry.gear.offRound.everyRounds) : '',
    loot: structuredClone(entry.loot),
    drop: structuredClone(entry.drop),
    search: { ...entry.search },
    banking: { ...entry.banking },
    // This character's *own* loops. What it inherits is shown beside them and
    // is not editable from here -- see `LoopSection`.
    loops: entry.loops,
    alertRules: entry.alerts.rules.map((rule) => ({ ...rule })),
    afkEnabled: entry.afk.enabled,
    afkAfterMinutes: String(entry.afk.afterMinutes),
    afkReply: entry.afk.reply,
    answerRemotes: entry.remotes.enabled,
    remoteGangpath: entry.remotes.gangpath,
    remoteAutoJoin: entry.remotes.autoJoin,
    remoteGang: [...entry.remotes.gang],
    remoteParty: [...entry.remotes.party],
    remotePlayers: entry.remotes.players,
    remoteCommands: entry.remotes.commands,
    lookAtPlayers: entry.talk.lookAtPlayers,
    statlineControl: entry.statline.control,
    rewrites: entry.rewrites
  };
}

/**
 * Whether two forms say the same thing.
 *
 * Serialised rather than compared field by field, and that is not laziness:
 * this shape is forty fields of strings, booleans and lists that grows every
 * time the screen learns a setting, and a hand-written comparison would go
 * stale silently — the symptom being an undo step that does nothing, or a save
 * that never fires for one field. The values are all JSON-shaped by
 * construction, because they came out of form controls.
 */
function sameForm(a: CharacterForm, b: CharacterForm): boolean {
  return sameJson(a, b);
}

/** The same test for the server and client forms, which are plain drafts. */
function sameJson<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Puts a loop on a form, or takes it off — matched by name.
 *
 * By name because that is how a loop is addressed everywhere else: the palette
 * starts one by name and `loopNamed` finds it by name, so two called the same
 * thing are already one to everything that runs them. One helper for all three
 * forms that hold loops, so a fix to the matching has one place to land.
 */
function withLoopToggled<T extends { loops: Loop[] }>(
  current: History<T> | null,
  loop: Loop,
  same: (a: T, b: T) => boolean
): History<T> | null {
  if (current === null) return current;
  const has = current.present.loops.some((entry) => entry.name === loop.name);
  return record(
    current,
    {
      ...current.present,
      loops: has
        ? current.present.loops.filter((entry) => entry.name !== loop.name)
        : [...current.present.loops, loop]
    },
    same
  );
}

/**
 * The form as the file wants it.
 *
 * Lifted out of the submit handler because there are two callers now: the
 * button that creates a character, and the save that happens on its own while
 * one is edited. Two copies of this translation would be two places for a field
 * to be forgotten, and the symptom of forgetting one is a setting that saves
 * from one route and not the other.
 */
function draftOf(form: CharacterForm): ProfileDraft {
  return {
    name: form.name,
    server:
      form.serverName !== null
        ? { kind: 'saved', name: form.serverName }
        : {
            kind: 'inline',
            host: form.host,
            port: Number.parseInt(form.port, 10),
            encoding: form.encoding
          },
    username: form.username,
    password: form.password,
    changePassword: form.changePassword,
    autoConnect: form.autoConnect,
    autoReconnect: form.autoReconnect,
    accent: form.accent,
    theme: form.theme,
    login: form.login,
    retreat: {
      enabled: form.retreat,
      belowHealth: (Number.parseInt(form.retreatBelow, 10) || 0) / 100,
      belowMana: (Number.parseInt(form.retreatBelowMana, 10) || 0) / 100,
      whenOutnumbered: Number.parseInt(form.retreatOutnumbered, 10) || 0,
      strategy: RETREAT_STRATEGIES.includes(form.retreatStrategy as RetreatStrategy)
        ? (form.retreatStrategy as RetreatStrategy)
        : 'step-back',
      safeHavenRoom: form.retreatHaven.trim()
    },
    fleeGoto: {
      enabled: form.fleeGoto,
      belowHealth: (Number.parseInt(form.fleeGotoBelow, 10) || 0) / 100,
      destination: form.fleeGotoDestination.trim()
    },
    combat: {
      enabled: form.combat,
      attack: form.combatAttack,
      opener: form.combatOpener,
      hideForOpener: form.combatHideForOpener,
      engage: form.combatEngage,
      retaliate: form.combatRetaliate,
      defendAfterRounds: Number.parseInt(form.combatDefendAfterRounds, 10) || 0,
      politeAttacks: form.combatPoliteAttacks,
      maxMobs: Number.parseInt(form.combatMaxMobs, 10) || 0,
      refreshRounds: Number.parseInt(form.combatRefresh, 10) || 0,
      monsters: form.combatMonsters,
      maxTargetHealth: Math.max(0, Number.parseInt(form.combatMaxTargetHealth, 10) || 0),
      minMobs: Math.max(0, Number.parseInt(form.combatMinMobs, 10) || 0),
      maxMonsterExperience: Math.max(0, Number.parseInt(form.combatMaxMonsterExp, 10) || 0),
      minSurvival: fractionOf(form.combatMinSurvival)
    },
    hangUp: {
      enabled: form.hangUp,
      belowHealth: (Number.parseInt(form.hangUpBelow, 10) || 0) / 100,
      penalties: form.hangUpPenalties,
      onPlayerInRoom: form.hangUpOnPlayer
    },
    pvp: { notifyGang: form.pvpNotifyGang, action: form.pvpAction },
    party: {
      assistLeader: form.partyAssist,
      defendParty: form.partyDefend,
      restWithLeader: form.partyRest,
      autoRank: form.partyAutoRank,
      preferredRank: form.partyPreferredRank,
      askForHealBelow: fractionOf(form.partyAskHeal),
      waitForMembersBelow: fractionOf(form.partyWaitBelow),
      waitNoLongerMinutes: Number.parseInt(form.partyWaitMinutes, 10) || 0,
      ignoreWaitWhenLeading: form.partyIgnoreWait,
      ignorePartyWhenFollowing: form.partyIgnoreParty,
      requestPartyHealth: form.partyRequestHealth,
      parEverySeconds: Number.parseInt(form.partyParEvery, 10) || 0,
      parAfterRound: form.partyParAfterRound
    },
    health: {
      restBelow: fractionOf(form.restBelow),
      restTo: fractionOf(form.restTo),
      restBeforeTraps: fractionOf(form.restBeforeTraps),
      meditateBelow: fractionOf(form.meditateBelow),
      meditateTo: fractionOf(form.meditateTo),
      restNextDoor: form.restNextDoor,
      // Kept whole, and a nameless row is dropped by `normalizePotionRules` the
      // way a nameless blessing is: a rule naming nothing fires on nothing.
      potions: form.potionRules.map((rule) => ({ ...rule, name: rule.name.trim() })),
      useWards: form.useWards
    },
    spells: {
      attack: form.spellAttack.trim(),
      autoChoose: form.spellAutoChoose,
      autoChooseHeal: form.spellAutoChooseHeal,
      areaAttack: form.spellAreaAttack.trim(),
      areaMinMobs: Math.max(1, Number.parseInt(form.spellAreaMinMobs, 10) || 3),
      areaMinMana: fractionOf(form.spellAreaMinMana),
      attackFallback: form.spellAttackFallback.trim(),
      attackCasts: Math.max(0, Number.parseInt(form.spellAttackCasts, 10) || 0),
      areaCasts: Math.max(0, Number.parseInt(form.spellAreaCasts, 10) || 0),
      drain: form.spellDrain.trim(),
      areaDrain: form.spellAreaDrain.trim(),
      drainBelow: fractionOf(form.spellDrainBelow),
      drainTo: fractionOf(form.spellDrainTo),
      heal: form.spellHeal.trim(),
      healPartyWith: form.spellHealPartyWith.trim(),
      healBelow: fractionOf(form.spellHealBelow),
      healBelowInCombat: fractionOf(form.spellHealBelowInCombat),
      healTo: fractionOf(form.spellHealTo),
      healParty: form.spellHealParty,
      minMana: fractionOf(form.spellMinMana),
      cures: {
        blindness: form.spellCures.blindness.trim(),
        poison: form.spellCures.poison.trim(),
        disease: form.spellCures.disease.trim(),
        freedom: form.spellCures.freedom.trim()
      },
      regen: {
        ...form.spellRegen,
        hp: form.spellRegen.hp.trim(),
        mana: form.spellRegen.mana.trim(),
        hpFull: form.spellRegen.hpFull.trim(),
        manaFull: form.spellRegen.manaFull.trim()
      },
      blessings: form.spellBlessings.map((blessing) => ({
        ...blessing,
        spell: blessing.spell.trim()
      })),
      notifyPartyOnWearOff: form.spellNotifyWearOff,
      autoBless: form.spellAutoBless,
      invokeItems: form.spellInvokeItems
    },
    movement: {
      openDoors: form.openDoors,
      openTries: Number.parseInt(form.openTries, 10) || 0,
      pickLocks: form.pickLocks,
      pickTries: Number.parseInt(form.pickTries, 10) || 0,
      bashDoors: form.bashDoors,
      bashTries: Number.parseInt(form.bashTries, 10) || 0,
      sneak: form.sneak,
      provideLight: form.provideLight,
      recoverGear: form.recoverGear,
      recoverGearTries: Number.parseInt(form.recoverGearTries, 10) || 0,
      recoverGearFloor: Number.parseInt(form.recoverGearFloor, 10) || 0,
      lightDimRooms: form.lightDimRooms,
      extinguishInLight: form.extinguishInLight,
      walkWhileBlind: form.walkWhileBlind,
      walkWhilePoisoned: form.walkWhilePoisoned,
      walkWhileConfused: form.walkWhileConfused,
      walkWhileLosingHp: form.walkWhileLosingHp,
      fightOnArrival: form.fightOnArrival,
      keepOutOf: form.keepOutOf,
      collectKeys: form.collectKeys
    },
    hunting: {
      enabled: form.huntAuto,
      // Blank and 0 are the same answer — *everywhere the exits reach* — which
      // is what the field's own hint says.
      radius: Number.parseInt(form.huntRadius, 10) || 0
    },
    train: {
      stats: form.trainStats,
      wanted: wantedNumbers(form.trainWanted),
      levels: form.trainLevels,
      // 0 is *the cheapest that will take me*, which is what the picker's
      // first entry means and what an unset field says.
      trainer: Number.parseInt(form.trainTrainer, 10) || 0
    },
    quests: { enabled: form.questsEnabled },
    gear: {
      enabled: form.gearEnabled,
      // Rows are kept as typed and dropped at the boundary, so a set being
      // written does not vanish from under the caret on the next save.
      sets: form.gearSets.map((set) => ({
        ...set,
        name: set.name.trim(),
        mob: set.mob.trim(),
        wear: set.wear.map((item) => item.trim()).filter((item) => item.length > 0)
      })),
      offRound: {
        item: form.gearOffRoundItem.trim(),
        everyRounds: Number.parseInt(form.gearOffRoundEvery, 10) || 0
      }
    },
    loot: form.loot,
    drop: form.drop,
    search: form.search,
    banking: form.banking,
    loops: form.loops,
    alerts: {
      // Whole, with the name trimmed as `normalizeAlertRules` trims it: a row
      // naming nothing is inert rather than firing on everything.
      rules: form.alertRules.map((rule) => ({ ...rule, name: rule.name.trim() }))
    },
    afk: {
      enabled: form.afkEnabled,
      afterMinutes: Math.max(1, Number.parseInt(form.afkAfterMinutes, 10) || 5),
      reply: form.afkReply.trim()
    },
    remotes: {
      enabled: form.answerRemotes,
      gangpath: form.remoteGangpath,
      autoJoin: form.remoteAutoJoin,
      gang: form.remoteGang,
      party: form.remoteParty,
      players: form.remotePlayers,
      // Rows not yet saying what is asked or sent are not written.
      commands: form.remoteCommands.filter((c) => c.word.trim() !== '' && c.send.trim() !== '')
    },
    talk: { lookAtPlayers: form.lookAtPlayers },
    statline: { control: form.statlineControl },
    rewrites: form.rewrites
  };
}

/**
 * A new character that starts where an existing one does.
 *
 * Making the second character on a realm otherwise means retyping a server, a
 * login script, four combat verbs and every threshold — all of which the first
 * one already states, and all of which somebody typed once and can get subtly
 * wrong the second time.
 *
 * Three things it does **not** carry, and each is the point rather than a
 * limitation:
 *
 * - **The identity.** The file name and the display name are what make it a
 *   different character; two characters under one name is not what anybody
 *   means by "copy", and the id names the session, the log and the tab.
 * - **The password.** It cannot: the screen was never told it. The username is
 *   carried because a second character is usually on the same account, and
 *   the form says the password still has to be typed — there is no shared
 *   account to name instead, so it has to be retyped by hand.
 * - **Anything afterwards.** This is a starting point, not a link. A change to
 *   the character it was copied from does not follow, which is the same thing
 *   `overlay` means everywhere else: what a file states, it states.
 */
function copyOf(entry: ProfileEditable): CharacterForm {
  return {
    ...formOf(entry),
    id: '',
    name: '',
    /*
     * Never on by default, whatever the source said. A character that dialled
     * on the next launch because the one it was copied from does is a
     * connection nobody asked for — and on this realm a connection is not free.
     */
    autoConnect: false,
    password: '',
    changePassword: true
  };
}

/**
 * A fraction on disk, a percentage on screen.
 *
 * One representation in the file, the one people think in on the form — the
 * same split every other threshold here uses, and the reason the file keeps
 * fractions at all: a threshold means the same thing at every level only if it
 * is a fraction of maximum.
 */
/**
 * A realm that does not exist yet, started from the Global defaults.
 *
 * Same rule as `emptyForm`: the second realm on one BBS is otherwise the same
 * port, the same encoding and the same five menus typed a second time, and
 * every one of them can be got subtly wrong. The copy is taken here and
 * written into the realm's own file, so changing the defaults afterwards
 * changes what the *next* realm starts with.
 *
 * The host and the name are not carried, and that is the point rather than an
 * omission: they are what make it a different realm.
 */
/** This form keeps every field as the string in its box, so the percent is one too. */
const percent = (fraction: number): string => String(percentOf(fraction));

/** A three-way answer as the select spells it: blank leaves it to the scope above. */
function penaltiesChoice(value: boolean | null): string {
  return value === null ? '' : value ? 'yes' : 'no';
}

function penaltiesOf(choice: string): boolean | null {
  return choice === 'yes' ? true : choice === 'no' ? false : null;
}

function emptyServerForm(defaults: GlobalDraft | null): ServerDraft {
  return {
    name: '',
    host: '',
    port: defaults?.connection.port || 23,
    encoding: defaults?.connection.encoding ?? 'cp437',
    login: (defaults?.connection.login.steps ?? []).map((step) => ({ ...step })),
    // `rm`, the same reason `database` and `mobPriority` below carry nothing
    // from Global: which word this BBS answers to is a fact about that one
    // place, and a realm just being created has not said which it is yet.
    locate: 'rm',
    loops: [],
    // Empty is the world the client ships, which is right for a new realm until
    // somebody says otherwise. There is no Global default to copy: a map is a
    // fact about one place, so there is no sensible "next realm" value for it.
    database: '',
    hangPenalties: null,
    // The stock names until somebody says this realm renames one.
    coins: {},
    // MegaMUD's defaults until somebody says this realm differs.
    bbs: {}
  };
}

/**
 * A character that does not exist yet, started from the Global defaults.
 *
 * "Global" is exactly that and nothing else: a set of starting values for the
 * next realm and the next character. A new character takes a **copy** of them
 * here and states them in its own file, so from that moment it owns them —
 * changing a default afterwards is a change to what the *next* character
 * starts with, not a change that reaches back into the ones already made.
 *
 * `DEFAULT_CONFIG` is the fallback rather than the source, for the case where
 * the screen is drawing a form before the snapshot has arrived. The two agree
 * whenever the options file has not been edited, which is what makes falling
 * back to it safe.
 *
 * `loops` is the one field that starts **empty** whatever the defaults say, and
 * the difference is load-bearing: a character's loops are the files in its own
 * `loops/` directory rather than a list, and a character with none walks
 * everything its realm and the global directory lend it. Copying them in would
 * duplicate files rather than settings.
 */
function emptyForm(
  servers: SettingsSnapshot['servers'],
  defaults: GlobalDraft | null
): CharacterForm {
  const combat = defaults?.automation.combat ?? DEFAULT_COMBAT;
  const health = defaults?.automation.health ?? DEFAULT_HEALTH;
  const party = defaults?.automation.party ?? DEFAULT_CONFIG.automation.party;
  const movement = defaults?.automation.movement ?? DEFAULT_MOVEMENT;
  const hunting = defaults?.automation.hunting ?? DEFAULT_CONFIG.automation.hunting;
  const train = defaults?.automation.train ?? DEFAULT_CONFIG.automation.train;
  const quests = defaults?.automation.quests ?? DEFAULT_CONFIG.automation.quests;
  const gear = defaults?.automation.gear ?? DEFAULT_CONFIG.automation.gear;
  const spells = defaults?.automation.spells ?? DEFAULT_SPELLS;
  const alerts = defaults?.ui.alerts ?? DEFAULT_ALERTS;
  const remotes = defaults?.automation.remotes ?? DEFAULT_CONFIG.automation.remotes;
  const afk = defaults?.automation.afk ?? DEFAULT_CONFIG.automation.afk;
  const talk = defaults?.automation.talk ?? DEFAULT_CONFIG.automation.talk;
  const statline = defaults?.automation.statline ?? DEFAULT_CONFIG.automation.statline;
  const rewrites = defaults?.ui.rewrites ?? DEFAULT_CONFIG.ui.rewrites;
  const retreat = defaults?.automation.retreat ?? DEFAULT_CONFIG.automation.safety.retreat;
  const fleeGoto = defaults?.automation.fleeGoto ?? DEFAULT_CONFIG.automation.safety.fleeGoto;
  const hangUp = defaults?.automation.hangUp ?? DEFAULT_CONFIG.automation.safety.hangUp;
  const pvp = defaults?.automation.pvp ?? DEFAULT_CONFIG.automation.safety.pvp;
  const loot = defaults?.automation.loot ?? DEFAULT_CONFIG.automation.loot;
  const drop = defaults?.automation.drop ?? DEFAULT_CONFIG.automation.drop;
  const search = defaults?.automation.search ?? DEFAULT_CONFIG.automation.search;
  const banking = defaults?.automation.banking ?? DEFAULT_CONFIG.automation.banking;

  return {
    id: '',
    name: '',
    accent: 'cyan',
    theme: '',
    /*
     * Never on, whatever the default says. A character that dialled on the next
     * launch because of a setting somebody made for a different one is a
     * connection nobody asked for, and on this realm a connection is not free.
     */
    autoConnect: false,
    /*
     * On, unlike the line above it. Dialling a character nobody asked to dial
     * is a connection they did not choose; putting back one the network took
     * away is the connection they did — and on this realm a character left
     * standing while its client sits at a closed socket is one being killed.
     */
    autoReconnect: true,
    /*
     * The realm the client ships as its default, by name — and the first realm
     * on disk only if that one is not there.
     *
     * It used to be `servers[0]` outright, which made the default whichever
     * realm's *directory* sorted first: a choice nobody had stated, that moved
     * when a realm was added, and that could only be changed by renaming a
     * directory. `DEFAULT_REALM_NAME` states it in one place instead, beside
     * the `server:` line in `profile.default.yaml` that says the same thing to
     * anybody writing a character by hand.
     */
    serverName:
      servers.find((entry) => entry.name.toLowerCase() === DEFAULT_REALM_NAME.toLowerCase())
        ?.name ??
      servers[0]?.name ??
      null,
    host: '',
    port: '23',
    encoding: 'cp437',
    username: '',
    password: '',
    changePassword: true,
    login: [],
    retreat: retreat.enabled,
    retreatBelow: percent(retreat.belowHealth),
    retreatBelowMana: percent(retreat.belowMana),
    retreatOutnumbered: String(retreat.whenOutnumbered),
    retreatStrategy: retreat.strategy,
    retreatHaven: retreat.safeHavenRoom,
    fleeGoto: fleeGoto.enabled,
    fleeGotoBelow: percent(fleeGoto.belowHealth),
    fleeGotoDestination: fleeGoto.destination,
    hangUp: hangUp.enabled,
    hangUpBelow: percent(hangUp.belowHealth),
    // Not the options file's answer copied down: a copy would outrank the
    // realm's own, and whether a realm charges is a fact about the realm.
    hangUpPenalties: null,
    hangUpOnPlayer: hangUp.onPlayerInRoom,
    pvpNotifyGang: pvp.notifyGang,
    pvpAction: pvp.action,
    combat: combat.enabled,
    combatAttack: combat.attack,
    combatOpener: combat.opener,
    combatHideForOpener: combat.hideForOpener,
    combatEngage: combat.engage,
    combatRetaliate: combat.retaliate,
    combatDefendAfterRounds: String(combat.defendAfterRounds),
    combatPoliteAttacks: combat.politeAttacks,
    combatMaxMobs: String(combat.maxMobs),
    partyAssist: party.assistLeader,
    partyDefend: party.defendParty,
    partyRest: party.restWithLeader,
    partyAutoRank: party.autoRank,
    partyPreferredRank: party.preferredRank,
    partyAskHeal: percent(party.askForHealBelow),
    partyWaitBelow: percent(party.waitForMembersBelow),
    partyWaitMinutes: String(party.waitNoLongerMinutes),
    partyIgnoreWait: party.ignoreWaitWhenLeading,
    partyIgnoreParty: party.ignorePartyWhenFollowing,
    partyRequestHealth: party.requestPartyHealth,
    partyParEvery: String(party.parEverySeconds),
    partyParAfterRound: party.parAfterRound,
    combatRefresh: String(combat.refreshRounds),
    combatMonsters: combat.monsters.map((row) => ({ ...row })),
    combatMaxTargetHealth: String(combat.maxTargetHealth),
    combatMinMobs: String(combat.minMobs),
    combatMaxMonsterExp: String(combat.maxMonsterExperience),
    combatMinSurvival: percent(combat.minSurvival),
    restBelow: percent(health.restBelow),
    restTo: percent(health.restTo),
    restBeforeTraps: percent(health.restBeforeTraps),
    meditateBelow: percent(health.meditateBelow),
    meditateTo: percent(health.meditateTo),
    restNextDoor: health.restNextDoor,
    potionRules: health.potions.map((rule) => ({ ...rule })),
    useWards: health.useWards,
    spellAttack: spells.attack,
    spellAutoChoose: spells.autoChoose,
    spellAutoChooseHeal: spells.autoChooseHeal,
    spellAreaAttack: spells.areaAttack,
    spellAreaMinMobs: String(spells.areaMinMobs),
    spellAreaMinMana: percent(spells.areaMinMana),
    spellAttackFallback: spells.attackFallback,
    spellAttackCasts: String(spells.attackCasts),
    spellAreaCasts: String(spells.areaCasts),
    spellDrain: spells.drain,
    spellAreaDrain: spells.areaDrain,
    spellDrainBelow: percent(spells.drainBelow),
    spellDrainTo: percent(spells.drainTo),
    spellHeal: spells.heal,
    spellHealPartyWith: spells.healPartyWith,
    spellHealBelow: percent(spells.healBelow),
    spellHealBelowInCombat: percent(spells.healBelowInCombat),
    spellHealTo: percent(spells.healTo),
    spellHealParty: spells.healParty,
    spellMinMana: percent(spells.minMana),
    spellCures: { ...spells.cures },
    spellRegen: { ...spells.regen },
    spellBlessings: spells.blessings.map((blessing) => ({ ...blessing })),
    spellNotifyWearOff: spells.notifyPartyOnWearOff,
    spellAutoBless: spells.autoBless,
    spellInvokeItems: spells.invokeItems,
    openDoors: movement.openDoors,
    openTries: String(movement.openTries),
    pickLocks: movement.pickLocks,
    pickTries: String(movement.pickTries),
    bashDoors: movement.bashDoors,
    bashTries: String(movement.bashTries),
    sneak: movement.sneak,
    provideLight: movement.provideLight,
    recoverGear: movement.recoverGear,
    recoverGearTries: String(movement.recoverGearTries),
    recoverGearFloor: String(movement.recoverGearFloor),
    lightDimRooms: movement.lightDimRooms,
    extinguishInLight: movement.extinguishInLight,
    walkWhileBlind: movement.walkWhileBlind,
    walkWhilePoisoned: movement.walkWhilePoisoned,
    walkWhileConfused: movement.walkWhileConfused,
    walkWhileLosingHp: movement.walkWhileLosingHp,
    fightOnArrival: movement.fightOnArrival,
    keepOutOf: [...movement.keepOutOf],
    collectKeys: movement.collectKeys,
    huntAuto: hunting.enabled,
    huntRadius: hunting.radius > 0 ? String(hunting.radius) : '',
    trainStats: train.stats,
    trainLevels: train.levels,
    trainTrainer: train.trainer > 0 ? String(train.trainer) : '',
    trainWanted: wantedStrings(train.wanted),
    questsEnabled: quests.enabled,
    gearEnabled: gear.enabled,
    gearSets: gear.sets.map((set) => ({ ...set, wear: [...set.wear] })),
    gearOffRoundItem: gear.offRound.item,
    gearOffRoundEvery: gear.offRound.everyRounds > 0 ? String(gear.offRound.everyRounds) : '',
    loot: structuredClone(loot),
    drop: structuredClone(drop),
    search: { ...search },
    banking: { ...banking },
    loops: [],
    alertRules: (alerts.rules ?? []).map((rule) => ({ ...rule })),
    afkEnabled: afk.enabled,
    afkAfterMinutes: String(afk.afterMinutes),
    afkReply: afk.reply,
    answerRemotes: remotes.enabled,
    remoteGangpath: remotes.gangpath,
    remoteAutoJoin: remotes.autoJoin,
    remoteGang: [...remotes.gang],
    remoteParty: [...remotes.party],
    remotePlayers: remotes.players,
    remoteCommands: remotes.commands,
    lookAtPlayers: talk.lookAtPlayers,
    statlineControl: statline.control,
    rewrites
  };
}

/**
 * Creating and editing characters and servers, without opening a text editor.
 *
 * The command strip was removed because a host and a port describe a
 * *character* and not the client, and that information moved into
 * `profiles/*.yaml` — which is fine for somebody who edits YAML and is not fine
 * as the only way in. This is the way in.
 *
 * Deliberately **not** an editor for the whole options file. A profile is a
 * sparse overlay that may carry `automation:` and `ui:` blocks, and YAML is
 * genuinely good at those: they are lists of rules with comments explaining
 * why. What YAML is bad at is a password, a port and a menu answer, and that is
 * what this covers. The screen says where the files are so the rest stays one
 * click away.
 *
 * ## Two rules, and both have been broken here before
 *
 * **A section exists when there is a typed config block behind it, and not
 * because the nouns sort cleanly.** That is why there was no Combat section for
 * four phases: attack *rules* are `automation.rules`, and a form field for one
 * is a second representation of something the YAML already states precisely,
 * with its own comments explaining why.
 *
 * The sections are now **MegaMUD's own tabs** — Combat, Health, Spells,
 * Movement — and that is a change to the *labels*, not to the test. Each one
 * has a typed block behind it that a rule could not hold:
 *
 * - `automation.combat` — the question in the middle of it, *is the thing in
 *   front of me going to attack me, and is it a person*, is not one a guard
 *   expression can ask.
 * - `automation.health` — resting is not a condition, it is a *state the
 *   character is in* that the status line reports, that blocks nothing, and
 *   that moving or attacking ends by itself.
 * - `automation.spells` — one cast, at the mid-round tick, which is the one
 *   thing about a spell a rule genuinely cannot express: ~100 ms after the last
 *   swing, inside the round rather than after it.
 * - `automation.movement` — what a route may do on the way, which belongs to
 *   the walker's state machine rather than to a condition over character state.
 *
 * Everything else a caster or a healer wants — buffs, heals, when to loot, when
 * to give up — is still `automation.rules`, and the Spells section says so in
 * one line rather than not existing.
 *
 * **And a control is a label, a value and at most one sentence.** See
 * docs/terminology.md, which exists because this screen grew into a help
 * system one true paragraph at a time. The explanation moved to
 * `default.yaml`, where somebody editing YAML is actually asking for it; what
 * is left here is `Hint` — a mark that opens one sentence on hover, on focus
 * and on click. Two things stay in the open, both because they can cost a
 * character: opening fights unasked, and hanging up.
 *
 * A dialog that takes typed input, so it honours the focus policy: it holds the
 * caret while open and hands it back to the terminal on any exit.
 */
/** A `BBS.INI` key's label. */
function bbsLabel(key: BbsKey): string {
  switch (key) {
    case 'MenuPrompt':
      return t('settings.realms.bbs.MenuPrompt');
    case 'LogoffCmd':
      return t('settings.realms.bbs.LogoffCmd');
    case 'RelogCmd':
      return t('settings.realms.bbs.RelogCmd');
    case 'AnsiCmd':
      return t('settings.realms.bbs.AnsiCmd');
    case 'SpeechPrefix':
      return t('settings.realms.bbs.SpeechPrefix');
    case 'BroadcastPrefix':
      return t('settings.realms.bbs.BroadcastPrefix');
    case 'LogonMsg':
      return t('settings.realms.bbs.LogonMsg');
    case 'LogoffMsg':
      return t('settings.realms.bbs.LogoffMsg');
    case 'ShutDownMsg':
      return t('settings.realms.bbs.ShutDownMsg');
    case 'BroadcastMsg':
      return t('settings.realms.bbs.BroadcastMsg');
    case 'Global1Msg':
      return t('settings.realms.bbs.Global1Msg');
    case 'Global1Two':
      return t('settings.realms.bbs.Global1Two');
    case 'Global2Msg':
      return t('settings.realms.bbs.Global2Msg');
    case 'Global2Two':
      return t('settings.realms.bbs.Global2Two');
    case 'Global3Msg':
      return t('settings.realms.bbs.Global3Msg');
    case 'Global3Two':
      return t('settings.realms.bbs.Global3Two');
    case 'MaxInputSize':
      return t('settings.realms.bbs.MaxInputSize');
    case 'PvpLevel':
      return t('settings.realms.bbs.PvpLevel');
    case 'MaxHrsPerDay':
      return t('settings.realms.bbs.MaxHrsPerDay');
  }
}

export default function SettingsScreen({
  open,
  openAt = null,
  maximaFor,
  figuresFor,
  palette,
  required = false,
  onClose,
  load,
  saveProfile,
  deleteProfile,
  megamudSettings,
  saveMegamud,
  saveServer,
  deleteServer,
  saveGlobal,
  revealConfig,
  revealProfiles,
  chooseRealm,
  loadMessages,
  importMessages,
  saveMessages,
  loadMonsters,
  importMonsters,
  saveMonsters,
  loadItems,
  importItems,
  saveItems,
  loadSpellLore,
  saveSpellLore,
  importLoops,
  loadLoops,
  loadTrainers,
  loadBanks,
  loadServing,
  loadWards,
  loadMobNames
}: SettingsScreenProps) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  /**
   * Which of the four pages is showing.
   *
   * `client` is MudEngine and `defaults` is Global: two views of one file, so
   * they share a draft, a form and a save. See `GlobalSettings`.
   */
  const [tab, setTab] = useState<GlobalTab | 'characters' | 'servers'>('characters');
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * The character form, and every step back from it.
   *
   * A `History` rather than a bare value because the Save button is gone: what
   * somebody typed is saved on its own, so the way back has to be a control
   * rather than "close without saving". `form` is the present; `loadForm`
   * starts a fresh history (opening a character is not something to undo into)
   * and `edit` records a step.
   */
  const [history, setHistory] = useState<History<CharacterForm> | null>(null);
  const form = history?.present ?? null;
  /**
   * Which part of a character's own form is showing.
   *
   * The character form outgrew one scroll: a name and a server share nothing
   * with a hang-up threshold, and finding either meant scrolling past fields
   * that were not it. Split along what the fields actually are — identity and
   * connection, the login menus, auto-combat and the two safety nets — rather
   * than inventing sections for settings this screen does not hold. Attack
   * *rules* and spells stay in `automation.rules`, on purpose: see the class
   * comment above for the test a section has to pass.
   */
  const [section, setSection] = useState<Section>('profile');
  /*
   * The chosen character's MegaMUD settings, for its MegaMUD tabs: loaded with
   * the character, edited beside the rest of the page and saved as they are
   * changed, as it is (`useMegaMudDraft`). None for a character not yet made.
   */
  const megaStore = useMemo(
    () => ({ load: megamudSettings, save: saveMegamud }),
    [megamudSettings, saveMegamud]
  );
  const mega = useMegaMudDraft(
    selected === null || selected === NEW_CHARACTER ? null : selected,
    megaStore
  );
  /**
   * Whether the shelf of shipped loops is open, and what is on it.
   *
   * The catalogue is read once per visit to this screen and kept: it is four
   * hundred loops out of a file inside the application, so it cannot change
   * while the screen is open, and re-asking on every keystroke in the search
   * field would be a query per character typed.
   */
  /**
   * Which character a new one is being started from, if any.
   *
   * Held rather than left as a write-once select, so the control keeps saying
   * what it did. A select that snapped back to "start empty" the moment it was
   * used would read as one that had not worked.
   */
  const [copyFrom, setCopyFrom] = useState('');
  /** A new character's MegaMUD settings read from a MegaMUD file, written when it is created. */
  const [iniMega, setIniMega] = useState<MegaSettings | null>(null);
  useEffect(() => setIniMega(null), [selected]);
  const [picking, setPicking] = useState(false);
  const [catalogue, setCatalogue] = useState<Loop[] | null>(null);
  const [serverPick, setServerPick] = useState<string | null>(null);
  /** Which part of a realm's form is showing. See `realmSections`. */
  const [realmSection, setRealmSection] = useState<RealmSection>('realm');
  /** The server form, with the same way back the character form has. */
  const [serverHistory, setServerHistory] = useState<History<ServerDraft> | null>(null);
  const serverForm = serverHistory?.present ?? null;
  /**
   * The options file, as a form holds it.
   *
   * Kept beside the character and server forms rather than inside
   * `GlobalSettings`, so a refused save can put the error where the other two
   * put theirs and a reload after saving can hand back what is now on disk.
   */
  const [globalHistory, setGlobalHistory] = useState<History<GlobalDraft> | null>(null);
  const globalForm = globalHistory?.present ?? null;
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  /* Where the player dragged it, and the two gestures that move it. */
  const panel = useSettingsPanel();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  /**
   * Puts a form on screen without making it a step.
   *
   * Opening a character, starting a blank one, copying from one: none of those
   * is an edit, and a history that recorded them would let an undo pull another
   * character's fields onto the screen under this one's name.
   */
  const loadForm = useCallback((value: CharacterForm | null): void => {
    setHistory(value === null ? null : begin(value));
  }, []);

  /*
   * The same pair for the other two forms. `set*` records a step, `load*`
   * starts a fresh history -- and every call site below reads as it did, which
   * is the point: what changed is what the setter *means*, not who calls it.
   */
  const setServerForm = useCallback((next: ServerDraft): void => {
    setServerHistory((current) => (current ? record(current, next, sameJson) : begin(next)));
    setSaved(null);
  }, []);

  const loadServerForm = useCallback((value: ServerDraft | null): void => {
    setServerHistory(value === null ? null : begin(value));
  }, []);

  const setGlobalForm = useCallback((next: GlobalDraft): void => {
    setGlobalHistory((current) => (current ? record(current, next, sameJson) : begin(next)));
    setSaved(null);
  }, []);

  const loadGlobalForm = useCallback((value: GlobalDraft | null): void => {
    setGlobalHistory(value === null ? null : begin(value));
  }, []);

  const refresh = useCallback(async (): Promise<SettingsSnapshot> => {
    const next = await load();
    setSnapshot(next);
    return next;
  }, [load]);

  /*
   * Runs when the dialog *opens*, and only then.
   *
   * Keyed on `open` alone. It used to depend on `refresh`, which depends on the
   * `load` prop — and a caller passing an inline arrow makes that a new function
   * every render, so this ran on every render and cleared the message it had
   * just been given. A refused save flashed and vanished, which reads exactly
   * like a save that silently did nothing.
   */
  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setSaved(null);
    setConfirming(null);
    const opened = refresh().then((next) => {
      /*
       * Asked for by name — a tab's own menu, or the `+` beside the tabs.
       *
       * The form is set here rather than left to the effect below, which stands
       * down while one is already loaded. Arriving from a tab menu with the
       * previous character's fields still in state would put that character's
       * username and server under this one's heading, and the first thing
       * anybody would do is save it.
       */
      // Every branch below lands on a character's Profile section, if it
      // lands on a character at all -- the last section viewed belongs to the
      // character it was viewed on, not to whichever one opens next.
      setSection('profile');

      /*
       * The client's own settings, which are neither a character nor a server.
       * Loaded here rather than left to an effect, for the reason above: what
       * is on the form has to be what the heading says it is.
       */
      if (openAt === SETTINGS_GLOBAL || openAt === SETTINGS_DEFAULTS) {
        setTab(openAt === SETTINGS_GLOBAL ? 'client' : 'defaults');
        loadGlobalForm(next.global);
        return;
      }

      // A realm, not a character: the realms page has no id space to search, so
      // it is checked by its own sentinel rather than falling through to the
      // character lookup below.
      if (openAt === SETTINGS_MANAGE_SERVERS) {
        setTab('servers');
        setServerPick(next.servers[0]?.name ?? NEW_SERVER);
        loadServerForm(
          next.servers[0]
            ? { ...next.servers[0], loops: next.loops.servers[next.servers[0].name] ?? [] }
            : emptyServerForm(next.global)
        );
        return;
      }

      if (openAt === NEW_CHARACTER) {
        setTab('characters');
        setSelected(NEW_CHARACTER);
        setCopyFrom('');
        loadForm(emptyForm(next.servers, next.global));
        return;
      }
      const asked = openAt === null ? undefined : next.characters.find((e) => e.id === openAt);
      if (asked) {
        setTab('characters');
        setSelected(asked.id);
        loadForm(formOf(asked));
        return;
      }

      /*
       * Open on something.
       *
       * A settings screen that opens to an empty pane is a dead end — there is
       * nothing to read and nowhere for the caret to go, which also means the
       * dialog holds no focus and the focus policy has nothing to hand back.
       * The first character is the useful default; with none, the new-character
       * form is.
       *
       * This is also where a character asked for by name but *deleted* between
       * the click and the open lands: opening normally beats opening a blank
       * form wearing a name that no longer exists.
       */
      setSelected((current) => current ?? next.characters[0]?.id ?? NEW_CHARACTER);
    });
    // A failed load lands in the slot every other refusal uses, rather than
    // leaving the dialog on its loading state with nothing to read.
    void opened.catch((error) => setProblem(errorMessage(error)));
  }, [open, openAt]);

  // Follows `selected` once the snapshot has arrived, including the automatic
  // choice above.
  useEffect(() => {
    if (!open || selected === null || form !== null) return;
    if (selected === NEW_CHARACTER) {
      return loadForm(emptyForm(snapshot?.servers ?? [], snapshot?.global ?? null));
    }
    const found = snapshot?.characters.find((entry) => entry.id === selected);
    if (found) loadForm(formOf(found));
  }, [open, selected, form, snapshot]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open, selected, tab]);

  // Follows the snapshot the same way the character form does, and stands down
  // once a form is loaded so it cannot discard what somebody is typing.
  useEffect(() => {
    if (!open || !showsGlobal(tab) || globalForm !== null || snapshot === null) return;
    loadGlobalForm(snapshot.global);
  }, [open, tab, globalForm, snapshot, loadGlobalForm]);

  const characters = snapshot?.characters ?? [];
  const servers = useMemo(() => snapshot?.servers ?? [], [snapshot]);
  /** The loops each server lends its characters, keyed by the name they use. */
  const serverLoops = useMemo(() => snapshot?.loops.servers ?? {}, [snapshot]);
  /**
   * What the character on screen walks without asking: its server's loops, then
   * the global ones.
   *
   * Off the character rather than off the snapshot, because it depends on which
   * server this one plays on — and shown rather than edited here, since scope
   * is the directory a loop file sits in and a tick box on a character's page
   * cannot move one.
   */
  const inheritedLoops = useMemo<ScopedLoop[]>(
    () =>
      selected === null || selected === NEW_CHARACTER
        ? (snapshot?.loops.global.map((loop) => ({ loop, scope: 'global' as const })) ?? [])
        : (snapshot?.characters.find((entry) => entry.id === selected)?.inherited ?? []),
    [snapshot, selected]
  );

  /*
   * Saving, without anybody having to say so.
   *
   * The Save button was the last thing on this screen that could be forgotten,
   * and forgetting it is silent: the form goes on showing what was typed, so a
   * change somebody meant to make and one they made look identical until the
   * next launch.
   *
   * **Only while editing something that already exists.** Creating still takes
   * a press, and that is not a compromise: a half-typed name is a *different*
   * file, so an auto-saved new character would write `profiles/f/`,
   * `profiles/fr/`, `profiles/fre/` -- a directory per keystroke, none of them
   * what anybody meant.
   */
  const editingCharacter = selected !== null && selected !== NEW_CHARACTER;
  const characterSave = useAutoSave<CharacterForm>({
    value: form,
    identity: selected,
    enabled: open && tab === 'characters' && editingCharacter,
    same: sameForm,
    save: async (value) => {
      const refusal = await saveProfile(selected ?? '', draftOf(value));
      // Only on success: a refused save leaves the list describing what is
      // still on disk, which is the truth.
      if (refusal === null) await refresh();
      return refusal;
    }
  });

  const editingServer = serverPick !== null && serverPick !== NEW_SERVER;
  const serverSave = useAutoSave<ServerDraft>({
    value: serverForm,
    identity: serverPick,
    enabled: open && tab === 'servers' && editingServer,
    same: sameJson,
    save: async (value) => {
      const refusal = await saveServer(serverPick, value);
      if (refusal !== null) return refusal;
      /*
       * The selection follows the name as it is typed.
       *
       * `saveServer` matches on the *previous* name to find the directory, and
       * without this the second keystroke of a rename would look up a name
       * that no longer exists on disk and make a second server beside the
       * first -- one per keystroke, which is the same failure creating has.
       *
       * Only while that realm is still the one on screen. `chooseServer`
       * flushes this save on its way to another realm, and the answer lands
       * after the switch; following the name then would drag the selection
       * back to the realm somebody just left.
       */
      setServerPick((current) => (current === serverPick ? value.name : current));
      await refresh();
      return null;
    }
  });

  const globalSave = useAutoSave<GlobalDraft>({
    value: globalForm,
    // There is exactly one options file, so the identity never changes.
    identity: 'global',
    // Always, once it is loaded: there is exactly one options file and it
    // always exists, so there is no creating case to keep out of.
    enabled: open && showsGlobal(tab) && globalForm !== null,
    same: sameJson,
    save: async (value) => {
      const refusal = await saveGlobal(value);
      if (refusal === null) await refresh();
      return refusal;
    }
  });

  /** Opening a character loads its fields; opening "new" starts an empty one. */
  const choose = useCallback(
    (id: string | null) => {
      /*
       * Whatever is still waiting out the debounce is this character's, and
       * the switch below would otherwise discard it: the timer is cleared
       * when the identity changes, and an edit younger than the delay was
       * silently lost, exactly as it would have been saved. Before
       * `setSelected`, so the save still knows whose file it is.
       */
      characterSave.flush();
      mega.save.flush();
      setSelected(id);
      setProblem(null);
      setSaved(null);
      setConfirming(null);
      // Every character opens on Profile. Landing wherever the last one was
      // left would show, say, the hang-up threshold under a name that has
      // nothing to do with it -- the same trap `openAt` exists to avoid one
      // level up.
      setSection('profile');
      // Putting the shelf away with the character it was opened over: a picker
      // still showing when a different name arrives is a picker whose "added"
      // ticks describe somebody else.
      setPicking(false);
      setCopyFrom('');
      if (id === null) return loadForm(null);
      if (id === NEW_CHARACTER) return loadForm(emptyForm(servers, snapshot?.global ?? null));
      const found = characters.find((entry) => entry.id === id);
      loadForm(found ? formOf(found) : null);
    },
    [characters, servers, snapshot, characterSave.flush, mega.save.flush]
  );

  /**
   * Opens the shelf, reading the catalogue the first time it is asked for.
   *
   * Lazily and once. A settings visit is usually about a password, and four
   * hundred loops are not worth carrying across the boundary for one; a file
   * inside the application cannot change while the screen is open, so once is
   * also enough.
   */
  const openPicker = useCallback(() => {
    setPicking(true);
    if (catalogue !== null) return;
    void loadLoops().then(
      (loops) => setCatalogue(loops),
      // An empty shelf, said by the picker itself. A catalogue that could not be
      // read is not a reason to refuse the save the person came here to make.
      () => setCatalogue([])
    );
  }, [catalogue, loadLoops]);

  /** Puts a loop on this character, or takes it off — see `withLoopToggled`. */
  const toggleLoop = useCallback((loop: Loop) => {
    // An edit like any other, so it steps back like one.
    setHistory((current) => withLoopToggled(current, loop, sameForm));
    setSaved(null);
  }, []);

  /** And on the client's own page: the loops every character walks. */
  const toggleGlobalLoop = useCallback((loop: Loop) => {
    setGlobalHistory((current) => withLoopToggled(current, loop, sameJson));
    setSaved(null);
  }, []);

  /** The same gesture on a server's page: its loops, everyone who plays there. */
  const toggleServerLoop = useCallback((loop: Loop) => {
    setServerHistory((current) => withLoopToggled(current, loop, sameJson));
    setSaved(null);
  }, []);

  /**
   * A MegaMUD folder's loops were written beside this realm's: the page takes
   * up the list on disk as it takes up a realm it opens -- a fresh history,
   * not an edit, so Undo cannot take two hundred loops back off in one press.
   */
  const importedServerLoops = useCallback(async () => {
    const next = await refresh();
    const loops = serverPick === null ? undefined : next.loops.servers[serverPick];
    if (loops === undefined) return;
    setServerHistory((current) => (current ? begin({ ...current.present, loops }) : current));
  }, [refresh, serverPick]);

  const chooseServer = useCallback(
    (name: string | null) => {
      // The same as `choose`: the last second of typing goes to the realm it
      // was typed into, not into the bin.
      serverSave.flush();
      setServerPick(name);
      // A new realm starts where it is named and addressed.
      if (name === NEW_SERVER) setRealmSection('realm');
      setProblem(null);
      setSaved(null);
      setConfirming(null);
      // The shelf goes with the server it was opened over: a picker still
      // showing when a different name arrives is one whose ticks describe
      // somebody else.
      setPicking(false);
      if (name === null) return loadServerForm(null);
      if (name === NEW_SERVER) return loadServerForm(emptyServerForm(snapshot?.global ?? null));
      const found = servers.find((entry) => entry.name === name);
      // The loops come from the tree rather than from the realm entry: they
      // are files beside it, and the entry is only what its own file says.
      loadServerForm(found ? { ...found, loops: serverLoops[name] ?? [] } : null);
    },
    [servers, serverLoops, snapshot, serverSave.flush]
  );

  /**
   * Jump to the servers list from wherever the dialog currently is.
   *
   * Lands on the first server rather than an empty list: the same "open on
   * something" rule the character tab follows, and for the same reason -- a
   * pane with nothing selected holds no focusable field, which is a dead end
   * for a dialog that is supposed to hand the caret straight to a field. With
   * none at all it lands on the add-a-server form instead, which does.
   */
  const goToServers = useCallback(() => {
    setTab('servers');
    chooseServer(servers[0]?.name ?? NEW_SERVER);
  }, [servers, chooseServer]);

  /**
   * Open MudEngine or Global, both of which draw the options file.
   *
   * The form is loaded here rather than left to the effect that follows `tab`:
   * that effect stands down while one is already loaded, which is what keeps
   * it from discarding what somebody is typing — so arriving with a stale
   * draft would show the *previous* values under this heading, and the first
   * thing anybody would do is save them.
   */
  const openGlobal = useCallback(
    (which: GlobalTab) => {
      setTab(which);
      setProblem(null);
      setSaved(null);
      setPicking(false);
      if (snapshot !== null) loadGlobalForm(snapshot.global);
    },
    [snapshot, loadGlobalForm]
  );

  /** Whichever form is on screen: its way back, and how its saving is going. */
  /*
   * The Character page edits two files, the character's and its MegaMUD
   * settings, and has one Undo, one Redo and one save state for both: the
   * last change is undone wherever it was made (2026-10-14).
   */
  const characterUndo = useMergedHistory({
    character: {
      present: history?.present,
      can: {
        undo: history !== null && canUndo(history),
        redo: history !== null && canRedo(history)
      },
      undo: () => setHistory((current) => (current ? undo(current) : current)),
      redo: () => setHistory((current) => (current ? redo(current) : current))
    },
    megamud: { present: mega.draft, can: mega.can, undo: mega.undo, redo: mega.redo }
  });
  const characterPageSave = useMemo(
    () => mergedSave(characterSave, mega.save),
    [characterSave, mega.save]
  );

  const active = useMemo(() => {
    if (showsGlobal(tab)) {
      return {
        save: globalSave,
        can: {
          undo: globalHistory !== null && canUndo(globalHistory),
          redo: globalHistory !== null && canRedo(globalHistory)
        },
        undo: () => setGlobalHistory((current) => (current ? undo(current) : current)),
        redo: () => setGlobalHistory((current) => (current ? redo(current) : current))
      };
    }
    if (tab === 'servers') {
      return {
        save: serverSave,
        can: {
          undo: serverHistory !== null && canUndo(serverHistory),
          redo: serverHistory !== null && canRedo(serverHistory)
        },
        undo: () => setServerHistory((current) => (current ? undo(current) : current)),
        redo: () => setServerHistory((current) => (current ? redo(current) : current))
      };
    }
    return { save: characterPageSave, ...characterUndo };
  }, [tab, globalSave, serverSave, characterPageSave, characterUndo, globalHistory, serverHistory]);

  /**
   * Closing does not lose the last second of typing.
   *
   * The write is debounced, so there is always a moment where what is on screen
   * is newer than what is on disk — and closing the dialog is exactly when
   * somebody stops typing. Flushed rather than left to the timer, which is gone
   * the moment this unmounts.
   */
  const close = (): void => {
    // The one way out is making a character. Refused here rather than only at
    // each of the three doors, so a fourth added later cannot forget.
    if (required) return;
    active.save.flush();
    onClose();
  };

  /*
   * The monsters this character's realm names, for the priority list's picker.
   * Empty where no realm is loaded, which draws no suggestions and leaves the
   * field typable — the same rule the potion picker follows.
   */
  const [mobs, setMobs] = useState<string[]>([]);
  /*
   * And the monsters this character's realm table names (`monsters.yaml`,
   * imported from MegaMUD) — a table may name one the realm data spells
   * differently, or only part of a name, and a row about it is still one to
   * offer. Asked by the realm the form names, so a changed realm re-asks.
   */
  const [tabled, setTabled] = useState<string[]>([]);
  /*
   * The realm's ward rules (an item whose use casts the spell that stops a
   * room's effect), drawn under the switch that obeys them. Empty where no
   * realm is loaded, which draws no rows; the switch still says what it does.
   */
  const [wards, setWards] = useState<WardRule[]>([]);
  useEffect(() => {
    if (!open || tab !== 'characters' || section !== 'Health') return;
    if (selected === null || selected === NEW_CHARACTER) return;
    let stale = false;
    void loadWards(selected).then(
      (found) => void (stale || setWards(found)),
      // A realm that could not be read is not a reason to refuse the save.
      () => void (stale || setWards([]))
    );
    return () => {
      stale = true;
    };
  }, [open, tab, section, selected, loadWards]);
  const realmName = form?.serverName ?? null;
  useEffect(() => {
    if (!open || tab !== 'characters' || section !== 'Combat' || realmName === null) {
      setTabled([]);
      return;
    }
    let stale = false;
    void loadMonsters(realmName).then(
      (table) => void (stale || setTabled(table.monsters.map((row) => row.mob))),
      () => void (stale || setTabled([]))
    );
    return () => {
      stale = true;
    };
  }, [open, tab, section, realmName, loadMonsters]);
  /** Every monster name worth suggesting: the realm data's and its table's, once each. */
  const monsterNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of [...mobs, ...tabled]) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }, [mobs, tabled]);
  useEffect(() => {
    if (!open || tab !== 'characters' || section !== 'Combat') return;
    if (selected === null || selected === NEW_CHARACTER) return;
    let stale = false;
    void loadMobNames(selected).then(
      (found) => void (stale || setMobs(found)),
      // A realm that could not be read is not a reason to refuse the save:
      // the field simply offers nothing and stays typable.
      () => void (stale || setMobs([]))
    );
    return () => {
      stale = true;
    };
  }, [open, tab, section, selected, loadMobNames]);

  if (!open) return null;

  /*
   * What this character's thresholds are percentages of.
   *
   * `NEW_CHARACTER` has no session and therefore no maxima, which is right
   * rather than merely tolerated: a character that has never been in the realm
   * has no hit points to state, and `figureOf` draws that as nothing.
   */
  const maxima =
    selected !== null && selected !== NEW_CHARACTER
      ? maximaFor(selected)
      : { hpMax: null, manaMax: null };
  // And the whole of them, for the status line's preview; the designer draws a
  // sample for a character that is not in the realm.
  const figures = selected !== null && selected !== NEW_CHARACTER ? figuresFor(selected) : null;
  /*
   * A threshold field holds the percent as typed, so the figure is composed
   * from the string rather than from the stored fraction: what somebody wants
   * to see beside a half-typed `7` is what `7` would mean, not what the last
   * saved value meant.
   */
  const ofHealth = (typed: string): string | null =>
    figureOf(Number.parseInt(typed, 10) || 0, maxima.hpMax);
  /*
   * And the bar under it, on the **inherited** vitals bands.
   *
   * From the Global draft rather than from `DEFAULT_CONFIG`: the character page
   * has no vitals section, so what a character runs on is what the options file
   * says, and a player who moved caution to 70% must not be shown 60% in green
   * here and amber on their own HUD. Falls back to the shipped bands only while
   * the snapshot has not landed.
   */
  const bands = snapshot?.global.ui.vitals ?? DEFAULT_CONFIG.ui.vitals;
  const barOfHealth = (typed: string): ReturnType<typeof barOf> =>
    barOf(Number.parseInt(typed, 10) || 0, bands.hp);

  const patch = (change: Partial<CharacterForm>): void => {
    setHistory((current) =>
      current === null ? current : record(current, { ...current.present, ...change }, sameForm)
    );
    setSaved(null);
  };

  const submitCharacter = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!form) return;
    setProblem(null);
    setSaved(null);

    const id = (selected === NEW_CHARACTER ? form.id : selected) ?? '';
    const draft = draftOf(form);

    const error = await saveProfile(id, draft);
    if (error !== null) return setProblem(error);
    if (selected === NEW_CHARACTER && iniMega !== null) {
      const megaError = await saveMegamud(id, iniMega);
      if (megaError !== null) setProblem(megaError);
      setIniMega(null);
    }
    const next = await refresh();
    setSaved(t('settings.characters.saved', { characterName: form.name || id }));
    // A character just created is the one you want open.
    setSelected(id);
    const found = next.characters.find((entry) => entry.id === id);
    // What came back from disk, not a step: recording it would put a move in
    // the history that nobody made.
    if (found)
      setHistory((current) => (current ? replace(current, formOf(found)) : begin(formOf(found))));
  };

  const submitServer = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!serverForm) return;
    setProblem(null);
    setSaved(null);
    const previous = serverPick === NEW_SERVER ? null : serverPick;
    const error = await saveServer(previous, serverForm);
    if (error !== null) return setProblem(error);
    await refresh();
    setSaved(t('settings.realms.saved', { realmName: serverForm.name }));
    setServerPick(serverForm.name);
  };

  const submitGlobal = async (): Promise<void> => {
    if (!globalForm) return;
    setProblem(null);
    setSaved(null);
    const error = await saveGlobal(globalForm);
    if (error !== null) return setProblem(error);
    const next = await refresh();
    /*
     * What came back from disk, and not a step: the password fields are
     * cleared by the round trip, which is what stops a second save re-sending
     * one nobody retyped — but nothing here is a move somebody made, so the
     * way back is left as it was.
     */
    setGlobalHistory((current) => (current ? replace(current, next.global) : begin(next.global)));
    setSaved(t('settings.global.saved'));
  };

  const remove = async (): Promise<void> => {
    if (selected === null || selected === NEW_CHARACTER) return;
    const error = await deleteProfile(selected);
    if (error !== null) return setProblem(error);
    await refresh();
    choose(null);
    setSaved(t('settings.characters.removed'));
  };

  const removeServer = async (): Promise<void> => {
    if (serverPick === null || serverPick === NEW_SERVER) return;
    const error = await deleteServer(serverPick);
    if (error !== null) return setProblem(error);
    await refresh();
    chooseServer(null);
    setSaved(t('settings.realms.removed'));
  };

  return (
    /*
     * A layer over the workspace, not a modal over a scrim.
     *
     * The scrim took every click and the dialog took the whole window, so a
     * setting could not be changed and *watched*: whatever it does happens in
     * the console behind it, sometimes while a character is standing somewhere
     * being hit. The layer passes the pointer through to the console
     * (`pointer-events: none`, the panel itself takes them back), the panel is
     * moved by its heading and resized from its corner, and the two ways out
     * are the close glyph and Escape while it holds the caret.
     *
     * The one exception is the state with no characters at all: there is
     * nothing behind the screen to reach and nothing to type at, so it keeps
     * the scrim, keeps `aria-modal`, and keeps having no way out.
     */
    <div className="settings-layer" data-required={required ? 'true' : 'false'} role="presentation">
      <div
        aria-label={t('settings.dialog.ariaLabel')}
        aria-modal={required ? 'true' : undefined}
        className="surface settings"
        data-dragging={panel.dragging ? 'true' : 'false'}
        data-placed={!required && panel.placed ? 'true' : 'false'}
        style={required ? undefined : panel.style}
        onKeyDown={(event) => {
          /*
           * The dialog owns its own Escape.
           *
           * A window-level hotkey cannot serve this: `useHotkeys` listens in
           * capture and stands down for an unmodified key while the caret is in
           * a chrome text field — which is exactly the state this dialog is
           * normally in, because it is a form. A surface that holds the caret
           * owns its keys, and Escape most of all: this one holds the keyboard
           * while a character is standing somewhere.
           */
          /*
           * Undo and redo, on whichever chord the hands know.
           *
           * `Cmd Shift Z` is the macOS redo, `Ctrl Y` the Windows one, and
           * `Ctrl Shift Z` is understood everywhere — all three are accepted,
           * because somebody arriving from another application presses theirs
           * and a chord that silently does nothing reads as a feature that is
           * not there. It stands down while the caret is in a text field,
           * where `Ctrl Z` is the field's own undo and works a character at a
           * time; the buttons stay reachable there. See `historyIntent`.
           */
          const intent = historyIntent(event, targetOf(event.target));
          if (intent !== null) {
            event.preventDefault();
            if (intent === 'undo') active.undo();
            else active.redo();
            return;
          }

          if (event.key !== 'Escape') return;
          event.preventDefault();
          // One Escape, one step, innermost first, so the key never does
          // something bigger than expected. The loop shelf is not in this
          // list: it holds the caret while it is open and stops the event
          // before it reaches here, which is the same rule stated from the
          // other side — a bare key belongs to whatever holds the caret.
          if (confirming !== null) return setConfirming(null);
          close();
        }}
        role="dialog"
      >
        {/*
          The heading is the handle, as a card's is. `onPointerDown` and not a
          separate grip: the row is already the thing anybody grabs, and the
          controls in it (the four crumbs, the close glyph) stop the press
          themselves rather than the row testing what was under the pointer.
        */}
        <header
          className="settings-head"
          onDoubleClick={required ? undefined : panel.reset}
          onPointerDown={required ? undefined : panel.move}
        >
          {/*
            General to particular, left to right: the client, then what a new
            realm and a new character start from, then the realms, then the
            characters. Somebody arriving to change a password walks the whole
            row to get there, which is right -- the row is also the sentence
            that explains how the four relate.

            No separator between them. A pill already has an edge, and a glyph
            between two of them doubles the seam instead of marking it --
            CLAUDE.md, "A card's faces live in its heading". This heading is
            the same control as a card's faces and had kept its `›`.
          */}
          <h2>
            <button
              className="crumb"
              data-active={tab === 'client' ? 'true' : 'false'}
              onClick={() => openGlobal('client')}
              onMouseDown={keepFocus}
              onPointerDown={stopDrag}
              type="button"
            >
              {t('settings.crumbs.mudEngine')}
            </button>
            <button
              className="crumb"
              data-active={tab === 'defaults' ? 'true' : 'false'}
              onClick={() => openGlobal('defaults')}
              onMouseDown={keepFocus}
              onPointerDown={stopDrag}
              type="button"
            >
              {t('settings.crumbs.global')}
            </button>
            <button
              className="crumb"
              data-active={tab === 'servers' ? 'true' : 'false'}
              /*
               * `goToServers`, not `setTab`. There are two doors onto this list
               * -- this crumb and the palette's `Settings: add or edit a
               * realm...` -- and only one of them was landing on a realm. The
               * other showed "Choose a realm, or add one." over a list of one,
               * which is a dead screen with no focusable field in it.
               */
              onClick={goToServers}
              onMouseDown={keepFocus}
              onPointerDown={stopDrag}
              type="button"
            >
              {t('settings.crumbs.realms')}
            </button>
            <button
              className="crumb"
              data-active={tab === 'characters' ? 'true' : 'false'}
              onClick={() => setTab('characters')}
              onMouseDown={keepFocus}
              onPointerDown={stopDrag}
              type="button"
            >
              {t('settings.crumbs.characters')}
            </button>
          </h2>
          {/*
            Absent rather than disabled while there is no character: a greyed
            close is a control that says *later*, and there is no later here —
            the way out is the form beside it.
          */}
          {!required && (
            <button
              aria-label={t('settings.dialog.closeAria')}
              className="quiet"
              onClick={close}
              onPointerDown={stopDrag}
              type="button"
            >
              ✕
            </button>
          )}
        </header>

        {/*
          Said out loud, and standing rather than as a refusal that only appears
          when somebody presses Escape: the whole failure here was a screen that
          could be dismissed onto an empty window, so the sentence has to be
          readable *before* anybody tries the way out that is gone.
        */}
        {required && <p className="settings-warn">{t('settings.dialog.characterRequired')}</p>}

        <div className="settings-body" data-tab={tab}>
          {showsGlobal(tab) ? (
            globalForm === null ? (
              <div className="settings-form empty">{t('settings.global.loading')}</div>
            ) : (
              <GlobalSettings
                catalogue={catalogue}
                draft={globalForm}
                palette={palette}
                scope={tab}
                firstFieldRef={firstFieldRef}
                realmSpells={snapshot?.realmSpells ?? []}
                onChange={(next) => {
                  setGlobalForm(next);
                  setSaved(null);
                }}
                onDonePicking={() => setPicking(false)}
                onOpenPicker={openPicker}
                actions={
                  <FormActions
                    can={active.can}
                    error={active.save.error}
                    onRedo={active.redo}
                    onUndo={active.undo}
                    state={active.save.state}
                  />
                }
                onSubmit={() => void submitGlobal()}
                onToggleLoop={toggleGlobalLoop}
                picking={picking}
              />
            )
          ) : tab === 'characters' ? (
            <>
              {/*
                Which character, then which part of it, then the fields: the
                rail asks the two questions in the order they are answered, and
                the form keeps the whole of the other column (todo 02).
              */}
              <SettingsNav
                onSection={(id: string) => setSection(id)}
                picker={{
                  addId: NEW_CHARACTER,
                  addLabel: t('settings.characters.new'),
                  choices: characters.map((entry) => ({
                    id: entry.id,
                    name: entry.name,
                    detail: entry.error
                      ? t('settings.characters.cannotLoad')
                      : (entry.serverName ?? entry.target.host),
                    accent: entry.accent,
                    broken: entry.error !== undefined
                  })),
                  chosen: selected,
                  label: t('settings.nav.character'),
                  onChoose: (id: string) => choose(id)
                }}
                section={section}
                sections={SECTIONS.map((id) => ({
                  id,
                  label: sectionLabel(id),
                  fieldsets: SECTION_FIELDSETS[id] ?? []
                }))}
              />

              {form === null ? (
                <div className="settings-form empty">
                  {characters.length === 0
                    ? t('settings.characters.emptyNone')
                    : t('settings.characters.emptyChoose')}
                </div>
              ) : (
                <form
                  className="settings-form"
                  // Drawn as MegaMUD's pages are, on every row: Character and
                  // Login, which have no MegaMUD tab, kept the old look beside
                  // rows that had one (2026-10-14).
                  data-megamud="true"
                  data-section={section}
                  onSubmit={(event) => void submitCharacter(event)}
                >
                  {section === 'profile' && (
                    <>
                      {/*
                        Start from a character that already works.

                        The second character on a realm otherwise means
                        retyping a realm, a login script, four combat verbs
                        and every threshold — all of which the first one
                        already states, and all of which can be got subtly
                        wrong the second time. A select rather than a
                        duplicate-this-character button on each row, because
                        the question is asked while making one, and this is
                        where somebody already is.
                      */}
                      {selected === NEW_CHARACTER && characters.length > 0 && (
                        <SelectField
                          hint={t('settings.profile.copyFromHint')}
                          label={t('settings.profile.copyFromLabel')}
                          name="copy-from"
                          onChange={(value) => {
                            setCopyFrom(value);
                            setIniMega(null);
                            setProblem(null);
                            setSaved(null);
                            const found = characters.find((entry) => entry.id === value);
                            // Back to empty is a real answer, and it has to
                            // undo what choosing did or the control is
                            // one-way.
                            loadForm(
                              found ? copyOf(found) : emptyForm(servers, snapshot?.global ?? null)
                            );
                          }}
                          options={[
                            { value: '', label: t('settings.profile.copyFromNone') },
                            ...characters
                              .filter((entry) => entry.error === undefined)
                              .map((entry) => ({ value: entry.id, label: entry.name }))
                          ]}
                          value={copyFrom}
                        />
                      )}

                      {/*
                        A MegaMUD character's settings file: for a new
                        character its name and login as well, for one made
                        already its MegaMUD settings alone, undoable.
                      */}
                      {selected === NEW_CHARACTER ? (
                        <MegaMudIniImport
                          label={t('settings.megamud.importNew')}
                          onRead={(settings, fileName) => {
                            const who = characterOfIni(settings);
                            const base =
                              characters.find((entry) => entry.id === copyFrom) === undefined
                                ? emptyForm(servers, snapshot?.global ?? null)
                                : form;
                            const realm = servers.find(
                              (server) => server.name.toLowerCase() === who.bbs.toLowerCase()
                            );
                            loadForm({
                              ...base,
                              id: who.id,
                              name: who.name,
                              username: who.username,
                              password: who.password,
                              changePassword: true,
                              ...(realm === undefined ? {} : { serverName: realm.name })
                            });
                            setIniMega(settings);
                            setProblem(null);
                            setSaved(t('settings.megamud.importedNew', { fileName }));
                          }}
                        />
                      ) : (
                        mega.draft !== null && (
                          <MegaMudIniImport
                            label={t('settings.megamud.importOver')}
                            onRead={(settings, fileName) => {
                              // The login stays the character's: an empty password is "leave it".
                              const next = structuredClone(settings);
                              next.live['BBS']!['Password'] = '';
                              mega.update(() => next);
                              setProblem(null);
                              setSaved(t('settings.megamud.importedOver', { fileName }));
                            }}
                          />
                        )
                      )}

                      {selected === NEW_CHARACTER && (
                        // The id is the session id, the log name, the capture
                        // name and the key every remembered preference hangs
                        // off — so it is worth saying it is not the display
                        // name, once, where somebody is choosing it.
                        <TextField
                          hint={t('settings.profile.idHint')}
                          inputRef={firstFieldRef}
                          label={t('settings.profile.idLabel')}
                          name="id"
                          onChange={(value) => patch({ id: value })}
                          placeholder={t('settings.profile.idPlaceholder')}
                          spellCheck={false}
                          value={form.id}
                        />
                      )}

                      <TextField
                        inputRef={selected === NEW_CHARACTER ? undefined : firstFieldRef}
                        label={t('settings.realms.nameLabel')}
                        name="name"
                        onChange={(value) => patch({ name: value })}
                        placeholder={form.id || t('settings.profile.namePlaceholder')}
                        value={form.name}
                      />

                      <FormField label={t('settings.profile.realmLabel')} name="realm" wide>
                        {() => (
                          <div className="settings-file">
                            <select
                              onChange={(event) =>
                                patch({
                                  serverName: event.target.value === '' ? null : event.target.value
                                })
                              }
                              value={form.serverName ?? ''}
                            >
                              {servers.map((server) => (
                                <option key={server.name} value={server.name}>
                                  {server.name}
                                </option>
                              ))}
                              <option value="">{t('settings.profile.realmElsewhere')}</option>
                            </select>
                            {/*
                              The other way to a realm, beside the field that
                              names one -- not only from the command palette. A
                              realm edited here is one that every character
                              referring to it by name plays on next connection.
                            */}
                            <button
                              className="quiet"
                              onClick={goToServers}
                              onMouseDown={keepFocus}
                              type="button"
                            >
                              {t('settings.profile.manageRealms')}
                            </button>
                          </div>
                        )}
                      </FormField>

                      {form.serverName === null && (
                        <div className="settings-inline">
                          <TextField
                            label={t('settings.profile.hostLabel')}
                            name="host"
                            onChange={(value) => patch({ host: value })}
                            placeholder={t('settings.profile.hostPlaceholder')}
                            spellCheck={false}
                            value={form.host}
                          />
                          <NumberField
                            label={t('settings.profile.portLabel')}
                            name="port"
                            onChange={(value) => patch({ port: value })}
                            value={form.port}
                          />
                        </div>
                      )}

                      {/*
                        The encoding is the right answer already, and it is one
                        nobody can choose well without knowing what CP437 is --
                        so it sits behind a press rather than beside the
                        username on the form somebody opened to type a
                        password. Only for a character that spells its address
                        out: one playing on a saved realm takes the realm's.
                      */}
                      {form.serverName === null && (
                        <Advanced label={t('settings.advancedWire')}>
                          <SelectField
                            hint={t('settings.profile.encodingHint')}
                            label={t('settings.profile.encodingLabel')}
                            name="character-encoding"
                            onChange={(value) => patch({ encoding: value as StreamEncoding })}
                            options={ENCODINGS.map((encoding) => ({
                              value: encoding,
                              label: encoding
                            }))}
                            value={form.encoding}
                          />
                        </Advanced>
                      )}

                      <TextField
                        autoComplete="off"
                        label={t('settings.profile.usernameLabel')}
                        name="username"
                        onChange={(value) => patch({ username: value })}
                        spellCheck={false}
                        value={form.username}
                      />

                      {/* Never read back out of the file: a password that has
                          crossed to a window can end up in a devtools
                          snapshot, a crash report or a screenshot. */}
                      <PasswordField
                        hint={t('settings.profile.passwordHint')}
                        label={t('settings.profile.passwordLabel')}
                        name="password"
                        onChange={(value) => patch({ password: value, changePassword: true })}
                        placeholder={
                          form.changePassword
                            ? ''
                            : characters.find((entry) => entry.id === selected)?.hasPassword
                              ? t('settings.profile.passwordPlaceholderSet')
                              : t('settings.profile.passwordPlaceholderUnset')
                        }
                        value={form.password}
                      />

                      <CheckField
                        checked={form.autoConnect}
                        label={t('settings.profile.autoConnectLabel')}
                        name="auto-connect"
                        onChange={(value) => patch({ autoConnect: value })}
                      />

                      {/* The MegaMUD engine's own redials reconnect (MegaMUD
                          connection, below): there is no reconnect of ours. */}

                      <FormField label={t('settings.profile.accentLabel')} name="accent">
                        {() => (
                          <div className="settings-accents">
                            {PROFILE_ACCENTS.map((accent) => (
                              <button
                                aria-label={accent}
                                className="accent-swatch"
                                data-accent={accent}
                                data-active={form.accent === accent ? 'true' : 'false'}
                                key={accent}
                                onClick={() => patch({ accent })}
                                onMouseDown={keepFocus}
                                type="button"
                              />
                            ))}
                          </div>
                        )}
                      </FormField>

                      {/* Named for the page it is set on, not for the file
                          behind it: somebody who wants to change it needs to
                          know where to go, and "the options file" is a path
                          rather than a place in the client. */}
                      <SelectField
                        label={t('settings.profile.themeLabel')}
                        name="theme"
                        onChange={(value) =>
                          patch({ theme: isThemePreference(value) ? value : '' })
                        }
                        options={[
                          { value: '', label: t('settings.profile.themeInherit') },
                          { value: 'system', label: t('settings.profile.themeSystem') },
                          ...THEME_IDS.map((id) => ({ value: id, label: THEMES[id].label }))
                        ]}
                        value={form.theme}
                      />
                      <MegaMudAccount mega={mega} />
                    </>
                  )}

                  {section === 'login' && (
                    <fieldset className="settings-menus" data-fieldset="login">
                      <legend>{t('settings.login.legend')}</legend>
                      {/*
                        Empty is the ordinary case and says so, rather than
                        being an empty box somebody feels obliged to fill in.
                        The script belongs to the realm -- every character on
                        one meets the same menus -- and a character states its
                        own only to differ, which in practice means a different
                        character slot.
                      */}
                      <p className="settings-note">
                        {t('settings.login.note', {
                          realmOrAddress:
                            form.serverName === null
                              ? t('settings.login.noteFallbackAddress')
                              : form.serverName,
                          /*
                            The placeholders, passed as values so they survive.
                            This is the one login string whose call site has
                            params, and `makeT` interpolates every `{name}` in
                            a string it is given any -- so a literal `{user}`
                            written in the copy would be reported as a value
                            nobody supplied. A replacement is not re-scanned,
                            so handing them in prints them.
                          */
                          user: '{user}',
                          password: '{password}'
                        })}
                      </p>

                      {form.login.length > 0 && (
                        <ul className="settings-steps">
                          {form.login.map((step, index) => (
                            <li key={index}>
                              <input
                                aria-label={t('settings.login.stepWhenAria', {
                                  stepNumber: index + 1
                                })}
                                onChange={(event) =>
                                  patch({
                                    login: form.login.map((entry, at) =>
                                      at === index ? { ...entry, when: event.target.value } : entry
                                    )
                                  })
                                }
                                placeholder={t('settings.login.stepWhenPlaceholder')}
                                value={step.when}
                              />
                              <span aria-hidden="true" className="arrow">
                                →
                              </span>
                              <input
                                aria-label={t('settings.login.stepSendAria', {
                                  stepNumber: index + 1
                                })}
                                className="answer"
                                onChange={(event) =>
                                  patch({
                                    login: form.login.map((entry, at) =>
                                      at === index ? { ...entry, send: event.target.value } : entry
                                    )
                                  })
                                }
                                placeholder={t('settings.login.stepSendPlaceholder')}
                                value={step.send}
                              />
                              <input
                                aria-label={t('settings.login.stepRepeatAria', {
                                  stepNumber: index + 1
                                })}
                                checked={step.repeat ?? false}
                                className="repeat"
                                onChange={(event) =>
                                  patch({
                                    login: form.login.map((entry, at) =>
                                      at === index
                                        ? { ...entry, repeat: event.target.checked }
                                        : entry
                                    )
                                  })
                                }
                                title={t('settings.login.stepRepeatTitle')}
                                type="checkbox"
                              />
                              <button
                                aria-label={t('settings.login.removeStepAria', {
                                  stepNumber: index + 1
                                })}
                                className="quiet"
                                onClick={() =>
                                  patch({ login: form.login.filter((_, at) => at !== index) })
                                }
                                title={t('settings.login.removeStepTitle')}
                                type="button"
                              >
                                <Icon name="close" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/*
                        The first row on an empty list copies the realm's
                        script, then adds the blank one.

                        A character's list **replaces** the realm's, so adding
                        one row to change a character slot used to leave a
                        script of exactly that row -- and with the account now
                        two rows of the script rather than two fields beside
                        it, that silently took the login with it. Copying is
                        what the player meant: the realm's menus plus my one
                        change. The realm's own rows are the right source
                        rather than a guessed pair, since a realm that words
                        its username prompt differently says so there.
                      */}
                      <button
                        className="quiet add-step"
                        onClick={() =>
                          patch({
                            login: [
                              ...(form.login.length === 0
                                ? (servers.find((entry) => entry.name === form.serverName)?.login ??
                                  [])
                                : form.login),
                              { when: '', send: '' }
                            ]
                          })
                        }
                        type="button"
                      >
                        <Icon name="plus" />
                        <span>{t('settings.login.addStep')}</span>
                      </button>
                    </fieldset>
                  )}

                  {/*
  MegaMUD's own tab, as its settings dialog draws it, and under it what
  this client keeps for the character that belongs with it (2026-10-14).
*/}
                  {isMegaTab(section) && (
                    <MegaMudPanel
                      loops={[
                        ...(form?.loops ?? []),
                        ...inheritedLoops.map((entry) => entry.loop)
                      ].map((loop) => loop.name)}
                      mega={mega}
                      tab={section}
                    />
                  )}

                  {section === 'Auto-roam' && (
                    <>
                      <fieldset className="settings-menus" data-fieldset="movement-keep-out">
                        <legend>{t('settings.movement.keepOutLegend')}</legend>
                        <TextField
                          hint={t('settings.movement.keepOutOfHint')}
                          label={t('settings.movement.keepOutOf')}
                          name="keep-out-of"
                          onChange={(value) => patch({ keepOutOf: splitNames(value) })}
                          placeholder={t('settings.movement.keepOutOfPlaceholder')}
                          value={joinNames(form.keepOutOf)}
                          wide
                        />
                      </fieldset>

                      {/*
                        The loops this character owns, and the ones it merely
                        walks. A separate fieldset from the two switches above
                        rather than three more rows in one, because they answer
                        different questions: those are what a route may do on
                        the way, and this is where the character goes at all.
                      */}
                      <LoopSection
                        catalogue={catalogue}
                        inherited={inheritedLoops}
                        loops={form.loops}
                        note={t('settings.movement.loopsNote')}
                        onDonePicking={() => setPicking(false)}
                        onOpenPicker={openPicker}
                        onToggle={toggleLoop}
                        picking={picking}
                        /*
                          The one thing about this that can be wrong without
                          looking wrong. The shipped loops name rooms by
                          `map/room` in Paradigm's world, the one they were
                          recorded in; a realm pinned to the other bundled
                          world or to its own database has different rooms
                          behind the same numbers, and a route planned from
                          one goes somewhere nobody chose.
                        */
                        warning={
                          walksAnotherWorld(
                            servers.find((entry) => entry.name === form.serverName)?.database ?? ''
                          ) && form.loops.length > 0
                            ? t('settings.movement.loopsWarning')
                            : undefined
                        }
                      />

                      {/*
                        Where the character should be at all (todo 05), beside
                        the loops rather than under Training: what it decides
                        is a place, and the loop it runs when it gets there is
                        built from the survey rather than taken off the shelf
                        above.
                      */}
                      <fieldset className="settings-menus" data-fieldset="hunting">
                        <legend>{t('settings.hunting.legend')}</legend>
                        <p className="settings-note">{t('settings.hunting.note')}</p>
                        <div className="settings-inline">
                          <CheckField
                            checked={form.huntAuto}
                            hint={t('settings.hunting.autoHint')}
                            label={t('settings.hunting.auto')}
                            name="hunt-auto"
                            onChange={(value) => patch({ huntAuto: value })}
                          />
                          {form.huntAuto && (
                            <NumberField
                              hint={t('settings.hunting.radiusHint')}
                              label={t('settings.hunting.radius')}
                              name="hunt-radius"
                              onChange={(value) => patch({ huntRadius: value })}
                              value={form.huntRadius}
                            />
                          )}
                        </div>
                      </fieldset>

                      <fieldset className="settings-menus" data-fieldset="quests">
                        <legend>{t('settings.quests.legend')}</legend>
                        <p className="settings-warn">{t('settings.quests.warning')}</p>
                        <CheckField
                          checked={form.questsEnabled}
                          hint={t('settings.quests.enabledHint')}
                          label={t('settings.quests.enabled')}
                          name="quests-enabled"
                          onChange={(value) => patch({ questsEnabled: value })}
                        />
                      </fieldset>
                    </>
                  )}

                  {section === 'Talk' && (
                    <>
                      <fieldset className="settings-menus" data-fieldset="remotes">
                        <legend>{t('settings.remotes.legend')}</legend>
                        {/*
    Who may drive this character, and how far: the per-player grants the
    MegaMUD engine reads as each player's remote bits (`grantPlayers`).
    Whether remotes are answered at all is MegaMUD's own, on the Talk tab
    above; the gang and party lists were the old automation's (2026-10-14).
  */}
                        <p className="settings-warn">{t('settings.remotes.channelWarning')}</p>
                        <p className="settings-note">{t('settings.remotes.engineNote')}</p>
                        <PlayerGrants
                          grants={form.remotePlayers}
                          onChange={(players) => patch({ remotePlayers: players })}
                        />
                      </fieldset>
                      {/*
                        The player's own commands others may ask this
                        character for, answered after MegaMUD's own
                        (2026-10-15): a healer's @heal for whoever is named.
                      */}
                      <fieldset className="settings-menus" data-fieldset="bot-commands">
                        <legend>{t('settings.botCommands.legend')}</legend>
                        <p className="settings-note">{t('settings.botCommands.note')}</p>
                        <BotCommandList
                          commands={form.remoteCommands}
                          onChange={(remoteCommands) => patch({ remoteCommands })}
                        />
                      </fieldset>
                    </>
                  )}

                  {section === 'Statline' && (
                    <>
                      {/* The status line is MegaMUD's own StatLine command
                          above; how the client draws it is the designer's. */}
                      <RewritesDesigner
                        figures={figures}
                        idPrefix="rewrites"
                        onChange={(next) => patch({ rewrites: next })}
                        palette={palette}
                        value={form.rewrites}
                      />
                    </>
                  )}

                  {section === 'Sounds' && (
                    <>
                      <fieldset className="settings-menus" data-fieldset="alerts-rules">
                        {/*
                        The player's own rows first, because they decide before
                        the floor and the mute list below do — reading the
                        screen top to bottom should be reading the order the
                        client asks in (todo 29).
                      */}
                        <legend>{t('settings.alerts.ruleLegend')}</legend>
                        <p className="settings-note">{t('settings.alerts.ruleNote')}</p>
                        <AlertList
                          namePrefix="alert-rule"
                          onChange={(alertRules) => patch({ alertRules })}
                          rules={form.alertRules}
                        />
                      </fieldset>
                    </>
                  )}

                  {section === 'Other' && (
                    <>
                      <fieldset className="settings-menus" data-fieldset="movement-doors">
                        <legend>{t('settings.movement.doorsLegend')}</legend>
                        <div className="settings-inline">
                          <CheckField
                            checked={form.openDoors}
                            hint={t('settings.movement.openDoorsHint')}
                            label={t('settings.movement.openDoors')}
                            name="open-doors"
                            onChange={(value) => patch({ openDoors: value })}
                          />
                          {form.openDoors && (
                            <NumberField
                              label={t('settings.movement.openTries')}
                              name="open-tries"
                              onChange={(value) => patch({ openTries: value })}
                              value={form.openTries}
                            />
                          )}
                        </div>
                        {/*
                          Picking above bashing, in the order the walker tries
                          them — and for the reason it does: one costs a
                          command and the other costs a command and some
                          health.
                        */}
                        <div className="settings-inline">
                          <CheckField
                            checked={form.pickLocks}
                            hint={t('settings.movement.pickLocksHint')}
                            label={t('settings.movement.pickLocks')}
                            name="pick-locks"
                            onChange={(value) => patch({ pickLocks: value })}
                          />
                          {form.pickLocks && (
                            <NumberField
                              label={t('settings.movement.pickTries')}
                              name="pick-tries"
                              onChange={(value) => patch({ pickTries: value })}
                              value={form.pickTries}
                            />
                          )}
                        </div>
                        <div className="settings-inline">
                          <CheckField
                            checked={form.bashDoors}
                            hint={t('settings.movement.bashDoorsHint')}
                            label={t('settings.movement.bashDoors')}
                            name="bash-doors"
                            onChange={(value) => patch({ bashDoors: value })}
                          />
                          {form.bashDoors && (
                            <NumberField
                              label={t('settings.movement.bashTries')}
                              name="bash-tries"
                              onChange={(value) => patch({ bashTries: value })}
                              value={form.bashTries}
                            />
                          )}
                        </div>
                      </fieldset>
                    </>
                  )}

                  {section === 'Health' && (
                    <>
                      <fieldset className="settings-menus" data-fieldset="health-flee">
                        <legend>{t('settings.health.fleeLegend')}</legend>
                        <p className="settings-note">{t('settings.health.fleeHint')}</p>
                        <div className="settings-inline">
                          <CheckField
                            checked={form.fleeGoto}
                            label={t('settings.health.fleeLabel')}
                            name="flee-goto"
                            onChange={(value) => patch({ fleeGoto: value })}
                          />
                          {form.fleeGoto && (
                            <NumberField
                              label={t('settings.health.belowHealthLabel')}
                              name="flee-health"
                              bar={barOfHealth(form.fleeGotoBelow)}
                              figure={ofHealth(form.fleeGotoBelow)}
                              onChange={(value) => patch({ fleeGotoBelow: value })}
                              value={form.fleeGotoBelow}
                            />
                          )}
                        </div>
                        {form.fleeGoto && (
                          <TextField
                            hint={t('settings.health.fleeDestinationHint')}
                            label={t('settings.health.fleeDestinationLabel')}
                            name="flee-destination"
                            onChange={(value) => patch({ fleeGotoDestination: value })}
                            placeholder={t('settings.health.fleeDestinationPlaceholder')}
                            spellCheck={false}
                            value={form.fleeGotoDestination}
                            wide
                          />
                        )}
                      </fieldset>
                      {/*
                        Kept beside the MegaMUD engine: the use goes on its
                        pending list before the step into such a room
                        (2026-10-14).
                      */}
                      <fieldset className="settings-menus" data-fieldset="health-wards">
                        <legend>{t('settings.health.wardsLegend')}</legend>
                        <CheckField
                          checked={form.useWards}
                          hint={t('settings.health.useWardsHint')}
                          label={t('settings.health.useWards')}
                          name="use-wards"
                          onChange={(value) => patch({ useWards: value })}
                        />
                        <WardRules rules={wards} />
                      </fieldset>
                    </>
                  )}

                  {section === 'Combat' && (
                    <>
                      {/*
                            This character's own monster rows, laid over the
                            realm's table field by field -- a shaman's spell
                            for a monster the realm marks Flee keeps the Flee.
                            The one list about named monsters: what to leave
                            alone is a Friend, and the attack order is the
                            priority. Part of the form's draft, so it saves
                            with it.
                          */}
                      <fieldset className="settings-menus" data-fieldset="combat-monster-rows">
                        <legend>{t('settings.combat.monsterRowsLegend')}</legend>
                        <p className="settings-note">{t('settings.combat.monsterRowsNote')}</p>
                        <div className="realm-messages">
                          <MonsterRuleList
                            addLabel={t('settings.monsters.add')}
                            emptyText={t('settings.combat.monsterRowsNone')}
                            known={monsterNames}
                            namePrefix="character-monster"
                            onChange={(rows) => {
                              patch({ combatMonsters: rows });
                              return Promise.resolve(null);
                            }}
                            rows={form.combatMonsters}
                          />
                        </div>
                      </fieldset>
                    </>
                  )}

                  {section === 'Loot' && (
                    <>
                      <ItemDetailsFieldset
                        idPrefix=""
                        onChange={(itemDetails) => patch({ loot: { ...form.loot, itemDetails } })}
                        rows={form.loot.itemDetails}
                      />

                      <fieldset className="settings-menus" data-fieldset="movement-carry">
                        <legend>{t('settings.movement.carryLegend')}</legend>
                        <CheckField
                          checked={form.recoverGear}
                          hint={t('settings.movement.recoverGearHint')}
                          label={t('settings.movement.recoverGear')}
                          name="recover-gear"
                          onChange={(value) => patch({ recoverGear: value })}
                        />
                        {/*
                          The bounds, drawn only where the switch is on: two
                          numbers limiting a feature nobody has turned on are
                          two controls that do nothing (todo 21).
                        */}
                        {form.recoverGear && (
                          <div className="settings-inline">
                            <NumberField
                              hint={t('settings.movement.recoverGearFloorHint')}
                              label={t('settings.movement.recoverGearFloorLabel')}
                              name="recover-gear-floor"
                              onChange={(value) => patch({ recoverGearFloor: value })}
                              value={form.recoverGearFloor}
                            />
                            <NumberField
                              hint={t('settings.movement.recoverGearTriesHint')}
                              label={t('settings.movement.recoverGearTriesLabel')}
                              name="recover-gear-tries"
                              onChange={(value) => patch({ recoverGearTries: value })}
                              value={form.recoverGearTries}
                            />
                          </div>
                        )}
                        <CheckField
                          checked={form.collectKeys}
                          hint={t('settings.movement.collectKeysHint')}
                          label={t('settings.movement.collectKeys')}
                          name="collect-keys"
                          onChange={(value) => patch({ collectKeys: value })}
                        />
                      </fieldset>
                    </>
                  )}

                  <div className="settings-actions">
                    {/*
                      Creating still takes a press; editing does not.
                      A half-typed file name is a *different* character, so an
                      auto-saved new one would write a directory per keystroke.
                    */}
                    {selected === NEW_CHARACTER ? (
                      <button className="primary" type="submit">
                        {t('settings.actions.createCharacter')}
                      </button>
                    ) : (
                      <FormActions
                        can={active.can}
                        error={active.save.error}
                        onRedo={active.redo}
                        onUndo={active.undo}
                        state={active.save.state}
                      />
                    )}
                    {selected !== NEW_CHARACTER &&
                      (confirming === selected ? (
                        <>
                          <span className="hint">
                            {t('settings.actions.confirmRemoveCharacter')}
                          </span>
                          <button className="danger" onClick={() => void remove()} type="button">
                            {t('settings.actions.confirmYes')}
                          </button>
                          <button
                            className="quiet"
                            onClick={() => setConfirming(null)}
                            type="button"
                          >
                            {t('settings.actions.confirmKeep')}
                          </button>
                        </>
                      ) : (
                        /* Asked first, because this is a click that may destroy
                           the only record of a password. The file is backed up
                           beside itself either way. */
                        <button
                          className="quiet"
                          onClick={() => setConfirming(selected)}
                          type="button"
                        >
                          {t('settings.actions.remove')}
                        </button>
                      ))}
                  </div>
                </form>
              )}
            </>
          ) : (
            <>
              {/*
                The realm's sections, one shown at a time, as the Character
                page's are (2026-10-15): the form outgrew one scroll once its
                imported tables and the MegaMUD set-up joined it.
              */}
              <SettingsNav
                onSection={(id: string) => setRealmSection(id as RealmSection)}
                picker={{
                  addId: NEW_SERVER,
                  addLabel: t('settings.realms.new'),
                  choices: servers.map((server) => ({
                    id: server.name,
                    name: server.name,
                    detail: `${server.host}:${server.port}`
                  })),
                  chosen: serverPick,
                  label: t('settings.nav.realm'),
                  onChoose: (name: string) => chooseServer(name)
                }}
                section={realmSection}
                sections={realmSections()}
              />

              {serverForm === null ? (
                <div className="settings-form empty">{t('settings.realms.empty')}</div>
              ) : (
                <form
                  className="settings-form"
                  data-section="realm"
                  onSubmit={(event) => void submitServer(event)}
                >
                  {realmSection === 'realm' && (
                    <>
                      {/*
                    A realm form has no sections, so it states its subject
                    instead: it is the same thing the Global page's Realm
                    section edits, and it reads in the same hue.
                  */}
                      {/* What the realm is called and where it is: one row, since
                      neither half identifies it on its own. */}
                      <div className="settings-inline">
                        <TextField
                          hint={t('settings.realms.nameHint')}
                          inputRef={firstFieldRef}
                          label={t('settings.realms.nameLabel')}
                          name="server-name"
                          onChange={(value) => setServerForm({ ...serverForm, name: value })}
                          placeholder={t('settings.realms.namePlaceholder')}
                          value={serverForm.name}
                        />
                        <TextField
                          label={t('settings.profile.hostLabel')}
                          name="server-host"
                          onChange={(value) => setServerForm({ ...serverForm, host: value })}
                          placeholder={t('settings.profile.hostPlaceholder')}
                          spellCheck={false}
                          value={serverForm.host}
                        />
                        <NumberField
                          label={t('settings.profile.portLabel')}
                          name="server-port"
                          onChange={(value) =>
                            setServerForm({
                              ...serverForm,
                              port: Number.parseInt(value, 10) || 0
                            })
                          }
                          value={serverForm.port || ''}
                        />
                      </div>

                      {/*
                    The map every character here walks.

                    On the realm rather than on the character, for the same
                    reason the menu script below is: two characters on one realm
                    cannot be walking two different maps, and stated per
                    character it was the same answer written out once each with
                    as many places to drift -- a third character added later
                    silently got the shipped world instead.
                  */}
                      <FormField
                        hint={t('settings.worldDatabaseHint')}
                        label={t('settings.worldDatabaseLabel')}
                        name="server-database"
                        wide
                      >
                        {({ describedBy }) => (
                          <div className="settings-file">
                            <input
                              aria-describedby={describedBy}
                              onChange={(event) =>
                                setServerForm({ ...serverForm, database: event.target.value })
                              }
                              placeholder={t('settings.worldDatabasePlaceholder')}
                              spellCheck={false}
                              value={serverForm.database}
                            />
                            <button
                              className="quiet"
                              onClick={() => {
                                void chooseRealm().then((file) => {
                                  if (file !== null)
                                    setServerForm({ ...serverForm, database: file });
                                });
                              }}
                              onMouseDown={keepFocus}
                              type="button"
                            >
                              {t('settings.realms.databaseBrowse')}
                            </button>
                            {serverForm.database.length > 0 && (
                              <button
                                className="quiet"
                                onClick={() => setServerForm({ ...serverForm, database: '' })}
                                onMouseDown={keepFocus}
                                type="button"
                              >
                                {t('settings.realms.databaseClear')}
                              </button>
                            )}
                          </div>
                        )}
                      </FormField>

                      {/*
                    Behind a press, because it has a right answer already and
                    is not one anybody can choose well without knowing what
                    CP437 is. Not taste: the game lays out maps and stat
                    columns in character cells, and both reference realms open
                    with block glyphs that are invalid UTF-8.
                  */}
                      <Advanced label={t('settings.advancedWire')}>
                        <SelectField
                          hint={t('settings.profile.encodingHint')}
                          label={t('settings.profile.encodingLabel')}
                          name="encoding"
                          onChange={(value) =>
                            setServerForm({ ...serverForm, encoding: value as StreamEncoding })
                          }
                          options={ENCODINGS.map((encoding) => ({
                            value: encoding,
                            label: encoding
                          }))}
                          value={serverForm.encoding}
                        />
                      </Advanced>

                      {/*
                    How to get through this realm's menus.

                    On the realm rather than on the character, because that is
                    what it is a property of: every character on one realm
                    meets the same menus, and a script stored per character is
                    the same answer written out four times with four places to
                    drift. What is genuinely per character is the account, and
                    the character slot -- which a character overrides with its
                    own script when it needs to.

                    A list rather than named fields. The four this screen used
                    to show were *Paradigm's* menus; MajorMUD, GreaterMUD and a
                    WorldGroup front end all differ, and a client with four
                    slots cannot describe them at all.
                  */}
                      <fieldset className="settings-menus">
                        <legend>{t('settings.realms.loginLegend')}</legend>
                        <p className="settings-note">{t('settings.realms.loginNote')}</p>

                        {serverForm.login.length > 0 && (
                          <ul className="settings-steps">
                            {serverForm.login.map((step, index) => (
                              // Keyed by position, deliberately: rows are edited in
                              // place and identified by nothing else — two blank
                              // rows are genuinely the same until somebody types.
                              <li key={index}>
                                <input
                                  aria-label={t('settings.login.stepWhenAria', {
                                    stepNumber: index + 1
                                  })}
                                  onChange={(event) =>
                                    setServerForm({
                                      ...serverForm,
                                      login: serverForm.login.map((entry, at) =>
                                        at === index
                                          ? { ...entry, when: event.target.value }
                                          : entry
                                      )
                                    })
                                  }
                                  placeholder={t('settings.realms.stepWhenPlaceholder')}
                                  value={step.when}
                                />
                                <span aria-hidden="true" className="arrow">
                                  →
                                </span>
                                <input
                                  aria-label={t('settings.login.stepSendAria', {
                                    stepNumber: index + 1
                                  })}
                                  className="answer"
                                  onChange={(event) =>
                                    setServerForm({
                                      ...serverForm,
                                      login: serverForm.login.map((entry, at) =>
                                        at === index
                                          ? { ...entry, send: event.target.value }
                                          : entry
                                      )
                                    })
                                  }
                                  placeholder={t('settings.realms.stepSendPlaceholder')}
                                  value={step.send}
                                />
                                <input
                                  aria-label={t('settings.login.stepRepeatAria', {
                                    stepNumber: index + 1
                                  })}
                                  checked={step.repeat ?? false}
                                  className="repeat"
                                  onChange={(event) =>
                                    setServerForm({
                                      ...serverForm,
                                      login: serverForm.login.map((entry, at) =>
                                        at === index
                                          ? { ...entry, repeat: event.target.checked }
                                          : entry
                                      )
                                    })
                                  }
                                  title={t('settings.login.stepRepeatTitle')}
                                  type="checkbox"
                                />
                                <button
                                  aria-label={t('settings.login.removeStepAria', {
                                    stepNumber: index + 1
                                  })}
                                  className="quiet"
                                  onClick={() =>
                                    setServerForm({
                                      ...serverForm,
                                      login: serverForm.login.filter((_, at) => at !== index)
                                    })
                                  }
                                  title={t('settings.login.removeStepTitle')}
                                  type="button"
                                >
                                  <Icon name="close" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        <button
                          className="quiet add-step"
                          onClick={() =>
                            setServerForm({
                              ...serverForm,
                              login: [...serverForm.login, { when: '', send: '' }]
                            })
                          }
                          type="button"
                        >
                          <Icon name="plus" />
                          <span>{t('settings.login.addStep')}</span>
                        </button>
                      </fieldset>

                      {/*
                    Which word this realm answers exact coordinates with.

                    On the realm, for the same reason the menu script above is:
                    every character here is talking to the same dispatch table,
                    so every character gets the same answer. Not auto-detected
                    -- see `LocateMethod` -- because the one case this exists
                    for is a realm whose word is not `rm`, and trying `rm`
                    first is exactly the broadcast a player who already knows
                    that should never have to spend.
                  */}
                      <SelectField
                        hint={t('settings.realms.locateHint')}
                        label={t('settings.realms.locateLabel')}
                        name="locate"
                        onChange={(value) =>
                          setServerForm({ ...serverForm, locate: value as LocateMethod })
                        }
                        options={[
                          { value: 'rm', label: t('settings.realms.locateOptions.rm') },
                          {
                            value: 'sys-status',
                            label: t('settings.realms.locateOptions.sysStatus')
                          },
                          { value: 'none', label: t('settings.realms.locateOptions.none') }
                        ]}
                        value={serverForm.locate}
                      />
                    </>
                  )}

                  {realmSection === 'loops' && (
                    <>
                      {/*
                    The loops that belong to the *place*.

                    A loop names rooms in a realm, so it is a fact about where
                    you are playing rather than about who is walking it — and
                    one recorded here is worth having on every character that
                    plays here, rather than pasted into each of their files and
                    then kept in step by hand.
                  */}
                      <LoopSection
                        catalogue={catalogue}
                        loops={serverForm.loops}
                        note={t('settings.realms.loopsNote')}
                        onDonePicking={() => setPicking(false)}
                        onOpenPicker={openPicker}
                        onToggle={toggleServerLoop}
                        picking={picking}
                      >
                        <MegaMudLoopImport
                          beforeImport={serverSave.flush}
                          importLoops={importLoops}
                          onImported={() => void importedServerLoops()}
                          realm={serverPick === NEW_SERVER ? null : serverPick}
                        />
                      </LoopSection>
                    </>
                  )}

                  {realmSection === 'messages' && (
                    <>
                      {/*
                    And what the place's sentences mean: a realm's message
                    table, imported from MegaMUD. On the realm for the reason
                    the ranking above is -- every character here hears the
                    same sentences -- and saved on its own rather than with
                    this form, which saves as somebody types.
                  */}
                      <fieldset className="settings-menus" data-fieldset="realm-messages">
                        <legend>{t('settings.messages.legend')}</legend>
                        <p className="settings-note">{t('settings.messages.note')}</p>
                        <RealmMessages
                          importFile={importMessages}
                          load={loadMessages}
                          realm={serverPick === NEW_SERVER ? null : serverPick}
                          save={saveMessages}
                        />
                      </fieldset>
                    </>
                  )}

                  {realmSection === 'monsters' && (
                    <>
                      {/*
                    And what to do about particular monsters: the realm's
                    table from MegaMUD's Monsters.md. Each character's own
                    rows are laid over it, field by field.
                  */}
                      <fieldset className="settings-menus" data-fieldset="realm-monsters">
                        <legend>{t('settings.monsters.legend')}</legend>
                        <p className="settings-note">{t('settings.monsters.note')}</p>
                        <RealmMonsters
                          importRows={importMonsters}
                          load={loadMonsters}
                          realm={serverPick === NEW_SERVER ? null : serverPick}
                          save={saveMonsters}
                        />
                      </fieldset>
                    </>
                  )}

                  {realmSection === 'items' && (
                    <>
                      {/*
                    And what to do about particular items: the realm's table
                    from MegaMUD's Items.md, the choices half of its item
                    details. The facts are the realm data's.
                  */}
                      <fieldset className="settings-menus" data-fieldset="realm-items">
                        <legend>{t('settings.items.legend')}</legend>
                        <p className="settings-note">{t('settings.items.note')}</p>
                        <RealmItems
                          importRows={importItems}
                          load={loadItems}
                          realm={serverPick === NEW_SERVER ? null : serverPick}
                          save={saveItems}
                        />
                      </fieldset>
                    </>
                  )}

                  {realmSection === 'spells' && (
                    <>
                      {/*
                    And what the place's spells say when they land and end,
                    as the wire taught them: put right here when a sentence
                    was paired with the wrong spell (2026-10-14).
                  */}
                      <fieldset className="settings-menus" data-fieldset="realm-spell-lore">
                        <legend>{t('settings.spellLore.legend')}</legend>
                        <p className="settings-note">{t('settings.spellLore.note')}</p>
                        <RealmSpellLore
                          load={loadSpellLore}
                          realm={serverPick === NEW_SERVER ? null : serverPick}
                          save={saveSpellLore}
                        />
                      </fieldset>
                    </>
                  )}

                  {realmSection === 'megamud' && (
                    <>
                      {/* Whether a hang-up here is charged: a fact about the place (todo 01). */}
                      <fieldset data-fieldset="realm-hang-penalties">
                        <legend>{t('settings.health.hangUpLegend')}</legend>
                        <div className="settings-inline">
                          <SelectField
                            hint={t('settings.health.hangPenaltiesHint')}
                            label={t('settings.health.hangPenaltiesLabel')}
                            name="realm-hang-penalties"
                            onChange={(value) =>
                              setServerForm({ ...serverForm, hangPenalties: penaltiesOf(value) })
                            }
                            options={[
                              { value: '', label: t('settings.health.hangPenaltiesGlobal') },
                              { value: 'yes', label: t('settings.health.hangPenaltiesYes') },
                              { value: 'no', label: t('settings.health.hangPenaltiesNo') }
                            ]}
                            value={penaltiesChoice(serverForm.hangPenalties)}
                          />
                        </div>
                      </fieldset>

                      {/*
                    What this realm calls its coins: a fact about the place, like
                    the ranking above (`Server.coins`). Blank is the stock name.
                  */}
                      <fieldset data-fieldset="realm-coins">
                        <legend>{t('settings.realms.coinsLegend')}</legend>
                        <p className="settings-note">{t('settings.realms.coinsNote')}</p>
                        <div className="settings-inline">
                          {DENOMINATIONS.map((which) => (
                            <TextField
                              key={which}
                              label={COIN_NAME[which][0]}
                              name={`realm-coin-${which}`}
                              onChange={(value) =>
                                setServerForm({
                                  ...serverForm,
                                  coins: { ...serverForm.coins, [which]: value }
                                })
                              }
                              placeholder={STOCK_COINS[which]}
                              spellCheck={false}
                              value={serverForm.coins[which] ?? ''}
                            />
                          ))}
                        </div>
                      </fieldset>

                      {/*
                    MegaMUD's BBS.INI for this realm (`Server.bbs`), for the
                    MegaMUD engine. Blank is MegaMUD's default, which the
                    placeholder shows.
                  */}
                      <fieldset data-fieldset="realm-bbs">
                        <legend>{t('settings.realms.bbsLegend')}</legend>
                        <p className="settings-note">{t('settings.realms.bbsNote')}</p>
                        <div className="settings-inline">
                          {BBS_KEYS.map(({ key, fallback }) => (
                            <TextField
                              key={key}
                              label={bbsLabel(key)}
                              name={`realm-bbs-${key}`}
                              onChange={(value) =>
                                setServerForm({
                                  ...serverForm,
                                  bbs: { ...serverForm.bbs, [key]: value }
                                })
                              }
                              placeholder={fallback}
                              spellCheck={false}
                              value={serverForm.bbs[key] ?? ''}
                            />
                          ))}
                        </div>
                      </fieldset>
                    </>
                  )}

                  <div className="settings-actions">
                    {serverPick === NEW_SERVER ? (
                      <button className="primary" type="submit">
                        {t('settings.realms.submit')}
                      </button>
                    ) : (
                      <FormActions
                        can={active.can}
                        error={active.save.error}
                        onRedo={active.redo}
                        onUndo={active.undo}
                        state={active.save.state}
                      />
                    )}
                    {serverPick !== NEW_SERVER &&
                      (confirming === serverPick ? (
                        <>
                          <span className="hint">{t('settings.realms.confirmRemove')}</span>
                          <button
                            className="danger"
                            onClick={() => void removeServer()}
                            type="button"
                          >
                            {t('settings.actions.confirmYes')}
                          </button>
                          <button
                            className="quiet"
                            onClick={() => setConfirming(null)}
                            type="button"
                          >
                            {t('settings.actions.confirmKeep')}
                          </button>
                        </>
                      ) : (
                        <button
                          className="quiet"
                          onClick={() => setConfirming(serverPick)}
                          type="button"
                        >
                          {t('settings.actions.remove')}
                        </button>
                      ))}
                  </div>
                </form>
              )}
            </>
          )}
        </div>

        <footer className="settings-foot">
          {problem !== null && <span className="settings-problem">{problem}</span>}
          {problem === null && saved !== null && <span className="settings-saved">{saved}</span>}
          {/* Everything this screen does not cover is one click away, and
              saying so is what keeps the screen from having to grow into a
              YAML editor. */}
          <span className="settings-paths">
            <button className="quiet" onClick={revealConfig} onMouseDown={keepFocus} type="button">
              {t('settings.footer.openConfig')}
            </button>
            <button
              className="quiet"
              onClick={revealProfiles}
              onMouseDown={keepFocus}
              type="button"
            >
              {t('settings.footer.openProfiles')}
            </button>
          </span>
        </footer>

        {/*
          The corner, and only the corner. The panel opens at the top left and
          the two things anybody wants of it are *smaller* and *taller so the
          form fits*; eight handles would be seven more edges to hit by
          accident on a surface whose whole body is controls.
        */}
        {!required && (
          <button
            aria-label={t('settings.dialog.resizeAria')}
            className="settings-grip"
            onDoubleClick={panel.reset}
            onPointerDown={panel.resize}
            type="button"
          />
        )}
      </div>
    </div>
  );
}

/**
 * A press on a control inside the heading is a click, never the start of a
 * drag.
 *
 * Stopping it here rather than having the heading test what was underneath:
 * the row is the handle, and a control that does not want to be dragged says
 * so itself — which is one line per control and no list to keep in step.
 */
function stopDrag(event: React.PointerEvent): void {
  event.stopPropagation();
}
