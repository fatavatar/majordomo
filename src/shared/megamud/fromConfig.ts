/**
 * A character's MegaMUD settings started from what it already does under the
 * old automation (2026-10-13): each setting with a plain MegaMUD equivalent
 * carried over, everything else left at MegaMUD's default for the player to
 * set. Offered on Settings -> MegaMUD to a character that has no MegaMUD
 * settings yet; nothing is written until the player saves.
 *
 * Fractions become MegaMUD's whole percentages, and spells MegaMUD's command
 * words (`word`, the realm's short form for a spell's name).
 */
import type { AutomationConfig } from '../config';
import { DENOMINATIONS, type Denomination } from '../character';
import { defaultSettings, type MegaSettings, type SettingValue } from './settings';

const PERCENT = 100;
const SELF_BLESSINGS = 10;
const PARTY_BLESSINGS = 4;

/** MegaMUD's `Cash.Want…` key for each coin. */
const WANT: Record<Denomination, string> = {
  copper: 'WantCopper',
  silver: 'WantSilver',
  gold: 'WantGold',
  platinum: 'WantPlat',
  runic: 'WantRunic'
};

function percent(fraction: number): number {
  return Math.round(fraction * PERCENT);
}

export function megamudFromConfig(
  automation: AutomationConfig,
  word: (spell: string) => string
): MegaSettings {
  const settings = defaultSettings();
  const set = (section: string, key: string, value: SettingValue): void => {
    (settings.live[section] ??= {})[key] = value;
  };
  const spell = (name: string): string => (name === '' ? '' : word(name));
  const flag = (on: boolean): number => (on ? 1 : 0);
  const { health, spells, combat, party, safety, movement, loot, search, afk } = automation;

  // Health.
  set('Health', 'HpRest%', percent(health.restBelow));
  if (health.restTo > 0) set('Health', 'HpFull%', percent(health.restTo));
  set('Health', 'UseMeditate', flag(health.meditateBelow > 0));
  if (health.meditateBelow > 0) set('Health', 'ManaRest%', percent(health.meditateBelow));
  if (health.meditateTo > 0) set('Health', 'ManaFull%', percent(health.meditateTo));
  set('Health', 'HpHeal%', percent(spells.healBelow));
  set('Health', 'HpHealAtt%', percent(spells.healBelowInCombat));
  /*
   * The old retreat is MegaMUD's run. The flee is not: it is kept as ours
   * beside the engine (`MegaEngine.useFlee`) and starts MegaMUD's run itself
   * below its own line, so carrying it here too ran twice (2026-10-14).
   */
  if (safety.retreat.enabled) set('Health', 'HpRun%', percent(safety.retreat.belowHealth));
  if (safety.hangUp.enabled) set('Health', 'HpLogoff%', percent(safety.hangUp.belowHealth));

  // Spells: healing, cures, regeneration, blessings.
  set('Spells', 'HealCmd', spell(spells.heal));
  set('Spells', 'BlindCmd', spell(spells.cures.blindness));
  set('Spells', 'PoisonCmd', spell(spells.cures.poison));
  set('Spells', 'DiseaseCmd', spell(spells.cures.disease));
  set('Spells', 'FreedomCmd', spell(spells.cures.freedom));
  set('Spells', 'RegenCmd', spell(spells.regen.hp));
  set('Spells', 'HpFullCmd', spell(spells.regen.hpFull));
  set('Spells', 'MaFullCmd', spell(spells.regen.manaFull));
  const self = spells.blessings.filter((b) => b.target === 'self').slice(0, SELF_BLESSINGS);
  self.forEach((blessing, i) => {
    set('Spells', `BlessCmd${i + 1}`, spell(blessing.spell));
    set('Spells', `BlessPri${i + 1}`, flag(blessing.prioritizeOverHeal));
    set('Spells', `BlessTim${i + 1}`, blessing.fallbackSeconds ?? 0);
  });
  const others = spells.blessings.filter((b) => b.target === 'party').slice(0, PARTY_BLESSINGS);
  others.forEach((blessing, i) => set('Party', `PartyBless${i + 1}`, spell(blessing.spell)));
  if (spells.blessings.some((b) => b.inCombat)) set('Other', 'BlessCombat', 1);
  set('Party', 'PartyHeal1', spell(spells.healPartyWith));

  // Combat.
  if (combat.attack !== '') set('Combat', 'AttackCmd', combat.attack);
  set('Combat', 'AttackSpl', spell(spells.attack));
  set('Combat', 'MaxCastCnt', spells.attackCasts);
  set('Combat', 'MultAttack', spell(spells.areaAttack));
  set('Combat', 'MultCastCnt', spells.areaCasts);
  set('Combat', 'MultMstrCnt', spells.areaMinMobs);
  set('Combat', 'PoliteAttacks', flag(combat.politeAttacks));
  set('Combat', 'MaxMstrs', combat.maxMobs);
  set('Combat', 'MinMstrs', combat.minMobs);
  set('Combat', 'MaxMstrExp', combat.maxMonsterExperience);

  // Party.
  set('Party', 'DefendParty', flag(party.defendParty));
  set('Party', 'AskHealth', flag(party.requestPartyHealth));
  set('Party', 'IgnoreWait', flag(party.ignoreWaitWhenLeading));
  set('Party', 'IgnoreParty', flag(party.ignorePartyWhenFollowing));
  set('Party', 'ParAfterRound', flag(party.parAfterRound));
  set('Party', 'ParPeriod', party.parEverySeconds);
  set('Party', 'PartyAskHeal%', percent(party.askForHealBelow));
  set('Party', 'PartyWait%', percent(party.waitForMembersBelow));
  set('Party', 'PartyWaitMax', party.waitNoLongerMinutes);

  // Coins: wanted, not wanted, or dropped (-1).
  for (const coin of DENOMINATIONS) {
    const want = loot.discardKinds.includes(coin)
      ? -1
      : flag(loot.coins && loot.coinKinds.includes(coin));
    set('Cash', WANT[coin], want);
  }

  // Doors, light, searching and stealth.
  set('Other', 'CanPickLocks', flag(movement.pickLocks));
  set('Other', 'PickMax', movement.pickTries);
  set('Other', 'BashMax', movement.bashTries);
  set('Other', 'LightDimRooms', flag(movement.lightDimRooms));
  set('Other', 'SearchMax', search.tries);

  // The toolbar's switches as the character runs now.
  set('MegaMud', 'AutoCombat', flag(combat.enabled));
  set('MegaMud', 'AutoBless', flag(spells.autoBless));
  set('MegaMud', 'AutoCash', flag(loot.coins));
  set('MegaMud', 'AutoSneak', flag(movement.sneak));
  set('MegaMud', 'AutoSearch', flag(search.enabled));
  set('MegaMud', 'AutoLight', flag(movement.provideLight));
  set('MegaMud', 'AutoAfk', flag(afk.enabled));
  set('MegaMud', 'AfkTimeout', afk.afterMinutes);
  set('MegaMud', 'AfkReply', afk.reply);
  return settings;
}
