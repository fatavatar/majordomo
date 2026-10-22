/**
 * What this character could fight, and where it should hunt (moved out of
 * `SessionManager` on 2026-10-22, unchanged): the room's verdict and its
 * simulated fight for the Room card, a monster's verdict for the Reference
 * card, and the hunting survey behind the Hunting card and auto-hunt. All of
 * it is arithmetic over the character's state, the realm's data and the
 * character's settings, which the session lends through `AppraisalHost`.
 *
 * Computed in main and not in the renderer because three of its inputs live
 * only here: the class row, the server's family and the menace prices in
 * `internal.yaml`.
 */
import {
  type Capabilities,
  HAZARD_ABILITY,
  capabilitiesOf,
  poisonRefusesRest
} from '../../shared/abilities';
import { type CharacterState, ownAlignment } from '../../shared/character';
import { commandOf } from '../../shared/commands';
import { type AutomationConfig } from '../../shared/config';
import { type FightSink } from '../../shared/fights';
import { inTheFight } from '../../shared/guards';
import {
  type FillerInput,
  type HealingCast,
  type HuntingAdvice,
  type HuntingAssumptions,
  type HuntingConstants,
  type HuntingRoom,
  type HuntingSpot,
  type SpotCharacter,
  type SpotEstimate,
  type SpotInput,
  type SpotMob,
  addFiller,
  compareSpots,
  estimateSpot,
  moveDelayMs,
  orderRing,
  respawnSeconds,
  sizeLoop
} from '../../shared/hunting';
import {
  type MenacePlayer,
  ROUND_SECONDS,
  afflictionsOf,
  protectionOf,
  scaledPower,
  weighRoom
} from '../../shared/menace';
import { attacksOnSight } from '../../shared/mobs';
import {
  type ProwessSheet,
  type ProwessWeapon,
  dodge,
  regeneration,
  swing
} from '../../shared/prowess';
import { type RealmFamily } from '../../shared/realm';
import {
  type SpellChoiceInput,
  castsToKill,
  chooseAttackSpell,
  healPower
} from '../../shared/spellchoice';
import { resolveSpell, spellCost, spellServes } from '../../shared/spellcraft';
import {
  SURVIVAL_HORIZONS,
  type Survival,
  type SurvivalFoe,
  type SurvivalHeal,
  simulateFight
} from '../../shared/survival';
import {
  EMPTY_ROOM_VERDICT,
  type RoomVerdict,
  type Verdict,
  appraiseRoom,
  prowessSheetOf,
  roomVerdictKey,
  weighVerdicts,
  wieldedWeapon
} from '../../shared/verdict';
import { type RoomId, type WorldRoom, parseLair, roomId } from '../../shared/world';
import { t } from '../app/i18n';
import { tuning } from '../app/tuning';
import { type Traveller, type WorldGraph } from '../world/WorldGraph';

/** The rooms holding one lair signature, as the hunting survey groups them. */
interface HuntGroup {
  rooms: HuntingRoom[];
  sample: WorldRoom;
  via: 'lair' | 'resident';
  spawns: number | null;
}

/** What pricing a group costs to work out and what it depends on: the character, never the room. */
interface HuntPrice {
  mobs: SpotMob[];
  clock: HuntingSpot['clock'];
  respawn: number | null;
}

/** One group priced against the character, before any loop is drawn round it. */
interface HuntPriced extends HuntPrice {
  key: string;
  group: HuntGroup;
  /** Every room of the group, nearest first. */
  rooms: HuntingRoom[];
}

/** What the appraisal reads of its session. */
export interface AppraisalHost {
  state(): CharacterState;
  world(): WorldGraph | undefined;
  automation(): AutomationConfig;
  /** Which lineage's formulas the server runs (`SessionManager.serverFamily`). */
  family(): RealmFamily | null;
  fightRecord(): FightSink;
  /** The traveller routes are priced for (`SessionManager.travellerNow`). */
  traveller(state: CharacterState): Traveller;
  /** What the character is fit for, as a cache key (`SessionManager.fitness`). */
  fitness(state: CharacterState): string;
  publishVerdict(verdict: RoomVerdict): void;
}

export class Appraisal {
  /** What the last pushed appraisal drew as, so a status line that moves no figure pushes nothing. */
  private lastVerdictKey = '';
  /**
   * The hunting survey's pricing pass, remembered until the character's
   * fitness moves (todo 00, 2026-09-13). Weighing 1,260 groups costs main
   * ~140ms and depends on the sheet, the weapon, the class and the spells —
   * not on the room — while the card re-asks on every move it makes. Keyed
   * like `LairCosts`, the casting half added; dropped with the realm.
   */
  private huntPrices: { key: string; world: WorldGraph; groups: Map<string, HuntPrice> } | null =
    null;
  /** The room's last fight run and what it was run on, so a status line that moves nothing reruns nothing. */
  private ran: { key: string; survival: Survival | null } | null = null;

