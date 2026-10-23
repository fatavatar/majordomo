import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../config';
import { megamudFromConfig, WAIT_AS_LONG_AS_IT_TAKES } from '../fromConfig';
import { defaultSettings, settingDef } from '../settings';

/* Healbot's and Fatty's settings carried over where MegaMUD has the same one (2026-10-13). */
describe('MegaMUD settings started from the old automation', () => {
  const automation = structuredClone(DEFAULT_CONFIG.automation);
  automation.health.restBelow = 0.35;
  automation.spells.heal = 'godheal';
  automation.spells.healBelow = 0.8;
  automation.spells.blessings = [
    {
      spell: 'pagan ritual',
      target: 'self',
      prioritizeOverHeal: true,
      inCombat: false
    },
    { spell: 'holy shield', target: 'party', prioritizeOverHeal: false, inCombat: true }
  ];
  automation.loot.coins = true;
  automation.loot.coinKinds = ['runic', 'gold'];
  automation.loot.discardKinds = ['copper'];
  const words: Record<string, string> = {
    godheal: 'gdhl',
    'pagan ritual': 'ritu',
    'holy shield': 'hshd'
  };
  const settings = megamudFromConfig(automation, (spell) => words[spell] ?? spell);

  /* Archer led blind Bowel on through every @wait (2026-10-17): MegaMUD's 0 gives up at once. */
  it('carries "wait as long as it takes" as a day, and a stated limit as it is', () => {
    expect(settings.live['Party']!['PartyWaitMax']).toBe(WAIT_AS_LONG_AS_IT_TAKES);
    const five = structuredClone(automation);
    five.party.waitNoLongerMinutes = 5;
    expect(megamudFromConfig(five, (spell) => spell).live['Party']!['PartyWaitMax']).toBe(5);
  });

  it('writes only keys MegaMUD has', () => {
    const defaults = defaultSettings();
    for (const [section, values] of Object.entries(settings.live)) {
      for (const key of Object.keys(values)) {
        expect(settingDef(section, key), `${section}.${key}`).toBeDefined();
        expect(typeof values[key]).toBe(typeof defaults.live[section]?.[key]);
      }
    }
  });

  it('carries percentages, spell words, blessings and coins', () => {
    expect(settings.live['Health']).toMatchObject({ 'HpRest%': 35, 'HpHeal%': 80 });
    expect(settings.live['Spells']).toMatchObject({
      HealCmd: 'gdhl',
      BlessCmd1: 'ritu',
      BlessPri1: 1
    });
    expect(settings.live['Party']).toMatchObject({ PartyBless1: 'hshd' });
    // The flee is ours beside the engine, so not MegaMUD's run too.
    const fleeing = structuredClone(automation);
    fleeing.safety.fleeGoto = { enabled: true, belowHealth: 0.5, destination: 'sil' };
    expect(megamudFromConfig(fleeing, (spell) => spell).live['Health']!['HpRun%']).toBe(
      defaultSettings().live['Health']!['HpRun%']
    );
    expect(settings.live['Other']).toMatchObject({ BlessCombat: 1 });
    expect(settings.live['Cash']).toMatchObject({
      WantRunic: 1,
      WantGold: 1,
      WantSilver: 0,
      WantCopper: -1
    });
  });
});
