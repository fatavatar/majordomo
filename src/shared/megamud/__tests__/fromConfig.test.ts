import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../config';
import { megamudFromConfig } from '../fromConfig';
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
      minMana: 0,
      prioritizeOverHeal: true,
      inCombat: false
    },
    { spell: 'holy shield', target: 'party', minMana: 0, prioritizeOverHeal: false, inCombat: true }
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
    expect(settings.live['Other']).toMatchObject({ BlessCombat: 1 });
    expect(settings.live['Cash']).toMatchObject({
      WantRunic: 1,
      WantGold: 1,
      WantSilver: 0,
      WantCopper: -1
    });
  });
});