  constructor(private readonly host: AppraisalHost) {}

  /** The room as it stands, appraised against the character as it stands. See `appraiseRoom`. */
  get verdict(): RoomVerdict {
    const state = this.host.state();
    if (state.phase !== 'in-game' || state.room.occupants.length === 0) return EMPTY_ROOM_VERDICT;
    const { combat, magery, family } = this.realmClass();
    const sheet = prowessSheetOf(state, { combat, magery });
    const weapon = wieldedWeapon(state.inventory.items);
    const appraisal = appraiseRoom(
      state.room.occupants,
      this.menacePlayer(state),
      tuning().menace,
      sheet,
      weapon,
      family
    );
    return { ...appraisal, survival: this.survivalOf(state, sheet, weapon, family) };
  }

  /**
   * *Can I fight this room?* — pushed beside the character, on change.
   *
   * Computed here and not in the renderer because three of its inputs live
   * only in main: the class row, the server's family and the menace prices in
   * `internal.yaml`. And computed here rather than inside the engine because
   * the answer is owed to a player with automation **off** — the Room card is
   * for a person deciding whether to open, and the engine's ranking is one
   * consumer of the same function, not its owner. The key keeps a status line
   * that moves no drawn figure from costing a push.
   */
  publishVerdict(): void {
    const appraisal = this.verdict;
    const key = roomVerdictKey(appraisal);
    if (key === this.lastVerdictKey) return;
    this.lastVerdictKey = key;
    this.host.publishVerdict(appraisal);
  }

  /**
   * One monster each, by name, for the Reference card's lookup — the same
   * arithmetic as the room's, run on a room of one, so a monster looked up
   * from the console reads exactly as it would standing in front of it.
   *
   * A name the realm cannot place gets no key: the lookup already answers only
   * with the realm's own rows, so an unplaceable name here is one the caller
   * invented rather than one the card will draw.
   */
  appraise(names: readonly string[]): Record<string, Verdict> {
    const state = this.host.state();
    const { combat, magery, family } = this.realmClass();
    const sheet = prowessSheetOf(state, { combat, magery });
    const weapon = wieldedWeapon(state.inventory.items);
    const player = this.menacePlayer(state);
    const verdicts: Record<string, Verdict> = {};
    // Weighed as the row the character's own room resolves each name to: a
    // name holding two of the realm's rows was weighed as the worse of them
    // wherever the room says which it is. See `WorldGraph.resolveMobRow`.
    const at =
      state.room.map === null || state.room.number === null
        ? null
        : roomId(state.room.map, state.room.number);
    for (const name of names) {
      const entity = this.host.world()?.buildMobEntity(name, { at });
      if (entity === undefined || entity.source === 'wire') continue;
      const [verdict] = weighVerdicts([entity], player, tuning().menace, sheet, weapon, family);
      if (verdict !== undefined) verdicts[name] = verdict;
    }
    return verdicts;
  }

  /**
   * The room's fight run for this character as it stands (todo 02): what
   * here would fight, the heal the automation would cast, the regeneration
   * tick and the blessings that lapse before it is over. Everything the
   * appraisal cannot see, because only the session holds the configuration
   * and the buffs. Run again only when what it is run on moved: it is read
   * on every status line (upstream 519471e). See
   * `simulateFight` and mudengine-automation › *The verdict is also run as a
   * fight*.
   */
  private survivalOf(
    state: CharacterState,
    sheet: ProwessSheet,
    weapon: ProwessWeapon | null,
    family: RealmFamily | null
  ): Survival | null {
    const { hp, hpMax, mana, manaMax } = state.vitals;
    if (hp === null || hpMax === null || hpMax <= 0) return null;
    const standing = ownAlignment(state);
    const fighting = new Set(
      [...state.combat.attackers, state.combat.target ?? '']
        .filter((name) => name.length > 0)
        .map((name) => name.toLowerCase())
    );
    /*
     * What would fight: everything the realm says attacks on sight, anything
     * it cannot say about (unknown never reassures), and whatever is already
     * swinging or being swung at. A passive resident standing by is not a
     * foe, or every shop would read as a fight — unless it is certain to
     * protect one, when the server brings it in (`guards.ts`).
     */
    const casting = this.castingInput(state, sheet, family);
    const foes: SurvivalFoe[] = [];
    const casts: Array<{ perRound: number; manaPerRound: number } | null> = [];
    const fights = inTheFight(
      state.room.occupants.filter((who) => who.kind !== 'player'),
      (who) =>
        attacksOnSight(who.disposition, standing) !== false || fighting.has(who.name.toLowerCase()),
      () => true
    );
    for (const who of fights) {
      const subject: SurvivalFoe['subject'] = who.mob ?? {};
      foes.push({ name: who.name, subject });
      const kill =
        casting === null
          ? null
          : castsToKill(casting, {
              hp: subject.hp ?? null,
              magicRes: who.mob?.magicResist ?? null,
              abilities: subject.abilities
            });
      casts.push(
        kill === null || subject.hp === undefined
          ? null
          : { perRound: subject.hp / kill.rounds, manaPerRound: (kill.mana ?? 0) / kill.rounds }
      );
    }
    if (foes.length === 0) return null;

    /*
     * The heal as the old automation would cast it: the in-combat threshold where one
     * is set, the configured spell's own range at this level, its cost. Only
     * with the mana known — a heal that cannot be budgeted is not modelled,
     * which errs towards the fight being harder than it is.
     */
    const spells = this.host.automation().spells;
    const below = spells.healBelowInCombat > 0 ? spells.healBelowInCombat : spells.healBelow;
    let heal: SurvivalHeal | null = null;
    if (below > 0 && spells.heal.trim().length > 0 && mana !== null) {
      const found = resolveSpell(
        spells.heal,
        state.spellbook,
        (name) => this.host.world()?.spellNamed(name) ?? null
      );
      const cost = spellCost(found);
      const realm = found.realm;
      const heals = (realm?.abilities ?? []).some(
        ([id, value]) => id === HAZARD_ABILITY.heal && value >= 0
      );
      if (realm !== null && cost !== null && heals && realm.power !== undefined) {
        heal = {
          below,
          to: spells.healTo,
          restores: scaledPower(realm, state.progress.level ?? 0),
          cost,
          minMana: spells.minMana
        };
      }
    }

    const regen = regeneration(sheet, null, family);
    const regenPerRound =
      regen === null ? 0 : (regen.health.value * ROUND_SECONDS) / regen.tickSeconds;
    const now = Date.now();
    const roundCap = tuning().menace.survivalRoundCap;
    const recasts = state.buffs.flatMap((buff) => {
      if (buff.expiresAt === undefined) return [];
      const round = Math.ceil((buff.expiresAt - now) / (ROUND_SECONDS * 1000));
      if (round <= 0 || round > roundCap) return [];
      const cost = this.host.world()?.spellNamed(buff.spell)?.mana ?? null;
      return cost === null || cost <= 0 ? [] : [{ round, cost }];
    });

    const input = {
      hp,
      hpMax,
      mana,
      manaMax,
      player: this.menacePlayer(state),
      sheet,
      weapon,
      family,
      weights: tuning().menace,
      foes,
      casting: casts,
      heal,
      regenPerRound,
      recasts,
      levels: {
        safeAbove: tuning().menace.survivalSafeAbove,
        riskyAbove: tuning().menace.survivalRiskyAbove
      },
      trials: tuning().menace.survivalTrials,
      roundCap,
      // Read part way, for the death risk the run and the hang-up act on.
      horizons: SURVIVAL_HORIZONS
    };
    // The recasts' rounds count down with the clock, so the key is what is drawn from, not the time.
    const key = JSON.stringify({ ...input, recasts: input.recasts.length });
    if (this.ran?.key === key) return this.ran.survival;
    this.ran = { key, survival: simulateFight(input) };
    return this.ran.survival;
  }

  /**
   * Where this character should hunt (todo 05; revamped 2026-09-13, todo 00).
   *
   * Every lair and placed monster the exits reach — `WorldGraph.withinSteps`,
   * unbounded unless `radius` says otherwise; a sweep, never a route per
   * room — grouped by what spawns and each group priced once with the Room
   * card's arithmetic (`weighVerdicts`) and the realm's own clock through
   * `estimateSpot`. Two exclusions before the ranking, counted and said: a
   * room whose one cycle costs more than `maxDamageShare` of the bar, and
   * one that could not scratch an unarmoured character. The best `maxSpots`
   * are then measured properly (`measuredSpot`) and ranked again, with the
   * one `measure` names; the rest come back unmeasured, since the answer is
   * the realm. Distance is a column, not a bound: the walk there is automated.
   */
  huntingGrounds(radius: number | null, measure: string | null = null): HuntingAdvice {
    const state = this.host.state();
    const world = this.host.world();
    // Every figure the model runs on, named here so each has a reader.
    const {
      roundSeconds,
      restTickSeconds,
      passiveTickSeconds,
      killOverheadMs,
      stepMs,
      greatermudRespawnOffsetSeconds,
      backstabMultiplier,
      maxLoopRooms,
      maxSpots,
      betterSpotRadius,
      maxDamageShare,
      trivialShare,
      trivialLevelMargin,
      clusterRadius,
      fillerRadius,
      sizeTolerance,
      measuredFightsMin
    } = tuning().hunting;
    const c: HuntingConstants = {
      roundSeconds,
      restTickSeconds,
      passiveTickSeconds,
      killOverheadMs,
      stepMs,
      greatermudRespawnOffsetSeconds,
      backstabMultiplier,
      maxLoopRooms,
      maxSpots,
      betterSpotRadius,
      maxDamageShare,
      trivialShare,
      trivialLevelMargin,
      clusterRadius,
      fillerRadius,
      sizeTolerance
    };
    const { combat, magery, family } = this.realmClass();
    const sheet = prowessSheetOf(state, { combat, magery });
    const regen = regeneration(sheet, null, family);
    const backstab = commandOf(this.host.automation().combat.opener.trim()) === 'BackStab';
    /*
     * One step is the server's own movement delay from the pack's weight
     * (`MoveCommand.cs:40`), where the family states one; the measured round
     * otherwise. A full pack slows the whole loop, and the estimate says so.
     */
    const step = moveDelayMs(
      state.inventory.encumbrance,
      state.inventory.encumbranceMax,
      family,
      c.stepMs
    );
    const heal = this.healingCast(state);
    /*
     * `RestCommand.cs:28` refuses a poisoned character, immunity excepted
     * (`poisonRefusesRest`). A cure — a configured spell, an antidote rule, or
     * one the book would yield under `autoChoose` — lifts it for the estimate.
     */
    const poisonHoldsRest =
      poisonRefusesRest(this.capabilities(), family) && !this.curesPoison(state);
    const character: SpotCharacter = {
      hpMax: state.vitals.hpMax,
      restingHealthPerTick: regen?.restingHealth.value ?? null,
      passiveHealthPerTick: regen?.health.value ?? null,
      backstab,
      /*
       * The caster's half (todo 26). A round costs mana only where a round
       * spell is configured — or derived under `autoChoose` — so a melee
       * character carries null here and the cycle is exactly what it was.
       * **Meditating is not resting tripled**: `TimedEventManager` gives a
       * resting character `HPRegen * 3` and a meditating one
       * `GetBaseMARegen()` flat, so the mana rate is the standing rate.
       */
      ...this.castingCost(state),
      meditatingManaPerTick: regen?.meditatingMana?.value ?? null,
      passiveManaPerTick: regen?.mana?.value ?? null,
      stepMs: step,
      heal,
      poisonHoldsRest
    };
    const assumptions: HuntingAssumptions = {
      family,
      hpMax: state.vitals.hpMax,
      restingHealthPerTick: character.restingHealthPerTick,
      backstab,
      stepMs: step,
      heal,
      poisonHoldsRest,
      measured: null,
      constants: c
    };
    const refused = (refusal: string): HuntingAdvice => ({
      from: null,
      radius,
      swept: 0,
      spots: [],
      unmeasured: [],
      excluded: { dangerous: 0, beneath: 0 },
      assumptions,
      refusal
    });
    if (!world || world.size === 0) return refused(t('session.hunt.noRealmData'));
    const here = state.room;
    if (here.map === null || here.number === null) return refused(t('session.hunt.unknownRoom'));
    const from = roomId(here.map, here.number);
    const start = world.byId(from);
    if (!start) return refused(t('session.hunt.unknownRoom'));

    /*
     * **Priced by this traveller** (todo 09): a lair behind a door this
     * character cannot open is not a lair it can hunt, and the survey was
     * offering them — a loop started on one plans a leg, is refused, and
     * stands still. The sweep is still one pass over the rooms; what changed
     * is that an impassable exit is not an exit.
     */
    const reach = world.withinSteps(
      from,
      radius ?? Number.POSITIVE_INFINITY,
      this.host.traveller(state)
    );
    /*
     * Grouped by what spawns, not by name: two rooms naming the same rows at
     * the same cap are one hunting ground with two rooms in it, which is
     * what a loop is made of. `groupOfRoom` is the join a filler is found by.
     */
    const groups = new Map<string, HuntGroup>();
    const groupOfRoom = new Map<RoomId, string>();
    for (const [id, steps] of reach) {
      const room = world.byId(id);
      if (!room) continue;
      let key: string;
      let via: 'lair' | 'resident';
      let spawns: number | null = null;
      if (room.lair) {
        const lair = parseLair(room.lair);
        // The clock is part of what spawns: two rooms naming the same rows on
        // different delays are two hunting grounds, and a price is cached by key.
        key = `lair:${lair.max ?? 1}:${[...lair.ids].sort((a, b) => a - b).join(',')}:${room.delay ?? ''}`;
        via = 'lair';
        spawns = lair.max;
      } else if (room.npcId !== undefined) {
        key = `resident:${room.npcId}`;
        via = 'resident';
      } else {
        continue;
      }
      const entry = groups.get(key) ?? { rooms: [], sample: room, via, spawns };
      entry.rooms.push({ id, map: room.map, room: room.room, name: room.name, steps });
      groups.set(key, entry);
      groupOfRoom.set(id, key);
    }

    const player = this.menacePlayer(state);
    // The same character with nothing on: every blow lands, at its full figure.
    const naked: MenacePlayer = { armourClass: 0, damageResist: 0, magicRes: player.magicRes };
    const weapon = wieldedWeapon(state.inventory.items);
    const weights = tuning().menace;
    /*
     * The caster's rounds (todo 108). `verdictFor` gets a fight's length from
     * the swing, and a Mage's swing is nothing worth counting; where the swing
     * says nothing, the spell the character would cast at *this* monster, at
     * one cast a round over the full pool, says it.
     */
    const casting = this.castingInput(state, sheet, family);
    /*
     * Where the arithmetic *declines* — `swing` is null only on the family
     * gate or an unread accuracy, neither of which reads the target, and a
     * book with no attack spell casts nothing — a kill is priced from what
     * this character has measured dealing a round. Where either *refuses*
     * (no blow lands, the spell is resisted), the refusal stands.
     */
    const blank = { armourClass: null, damageResist: null, dodge: null, health: null };
    const declines =
      swing(sheet, weapon, blank, family) === null &&
      (casting === null ||
        chooseAttackSpell({ ...casting, target: null, excluded: new Set() }).refusal ===
          'no-attack-spells');
    const level = state.progress.level;
    const measured =
      !declines || level === null
        ? null
        : (this.host.fightRecord().measured?.(level, {
            least: measuredFightsMin,
            roundMs: roundSeconds * 1000,
            openerRounds: backstab ? backstabMultiplier : 1
          }) ?? null);
    const priceKey = [
      this.host.fitness(state),
      this.host.automation().spells.attack,
      this.host.automation().spells.autoChoose,
      this.host.automation().combat.opener,
      state.spellbook?.length ?? -1,
      state.vitals.manaMax,
      measured === null ? '-' : Math.round(measured.perRound)
    ].join('|');
    if (this.huntPrices?.key !== priceKey || this.huntPrices.world !== world) {
      this.huntPrices = { key: priceKey, world, groups: new Map() };
    }
    const remembered = this.huntPrices.groups;
    /** One group's monsters priced, and its clock: the half a move does not change. */
    const price = (group: HuntGroup): HuntPrice | null => {
      const entities =
        group.via === 'lair'
          ? world.lairEntities(group.sample)
          : world.residentEntities(group.sample);
      if (entities.length === 0) return null;
      const verdicts = weighVerdicts(entities, player, weights, sheet, weapon, family);
      const bare = weighRoom(entities, naked, weights);
      const recorded = (hp: number | null): number | null =>
        measured === null || hp === null || hp <= 0 ? null : hp / measured.perRound;
      const mobs: SpotMob[] = entities.map((entity, index) => ({
        name: entity.name,
        experience: entity.experience ?? null,
        rounds:
          verdicts[index]?.rounds?.value ??
          (casting === null
            ? null
            : (castsToKill(casting, {
                hp: verdicts[index]?.menace?.hp ?? entity.hp ?? null,
                magicRes: entity.magicResist ?? null,
                abilities: entity.abilities
              })?.rounds ?? null)) ??
          recorded(verdicts[index]?.menace?.hp ?? entity.hp ?? null),
        perRound: verdicts[index]?.menace?.perRound ?? null,
        nakedPerRound: bare[index]?.perRound ?? null,
        afflictions: afflictionsOf(entity),
        /*
         * A row the realm gives a clock of its own (todo 09): the Gravedigger
         * is 1,500 points on an hour's regeneration, and a lair holding it was
         * priced as though it came back with the rest of the room.
         * `estimateSpot` weights its experience by how often it is up.
         */
        regenSeconds: entity.regenHours === undefined ? null : entity.regenHours * 3600
      }));
      const clock: HuntingSpot['clock'] =
        group.via === 'lair'
          ? group.sample.delay === undefined
            ? null
            : 'delay'
          : (entities[0]?.regenHours ?? null) === null
            ? null
            : 'regenTime';
      const respawn =
        group.via === 'lair'
          ? respawnSeconds(group.sample.delay ?? null, family, c)
          : entities[0]?.regenHours === undefined
            ? null
            : entities[0].regenHours * 3600;
      return { mobs, clock, respawn };
    };
    const priced = new Map<string, HuntPriced>();
    const excluded = { dangerous: 0, beneath: 0 };
    const survey: HuntingSpot[] = [];
    for (const [key, group] of groups) {
      let known = remembered.get(key);
      if (known === undefined) {
        const fresh = price(group);
        if (fresh === null) continue;
        remembered.set(key, fresh);
        known = fresh;
      }
      const { mobs, clock, respawn } = known;
      const rooms = [...group.rooms].sort((a, b) => a.steps - b.steps);
      const entry: HuntPriced = { key, group, mobs, clock, respawn, rooms };
      /*
       * A first estimate to rank on and to exclude by: the nearest rooms, the
       * ring's length guessed from the sweep's distances — out to the farthest
       * and back, a step between neighbours. The best are then measured.
       */
      const loop = group.via === 'lair' ? rooms.slice(0, c.maxLoopRooms) : rooms.slice(0, 1);
      const guessed =
        loop.length <= 1
          ? 0
          : 2 * (loop[loop.length - 1]!.steps - loop[0]!.steps) + 2 * (loop.length - 1);
      const estimate = estimateSpot(
        {
          rooms: loop.length,
          spawns: group.spawns,
          mobs,
          respawnSeconds: respawn,
          loopSteps: guessed,
          character,
          filler: []
        },
        c
      );
      if (estimate.deadly || estimate.costly) {
        excluded.dangerous += 1;
        continue;
      }
      if (estimate.trivial) {
        excluded.beneath += 1;
        continue;
      }
      priced.set(key, entry);
      survey.push({
        key,
        mobs,
        clock,
        boss: clock === 'regenTime',
        respawnSeconds: respawn,
        spawns: group.spawns,
        rooms: loop,
        filler: [],
        walk: loop,
        roomCount: rooms.length,
        loopSteps: guessed,
        estimate
      });
    }
    survey.sort(compareSpots);
    /*
     * Only the best are measured: a bounded sweep from each of a ring's rooms
     * is under a millisecond and there are thousands of groups, so the survey
     * ranks on the guess and measures `maxSpots` of them. A spot just below
     * the cut could measure into it; the guess is the same shape for all, so
     * the order it gives is the order the measurement mostly keeps. The rest
     * are handed back unmeasured rather than dropped: measuring all 910 of
     * Paradigm's cost 1.1s, and a list cut at twenty-four is not the realm.
     * The one a reader opened is measured too, so what it walks is a ring.
     */
    const rest = survey.slice(c.maxSpots);
    const opened = rest.findIndex((spot) => spot.key === measure);
    const chosen = survey.slice(0, c.maxSpots);
    if (opened !== -1) chosen.push(rest[opened]!);
    const spots = chosen.map((spot) =>
      this.measuredSpot(
        spot,
        priced.get(spot.key)!,
        priced,
        groupOfRoom,
        reach,
        character,
        c,
        world
      )
    );
    spots.sort(compareSpots);
    return {
      from: { id: from, name: start.name },
      radius,
      swept: reach.size,
      spots,
      unmeasured: opened === -1 ? rest : rest.filter((_, at) => at !== opened),
      excluded,
      assumptions: { ...assumptions, measured },
      refusal: null
    };
  }

  /**
   * One surveyed spot, measured: the ring's legs by a bounded sweep from each
   * of its rooms (`orderRing`), its size by the clock (`sizeLoop`), and the
   * clocked lairs of other admissible groups within `fillerRadius` of a ring
   * room added while each raises the rate (`addFiller`). A filler hangs off
   * the ring room it was found from, and the walk lists it there.
   */
  private measuredSpot(
    spot: HuntingSpot,
    own: HuntPriced,
    byKey: ReadonlyMap<string, HuntPriced>,
    groupOfRoom: ReadonlyMap<RoomId, string>,
    reach: ReadonlyMap<RoomId, number>,
    character: SpotCharacter,
    c: HuntingConstants,
    world: WorldGraph
  ): HuntingSpot {
    const candidates =
      own.group.via === 'lair' ? own.rooms.slice(0, c.maxLoopRooms) : own.rooms.slice(0, 1);
    if (candidates.length === 0) return spot;
    const sweeps = new Map<RoomId, Map<RoomId, number>>();
    // Priced by the traveller, as the survey's own sweep is: a ring whose
    // rooms are separated by a door this character cannot open is not a ring
    // it can walk, and the step count would be a fiction either way.
    const priced = this.host.traveller(this.host.state());
    for (const room of candidates) {
      sweeps.set(room.id, world.withinSteps(room.id, c.clusterRadius, priced));
    }
    const distance = (a: RoomId, b: RoomId): number | null =>
      sweeps.get(a)?.get(b) ?? sweeps.get(b)?.get(a) ?? null;
    const { order, ringSteps } = orderRing(candidates, distance);
    const base = (rooms: number): SpotInput => ({
      rooms,
      spawns: own.group.spawns,
      mobs: own.mobs,
      respawnSeconds: own.respawn,
      loopSteps: ringSteps(rooms),
      character,
      filler: []
    });
    const sized = sizeLoop(base, candidates.length, c);
    const ring = order.slice(0, sized.rooms);

    const offers: Array<{ room: HuntingRoom; after: number; input: FillerInput }> = [];
    const seen = new Set<RoomId>(candidates.map((room) => room.id));
    for (const [at, room] of ring.entries()) {
      const near = sweeps.get(room.id);
      if (near === undefined) continue;
      for (const [id, steps] of near) {
        if (steps === 0 || steps > c.fillerRadius || seen.has(id)) continue;
        const key = groupOfRoom.get(id);
        if (key === undefined || key === own.key) continue;
        const other = byKey.get(key);
        // A filler is a clocked lair another admissible group holds; a placed
        // boss is its own spot, and a room with no clock is hunted on luck.
        if (other === undefined || other.respawn === null || other.group.via !== 'lair') continue;
        const found = world.byId(id);
        if (!found) continue;
        seen.add(id);
        offers.push({
          room: {
            id,
            map: found.map,
            room: found.room,
            name: found.name,
            steps: reach.get(id) ?? room.steps + steps,
            mobs: other.mobs.map((mob) => mob.name),
            detour: 2 * steps,
            // Its own clock, which the survey already required of a filler —
            // and which the lap needs on the stop to walk the detour only on
            // the laps the room is standing (todo 15, `LoopStop.every`).
            respawnSeconds: other.respawn
          },
          after: at,
          input: {
            spawns: other.group.spawns,
            mobs: other.mobs,
            respawnSeconds: other.respawn,
            detourSteps: 2 * steps
          }
        });
      }
    }
    offers.sort((a, b) => a.input.detourSteps - b.input.detourSteps);
    const filled = addFiller(
      base(sized.rooms),
      offers.map((offer) => offer.input),
      c.maxLoopRooms,
      c
    );
    const taken = filled.taken.map((index) => offers[index]!);
    const walk: HuntingRoom[] = [];
    ring.forEach((room, at) => {
      walk.push(room);
      for (const offer of taken) if (offer.after === at) walk.push(offer.room);
    });
    const estimate: SpotEstimate = filled.estimate;
    return {
      ...spot,
      rooms: ring,
      filler: taken.map((offer) => offer.room),
      walk,
      loopSteps:
        ringSteps(sized.rooms) + taken.reduce((sum, offer) => sum + offer.input.detourSteps, 0),
      estimate
    };
  }

  /**
   * The configured heal, priced from its realm row: what one cast mends and
   * what it costs. Null where nothing is configured, the realm cannot name
   * it, the row carries no heal at all, or the cost is unstated — an unpriced
   * heal costs the estimate nothing, since resting is still the way the cycle
   * recovers.
   *
   * `healPower` is the one reading of what a cast mends, shared with
   * `chooseHealSpell` (todo 01): the survey and the healer must not disagree
   * about what a spell is worth.
   */
  private healingCast(state: CharacterState): HealingCast | null {
    const name = this.host.automation().spells.heal.trim();
    const world = this.host.world();
    if (name.length === 0 || world === undefined) return null;
    const spell = world.spellNamed(name);
    if (spell === null || spell === undefined) return null;
    const level = state.progress.level;
    if (level === null) return null;
    const power = healPower(spell, level);
    const mana = spell.mana ?? null;
    if (power === null || mana === null) return null;
    const hp = (power[0] + power[1]) / 2;
    if (hp <= 0) return null;
    return { hpPerCast: hp, manaPerCast: mana };
  }

  /**
   * Whether anything this character has ends a poison: a configured cure, an
   * antidote rule under `health.potions`, or — under `autoChoose`, where the
   * blank cure box is filled from the book — a spell the read book holds that
   * the realm says serves it. An unread book yields nothing.
   */
  private curesPoison(state: CharacterState): boolean {
    const { spells, health } = this.host.automation();
    if (spells.cures.poison.trim().length > 0) return true;
    if (health.potions.some((rule) => rule.when === 'poisoned' && rule.name.trim().length > 0)) {
      return true;
    }
    const world = this.host.world();
    if (!spells.autoChoose || state.spellbook === null || world === undefined) return false;
    return state.spellbook.some(
      (known) => spellServes(world.spellNamed(known.name)?.abilities).poisoned
    );
  }

  /**
   * What a round costs this character in mana, for the hunting model
   * (todo 26, 2026-09-12).
   *
   * **Only from a spell the player has actually configured.** A character with
   * a blank `spells.attack` fights with `combat.attack`, which costs nothing
   * from the pool — so null here, and the estimate is exactly the melee one.
   * A derived spell under `autoChoose` is not read: it is chosen per target
   * from what is in front of the character, and a hunting estimate is about a
   * room the character is not standing in.
   *
   * Null too where the realm cannot price the spell, which is the standing
   * rule: an unknown cost is never zero, and zeroing it would report a
   * caster's cycle as free.
   */
  private castingCost(state: CharacterState): {
    manaPerRound: number | null;
    manaMax: number | null;
  } {
    const name = this.host.automation().spells.attack.trim();
    if (name.length > 0) {
      const spell = this.host.world()?.spellNamed(name) ?? null;
      return { manaPerRound: spell?.mana ?? null, manaMax: state.vitals.manaMax };
    }
    /*
     * Under `autoChoose` the round spell is derived, so the survey prices the
     * one the book would yield against an unread monster — the hardest hitter
     * the pool can pay for (todo 108). Null where nothing casts.
     */
    const { combat, magery, family } = this.realmClass();
    const casting = this.castingInput(state, prowessSheetOf(state, { combat, magery }), family);
    if (casting === null) return { manaPerRound: null, manaMax: null };
    const choice = chooseAttackSpell({ ...casting, target: null, excluded: new Set() });
    return {
      manaPerRound: choice.chosen?.cost ?? null,
      manaMax: state.vitals.manaMax
    };
  }

  /**
   * What `chooseAttackSpell` needs to say which spell this character would
   * cast, or null where the character does not cast by derivation: the switch
   * off, the book unread, or no realm to price it against (todo 108).
   */
  private castingInput(
    state: CharacterState,
    sheet: ProwessSheet,
    family: RealmFamily | null
  ): Omit<SpellChoiceInput, 'target' | 'excluded'> | null {
    if (!this.host.automation().spells.autoChoose) return null;
    const world = this.host.world();
    if (state.spellbook === null || world === undefined) return null;
    return {
      book: state.spellbook,
      realm: (name) => world.spellNamed(name) ?? null,
      level: state.progress.level,
      // The full pool: the survey prices a fight begun rested, not the one in progress.
      mana: state.vitals.manaMax ?? state.vitals.mana,
      sheet,
      family,
      killConfidence: tuning().spells.killConfidence
    };
  }

  /**
   * What this character can do, from the realm's class and race rows.
   *
   * One reading for every module that asks, because the server asks one
   * question: `GetAbility(x)` looks across every container, and a Ninja's
   * picklocks and a Gnome's are the same fact to it. Read at the point of use
   * like `realmClass`, since the world arrives with `useRealm` and neither
   * word is known until a stat sheet has been read.
   *
   * `null` where neither row is known, which every reader treats as *unknown*
   * rather than *no* (todo 22).
   */
  private capabilities(): Capabilities {
    const world = this.host.world();
    const state = this.host.state();
    return capabilitiesOf(
      state.className ? (world?.classNamed(state.className)?.abilities ?? null) : null,
      state.race ? (world?.raceAbilities(state.race) ?? null) : null
    );
  }

  /**
   * The character's own side of the combat arithmetic, for the engine's
   * ranking and the room's appraisal alike: the realm's `CombatLVL` and
   * `MageryLVL` for this class — the stat sheet prints neither — and which
   * lineage's formulas the server runs.
   *
   * Read at the point of use rather than captured, because `this.host.world()`
   * arrives with `useRealm` and the class is not known until a stat sheet
   * has been read. `serverFamily` and not the realm data's, deliberately:
   * this decides which *formulas* run, and the formulas are the server's.
   * The two can legitimately differ — see `noteFamily` — and on the shipped
   * configuration they do.
   */
  realmClass(): {
    combat: number | null;
    magery: number | null;
    family: RealmFamily | null;
  } {
    const row = this.host.world()?.classNamed(this.host.state().className ?? '') ?? null;
    return {
      combat: row?.combat ?? null,
      magery: row?.magery ?? null,
      family: this.host.family()
    };
  }

  /**
   * What a monster's blow or cast is measured against: the sheet's three
   * figures, the protection the server adds that the sheet does not print,
   * and the character's dodge.
   */
  menacePlayer(state: CharacterState): MenacePlayer {
    const { combat, magery, family } = this.realmClass();
    return {
      armourClass: state.progress.armourClass,
      damageResist: state.progress.damageResist,
      magicRes: state.progress.magicRes,
      ...protectionOf(state, (name) => this.host.world()?.spellNamed(name) ?? null),
      dodge: dodge(prowessSheetOf(state, { combat, magery }), family)?.value ?? null
    };
  }
}
